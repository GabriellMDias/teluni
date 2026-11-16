import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import {
  widgetPolicy,
  widgetUrl,
  type RssData,
  type WeatherData,
} from "./widgets.js";

export class WidgetSourceFailure extends Error {
  constructor() {
    super("Widget source unavailable");
  }
}
const blocked = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["192.88.99.0", 24],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(network, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
for (const [network, prefix] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const)
  blocked.addSubnet(network, prefix, "ipv6");
export function publicWidgetAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4
    ? !blocked.check(address, "ipv4")
    : family === 6 &&
        globalV6.check(address, "ipv6") &&
        !blocked.check(address, "ipv6");
}
export type SourceResponse = Readonly<{ body: string; expires: number | null }>;
export type WidgetFetcher = (url: string) => Promise<SourceResponse>;

/** DNS is checked on every redirect and the validated address is pinned for TLS. */
export const fetchWidgetSource: WidgetFetcher = async (source) => {
  const deadline = Date.now() + 5000;
  async function fetch(
    urlText: string,
    redirects: number,
  ): Promise<SourceResponse> {
    if (!widgetUrl(urlText) || redirects > 3) throw new WidgetSourceFailure();
    const url = new URL(urlText);
    if (
      isIP(url.hostname.replace(/^\[|\]$/g, "")) ||
      /(^|\.)(localhost|local|internal)$/.test(url.hostname)
    )
      throw new WidgetSourceFailure();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const addresses = await Promise.race([
      lookup(url.hostname, { all: true, verbatim: true }).catch(() => {
        throw new WidgetSourceFailure();
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new WidgetSourceFailure()),
          Math.max(1, Math.min(2000, deadline - Date.now())),
        );
      }),
    ]).finally(() => clearTimeout(timer));
    if (
      !addresses.length ||
      addresses.some(({ address }) => !publicWidgetAddress(address))
    )
      throw new WidgetSourceFailure();
    const selected = addresses[0];
    return new Promise<SourceResponse>((resolve, reject) => {
      let redirecting = false;
      const fail = () => {
        if (!redirecting) reject(new WidgetSourceFailure());
      };
      const req = request(
        url,
        {
          method: "GET",
          agent: false,
          headers: {
            "user-agent":
              "Teluni/0.1 (https://github.com/GabriellMDias/teluni)",
            accept:
              "application/json, application/rss+xml, application/atom+xml, application/xml, text/xml",
            "accept-encoding": "identity",
          },
          lookup: (_host, options, callback) =>
            options.all
              ? callback(null, [selected])
              : callback(null, selected.address, selected.family),
        },
        (response) => {
          if (
            [301, 302, 303, 307, 308].includes(response.statusCode ?? 0) &&
            response.headers.location
          ) {
            // Closing a redirect body can emit ECONNRESET on its request. Only the next hop decides the result.
            redirecting = true;
            response.on("error", () => undefined);
            response.destroy();
            try {
              fetch(
                new URL(response.headers.location, url).href,
                redirects + 1,
              ).then(resolve, reject);
            } catch {
              reject(new WidgetSourceFailure());
            }
            return;
          }
          if (
            response.statusCode !== 200 ||
            (response.headers["content-encoding"] &&
              response.headers["content-encoding"] !== "identity")
          ) {
            response.destroy();
            fail();
            return;
          }
          let size = 0;
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > widgetPolicy.maxSourceBytes) {
              response.destroy();
              fail();
            } else chunks.push(chunk);
          });
          response.on("error", fail);
          response.on("end", () => {
            const expires = Date.parse(response.headers.expires ?? "");
            resolve({
              body: Buffer.concat(chunks).toString("utf8"),
              expires: Number.isFinite(expires) ? expires : null,
            });
          });
        },
      );
      const timeout = setTimeout(
        () => {
          req.destroy();
          fail();
        },
        Math.max(1, deadline - Date.now()),
      );
      req.once("close", () => clearTimeout(timeout));
      req.on("error", fail);
      req.end();
    });
  }
  return fetch(source, 0);
};
const plain = (value: unknown, max: number): string => {
  let visited = 0;
  const collect = (node: unknown, depth = 0): string => {
    if (++visited > 128 || depth > 8) return "";
    if (typeof node === "string") return node;
    if (Array.isArray(node))
      return node.map((item: unknown) => collect(item, depth + 1)).join(" ");
    if (node && typeof node === "object")
      return Object.entries(node)
        .filter(([key]) => !key.startsWith("@"))
        .map(([, item]: [string, unknown]) => collect(item, depth + 1))
        .join(" ");
    return "";
  };
  const text = collect(value);
  return [
    ...text
      .replace(
        /&(?:amp|lt|gt|quot|apos|#x[0-9a-f]{1,6}|#[0-9]{1,7});/gi,
        (entity) => {
          if (entity.startsWith("&#")) {
            const code = Number.parseInt(
              entity.slice(entity[2].toLowerCase() === "x" ? 3 : 2, -1),
              entity[2].toLowerCase() === "x" ? 16 : 10,
            );
            return code <= 0x10ffff && (code < 0xd800 || code > 0xdfff)
              ? String.fromCodePoint(code)
              : " ";
          }
          return (
            {
              "&amp;": "&",
              "&lt;": "<",
              "&gt;": ">",
              "&quot;": '"',
              "&apos;": "'",
            }[entity.toLowerCase()] ?? ""
          );
        },
      )
      .replace(/<[^>]*>/g, " ")
      .replace(/[\p{Cc}\s]+/gu, " ")
      .trim(),
  ]
    .slice(0, max)
    .join("");
};
const list = (value: unknown): unknown[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** RSS 2.0 and Atom headlines only; entity declarations and excessive nesting are refused. */
export function parseWidgetRss(body: string): RssData {
  if (
    Buffer.byteLength(body) > widgetPolicy.maxSourceBytes ||
    /<!\s*(?:DOCTYPE|ENTITY)/i.test(body)
  )
    throw new WidgetSourceFailure();
  let depth = 0;
  for (const tag of body
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->/g, " ")
    .matchAll(/<\/?[\w:][^>]*>/g)) {
    if (tag[0].startsWith("</")) depth--;
    else if (!tag[0].endsWith("/>")) depth++;
    if (depth > 32 || depth < 0) throw new WidgetSourceFailure();
  }
  if (XMLValidator.validate(body) !== true) throw new WidgetSourceFailure();
  const root = record(
    new XMLParser({
      ignoreAttributes: false,
      parseTagValue: false,
      processEntities: false,
      removeNSPrefix: true,
    }).parse(body),
  );
  const feed = root.feed ? record(root.feed) : record(record(root.rss).channel);
  const items = list(feed.item ?? feed.entry)
    .slice(0, 100)
    .flatMap((raw) => {
      const item = record(raw);
      const title = plain(item.title, 200);
      const links = list(item.link);
      const link = links.find(
        (entry) =>
          typeof entry === "string" ||
          !record(entry)["@_rel"] ||
          record(entry)["@_rel"] === "alternate",
      );
      const href = typeof link === "string" ? link : record(link)["@_href"];
      return title
        ? [{ title, url: widgetUrl(href) ? new URL(href).href : null }]
        : [];
    })
    .slice(0, widgetPolicy.maxItems);
  if (!items.length) throw new WidgetSourceFailure();
  return { type: "rss", source: plain(feed.title, 120) || "RSS", items };
}
export function parseWidgetWeather(body: string, now: number): WeatherData {
  let json: Record<string, unknown>;
  try {
    json = record(JSON.parse(body));
  } catch {
    throw new WidgetSourceFailure();
  }
  const series = list(record(json.properties).timeseries).map(record);
  const selected = series
    .filter(
      (entry) => Math.abs(Date.parse(String(entry.time)) - now) <= 6 * 3600_000,
    )
    .sort(
      (a, b) =>
        Math.abs(Date.parse(String(a.time)) - now) -
        Math.abs(Date.parse(String(b.time)) - now),
    )[0];
  const data = record(selected?.data);
  const details = record(record(data.instant).details);
  const temperatureC = details.air_temperature;
  const humidity = details.relative_humidity;
  const symbol = record(
    record(data.next_1_hours ?? data.next_6_hours ?? data.next_12_hours)
      .summary,
  ).symbol_code;
  if (
    typeof temperatureC !== "number" ||
    !Number.isFinite(temperatureC) ||
    Math.abs(temperatureC) > 100 ||
    typeof humidity !== "number" ||
    !Number.isFinite(humidity) ||
    humidity < 0 ||
    humidity > 100 ||
    typeof symbol !== "string" ||
    !/^[a-z0-9_]{1,64}$/.test(symbol) ||
    !selected
  )
    throw new WidgetSourceFailure();
  return {
    type: "weather",
    temperatureC,
    humidity,
    symbol,
    forecastAt: new Date(String(selected.time)).toISOString(),
  };
}
