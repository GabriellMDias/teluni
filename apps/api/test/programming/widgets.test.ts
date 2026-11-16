import { describe, expect, it } from "vitest";
import jsQR from "jsqr";
import type { PrismaLayoutRepository } from "../../src/features/programming/layouts-repository.js";
import type { CompanyAccessPort } from "../../src/features/organizations/public.js";
import {
  parseWidget,
  type WidgetDefinition,
} from "../../src/features/programming/widgets.js";
import {
  parseWidgetRss,
  parseWidgetWeather,
  publicWidgetAddress,
  WidgetSourceFailure,
} from "../../src/features/programming/widgets-fetch.js";
import {
  WidgetService,
  widgetLinkId,
} from "../../src/features/programming/widgets-service.js";
import {
  layoutDocument,
  planLayout,
} from "../../src/features/programming/layouts.js";

const base = {
  version: 1,
  locale: "pt-BR",
  textSize: 48,
  foreground: "#ffffff",
} as const;
const clock: WidgetDefinition = {
  ...base,
  type: "clock",
  showTime: true,
  showDate: true,
  seconds: true,
  hour12: false,
  dateStyle: "long",
};
const rss: WidgetDefinition = {
  ...base,
  type: "rss",
  feedUrl: "https://example.org/feed.xml",
  title: "Headlines",
  itemSeconds: 10,
  maxItems: 5,
};
const xml =
  '<rss version="2.0"><channel><title>News &amp; science</title><item><title><![CDATA[<b>A discovery</b>]]></title><link>https://example.org/story</link></item></channel></rss>';
const layoutId = "11111111-1111-4111-8111-111111111111";
const service = (
  options: Partial<ConstructorParameters<typeof WidgetService>[0]> = {},
) =>
  new WidgetService({
    repository: {} as PrismaLayoutRepository,
    companies: {} as CompanyAccessPort,
    publicOrigin: "https://display.example.org",
    ...options,
  });

describe("layout widgets", () => {
  it("validates all types and rejects unsupported or dangerous configuration", () => {
    expect(parseWidget(clock)).toMatchObject({ foreground: "#FFFFFF" });
    expect(parseWidget({ ...clock, unknown: true })).toBeNull();
    expect(
      parseWidget({ ...clock, showDate: false, showTime: false }),
    ).toBeNull();
    for (const targetUrl of [
      "http://example.org",
      "https://example.org/" + "é".repeat(1000),
      "https://user:secret@example.org",
      "javascript:alert(1)",
      "https://example.org:8443",
      "https://example.org/\n",
    ]) {
      expect(
        parseWidget({ ...base, type: "qr", targetUrl, caption: "" }),
      ).toBeNull();
    }
    expect(
      parseWidget({
        ...base,
        type: "ticker",
        text: " Welcome\n everyone ",
        speed: 60,
      }),
    ).toMatchObject({ text: "Welcome everyone" });
    expect(
      parseWidget({
        ...base,
        type: "weather",
        latitude: -23.550521,
        longitude: -46.633308,
        label: "São Paulo",
        units: "celsius",
      }),
    ).toMatchObject({ latitude: -23.5505, longitude: -46.6333 });
    expect(parseWidget({ ...rss, maxItems: 21 })).toBeNull();
  });
  it("exports schema 2 only for widget layouts and forbids page/audio settings", () => {
    const area = {
      key: "clock",
      name: "Clock",
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      z: 0,
      kind: "widget" as const,
      widget: clock,
    };
    const layout = planLayout({ orientation: "landscape", areas: [area] });
    expect(layout.areas[0]).toMatchObject({ muted: true, volume: 0 });
    expect(layoutDocument("Clock", layout).schema).toBe(2);
    expect(() =>
      planLayout({
        orientation: "landscape",
        areas: [{ ...area, muted: false }],
      }),
    ).toThrow();
    expect(() =>
      planLayout({
        orientation: "landscape",
        areas: [{ ...area, pageControlled: true }],
      }),
    ).toThrow();
  });
  it("encodes the stable public link as a scannable QR and changes only its target", () => {
    const widgets = service();
    const qr = {
      ...base,
      type: "qr" as const,
      targetUrl: "https://example.org/first",
      caption: "Scan",
    };
    const first = widgets.snapshot(qr, layoutId, "qr");
    const second = widgets.snapshot(
      { ...qr, targetUrl: "https://example.org/second" },
      layoutId,
      "qr",
    );
    expect(second.modules).toEqual(first.modules);
    expect(second.linkId).toBe(widgetLinkId(layoutId, "qr"));
    expect(widgets.snapshot(qr, layoutId, "other").linkId).not.toBe(
      first.linkId,
    );
    const matrix = first.modules!;
    const scale = 6,
      size = (matrix.length + 8) * scale;
    const pixels = new Uint8ClampedArray(size * size * 4).fill(255);
    matrix.forEach((row, y) =>
      [...row].forEach((cell, x) => {
        if (cell === "1")
          for (let dy = 0; dy < scale; dy++)
            for (let dx = 0; dx < scale; dx++) {
              const offset =
                (((y + 4) * scale + dy) * size + (x + 4) * scale + dx) * 4;
              pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 0;
            }
      }),
    );
    expect(
      (jsQR as unknown as typeof import("jsqr").default)(pixels, size, size)
        ?.data,
    ).toBe(first.qrUrl);
  });
});

describe("public widget sources", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "192.168.1.1",
    "100.100.100.100",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "fe80::1",
    "fc00::1",
    "2001:db8::1",
    "2002:7f00:1::1",
  ])("rejects private/reserved address %s", (address) =>
    expect(publicWidgetAddress(address)).toBe(false),
  );
  it("accepts public IPv4 and global IPv6", () => {
    expect(publicWidgetAddress("1.1.1.1")).toBe(true);
    expect(publicWidgetAddress("2606:4700:4700::1111")).toBe(true);
  });
  it("parses RSS and Atom as bounded plain text without loading article HTML", () => {
    expect(parseWidgetRss(xml)).toEqual({
      type: "rss",
      source: "News & science",
      items: [{ title: "A discovery", url: "https://example.org/story" }],
    });
    expect(
      parseWidgetRss(
        '<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom</title><entry><title>News</title><link rel="alternate" href="https://example.org/story"/></entry></feed>',
      ).items,
    ).toHaveLength(1);
    expect(() =>
      parseWidgetRss(
        '<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]><rss/>',
      ),
    ).toThrow(WidgetSourceFailure);
    expect(() => parseWidgetRss("<a>".repeat(33) + "</a>".repeat(33))).toThrow(
      WidgetSourceFailure,
    );
  });
  it("decodes bounded text entities and extracts Atom XHTML titles without rendering markup", () => {
    const rss =
      "<rss><channel><title>Science</title><item><title>NASA&#8217;s &lt;b&gt;news&lt;/b&gt;</title></item></channel></rss>";
    expect(parseWidgetRss(rss).items[0].title).toBe("NASA’s news");
    const atom =
      '<feed><title>Science</title><entry><title type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml">A <b>discovery</b></div></title></entry></feed>';
    expect(parseWidgetRss(atom).items[0].title).toContain("discovery");
    expect(parseWidgetRss(atom).items[0].title).not.toContain("<");
  });
  it("ignores literal tags inside XML comments and CDATA when bounding depth", () => {
    const literal = "<nested>".repeat(40);
    const body = `<rss><channel><!--${literal}--><title>Source</title><item><title><![CDATA[${literal}Headline]]></title></item></channel></rss>`;
    expect(parseWidgetRss(body).items[0].title).toBe("Headline");
  });
  it("uses identified forecasts and rejects malformed or stale weather", () => {
    const now = Date.parse("2026-11-16T12:00:00Z");
    const body = JSON.stringify({
      properties: {
        timeseries: [
          {
            time: new Date(now).toISOString(),
            data: {
              instant: {
                details: { air_temperature: 24.5, relative_humidity: 70 },
              },
              next_1_hours: { summary: { symbol_code: "clearsky_day" } },
            },
          },
        ],
      },
    });
    expect(parseWidgetWeather(body, now)).toMatchObject({
      temperatureC: 24.5,
      humidity: 70,
      symbol: "clearsky_day",
    });
    expect(() => parseWidgetWeather(body, now + 24 * 3600_000)).toThrow(
      WidgetSourceFailure,
    );
  });
  it("coalesces source requests, respects expiry, retains bounded stale data and stops after 24 hours", async () => {
    let now = 1_800_000_000_000,
      calls = 0,
      fail = false;
    const widgets = service({
      now: () => now,
      fetch: async () => {
        calls++;
        await Promise.resolve();
        if (fail) throw new WidgetSourceFailure();
        return { body: xml, expires: null };
      },
    });
    const answers = await Promise.all(
      Array.from({ length: 12 }, () => widgets.data(rss)),
    );
    expect(calls).toBe(1);
    expect(answers.every((answer) => answer.status === "ready")).toBe(true);
    now += 15 * 60_000;
    fail = true;
    expect((await widgets.data(rss)).status).toBe("stale");
    await widgets.data(rss);
    expect(calls).toBe(2);
    now += 24 * 3600_000;
    expect((await widgets.data(rss)).status).toBe("unavailable");
  });
  it("does not swallow programming errors as provider failures", async () => {
    const widgets = service({
      fetch: () => Promise.reject(new Error("Adapter defect")),
    });
    await expect(widgets.data(rss)).rejects.toThrow("Adapter defect");
  });
});
