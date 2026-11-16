import { createHash } from "node:crypto";
import QRCode from "qrcode";
import type { PrismaLayoutRepository } from "./layouts-repository.js";
import type { Prisma } from "../../generated/prisma/client.js";
import type { HumanContext } from "../identity/public.js";
import {
  requireCapability,
  type CompanyAccessPort,
} from "../organizations/public.js";
import { ProgrammingFailure } from "./domain.js";
import {
  fetchWidgetSource,
  parseWidgetRss,
  parseWidgetWeather,
  WidgetSourceFailure,
  type WidgetFetcher,
} from "./widgets-fetch.js";
import {
  parseWidget,
  widgetPolicy,
  type WidgetData,
  type WidgetDefinition,
  type WidgetSnapshot,
} from "./widgets.js";

type Entry = {
  fetchedAt: number;
  expires: number;
  retryAt: number;
  data: WidgetData["data"];
  pending?: Promise<void>;
};
const unavailable: WidgetData = {
  status: "unavailable",
  fetchedAt: null,
  validUntil: null,
  data: null,
};
export const widgetLinkId = (layoutId: string, areaKey: string): string =>
  createHash("sha256")
    .update(`teluni.qr.v1:${layoutId.toLowerCase()}:${areaKey}`)
    .digest("hex")
    .slice(0, 32);

export function snapshotWidget(
  widget: WidgetDefinition,
  layoutId: string,
  areaKey: string,
  publicOrigin: string | undefined,
): WidgetSnapshot {
  if (widget.type !== "qr") return widget;
  if (!publicOrigin) throw new ProgrammingFailure("SERVICE_UNAVAILABLE");
  const linkId = widgetLinkId(layoutId, areaKey);
  const qrUrl = new URL(`/q/${linkId}`, publicOrigin).href;
  const matrix = QRCode.create(qrUrl, { errorCorrectionLevel: "M" }).modules;
  const modules = Array.from({ length: matrix.size }, (_, y) =>
    Array.from({ length: matrix.size }, (_, x) =>
      matrix.get(y, x) ? "1" : "0",
    ).join(""),
  );
  return {
    ...widget,
    layoutId: layoutId.toLowerCase(),
    linkId,
    qrUrl,
    modules,
  };
}

/** Programming owns widget sources, bounded shared caches and published QR destinations. */
export class WidgetService {
  readonly #cache = new Map<string, Entry>();
  readonly #repository: PrismaLayoutRepository;
  readonly #companies: CompanyAccessPort;
  readonly #origin: string | undefined;
  readonly #fetch: WidgetFetcher;
  readonly #now: () => number;
  #active = 0;
  constructor(options: {
    repository: PrismaLayoutRepository;
    companies: CompanyAccessPort;
    publicOrigin?: string;
    fetch?: WidgetFetcher;
    now?: () => number;
  }) {
    this.#repository = options.repository;
    this.#companies = options.companies;
    this.#origin = options.publicOrigin;
    this.#fetch = options.fetch ?? fetchWidgetSource;
    this.#now = options.now ?? Date.now;
  }
  snapshot(
    widget: WidgetDefinition,
    layoutId: string,
    areaKey: string,
  ): WidgetSnapshot {
    return snapshotWidget(widget, layoutId, areaKey, this.#origin);
  }
  async preview(
    context: HumanContext,
    companyId: string,
    input: {
      widget: unknown;
      layoutId: string;
      areaKey: string;
      branchId: string | null;
    },
  ) {
    const access = await this.#companies.resolve(context, companyId);
    requireCapability(access, "programming.edit", input.branchId ?? undefined);
    const widget = parseWidget(input.widget);
    if (!widget)
      throw new ProgrammingFailure("LAYOUT_INVALID", [
        { path: "/widget", reason: "WIDGET_INVALID" },
      ]);
    return {
      widget: this.snapshot(widget, input.layoutId, input.areaKey),
      live: await this.data(widget),
    };
  }
  async activate(
    tx: Prisma.TransactionClient,
    companyId: string,
    areas: readonly { key: string; widget?: WidgetSnapshot }[],
    mode: "publish" | "restore",
  ): Promise<boolean> {
    const links: {
      id: string;
      layoutId: string;
      areaKey: string;
      targetUrl: string;
    }[] = [];
    for (const area of areas) {
      const widget = area.widget;
      if (widget?.type !== "qr") continue;
      const { layoutId, linkId } = widget;
      if (!layoutId || !linkId || linkId !== widgetLinkId(layoutId, area.key))
        throw new Error("Invalid published QR identity");
      links.push({
        id: linkId,
        layoutId,
        areaKey: area.key,
        targetUrl: widget.targetUrl,
      });
    }
    return this.#repository.activateQrLinks(tx, companyId, links, mode);
  }
  async destination(linkId: string): Promise<{ url: string }> {
    const link = await this.#repository.findQrDestination(linkId);
    if (
      !link ||
      (await this.#companies.describe(link.companyId, [])).companyStatus !==
        "ACTIVE"
    )
      throw new ProgrammingFailure("RESOURCE_NOT_FOUND");
    return { url: link.url };
  }
  /** Screens render headlines only; omitting article URLs keeps twelve full feeds within 256 KiB. */
  async deviceData(widget: WidgetDefinition): Promise<WidgetData> {
    const live = await this.data(widget);
    return live.data?.type === "rss"
      ? {
          ...live,
          data: {
            ...live.data,
            items: live.data.items.map((item) => ({ ...item, url: null })),
          },
        }
      : live;
  }
  async data(widget: WidgetDefinition): Promise<WidgetData> {
    if (widget.type !== "weather" && widget.type !== "rss") return unavailable;
    const source =
      widget.type === "weather"
        ? `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${widget.latitude.toFixed(4)}&lon=${widget.longitude.toFixed(4)}`
        : widget.feedUrl;
    const key = `${widget.type}:${source}`;
    const now = this.#now();
    let entry = this.#cache.get(key);
    if (!entry) {
      if (this.#active >= 4) return unavailable;
      if (this.#cache.size >= 256) {
        const oldest = [...this.#cache].find(([, value]) => !value.pending);
        if (!oldest) return unavailable;
        this.#cache.delete(oldest[0]);
      }
      entry = { fetchedAt: 0, expires: 0, retryAt: 0, data: null };
      this.#cache.set(key, entry);
    }
    this.#cache.delete(key);
    this.#cache.set(key, entry);
    if (
      !entry.pending &&
      now >= entry.expires &&
      now >= entry.retryAt &&
      this.#active < 4
    ) {
      const target = entry;
      this.#active++;
      target.retryAt = now + 60_000;
      target.pending = (async () => {
        try {
          const response = await this.#fetch(source);
          target.data =
            widget.type === "weather"
              ? parseWidgetWeather(response.body, now)
              : parseWidgetRss(response.body);
          target.fetchedAt = this.#now();
          const minimum =
            widget.type === "weather" ? 3 * 3600_000 : 15 * 60_000;
          target.expires = Math.min(
            target.fetchedAt + widgetPolicy.maxStaleMs,
            Math.max(target.fetchedAt + minimum, response.expires ?? 0),
          );
        } catch (error) {
          if (!(error instanceof WidgetSourceFailure)) throw error;
        } finally {
          this.#active--;
          delete target.pending;
        }
      })();
    }
    await entry.pending;
    if (!entry.data || this.#now() - entry.fetchedAt > widgetPolicy.maxStaleMs)
      return unavailable;
    return {
      status: this.#now() < entry.expires ? "ready" : "stale",
      fetchedAt: new Date(entry.fetchedAt).toISOString(),
      validUntil: new Date(entry.expires).toISOString(),
      data:
        entry.data.type === "rss" && widget.type === "rss"
          ? { ...entry.data, items: entry.data.items.slice(0, widget.maxItems) }
          : entry.data,
    };
  }
}
