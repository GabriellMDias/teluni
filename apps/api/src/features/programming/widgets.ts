/** Versioned widget meaning shared by layout validation and publication. */
export const widgetTypes = ["clock", "qr", "ticker", "weather", "rss"] as const;
export type WidgetType = (typeof widgetTypes)[number];
type Style = Readonly<{
  version: 1;
  locale: "pt-BR" | "en-US";
  textSize: number;
  foreground: string;
}>;
export type WidgetDefinition = Style &
  (
    | Readonly<{
        type: "clock";
        showTime: boolean;
        showDate: boolean;
        seconds: boolean;
        hour12: boolean;
        dateStyle: "short" | "long";
      }>
    | Readonly<{ type: "qr"; targetUrl: string; caption: string }>
    | Readonly<{ type: "ticker"; text: string; speed: number }>
    | Readonly<{
        type: "weather";
        latitude: number;
        longitude: number;
        label: string;
        units: "celsius" | "fahrenheit";
      }>
    | Readonly<{
        type: "rss";
        feedUrl: string;
        title: string;
        itemSeconds: number;
        maxItems: number;
      }>
  );
export type WidgetSnapshot = WidgetDefinition &
  Readonly<{
    layoutId?: string;
    linkId?: string;
    qrUrl?: string;
    modules?: readonly string[];
  }>;
export type WeatherData = Readonly<{
  type: "weather";
  temperatureC: number;
  humidity: number;
  symbol: string;
  forecastAt: string;
}>;
export type RssData = Readonly<{
  type: "rss";
  source: string;
  items: readonly Readonly<{ title: string; url: string | null }>[];
}>;
export type WidgetData = Readonly<{
  status: "ready" | "stale" | "unavailable";
  fetchedAt: string | null;
  validUntil: string | null;
  data: WeatherData | RssData | null;
}>;
export const widgetPolicy = Object.freeze({
  maxText: 2000,
  maxUrl: 2048,
  maxItems: 20,
  maxStaleMs: 24 * 60 * 60_000,
  maxSourceBytes: 512 * 1024,
});
const color = /^#[0-9a-f]{6}$/i;
const control = /\p{Cc}/u;
const integer = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= min &&
  value <= max;
const text = (value: unknown, max: number, empty = false): value is string =>
  typeof value === "string" &&
  !control.test(value.replace(/[\t\n\r]/g, "")) &&
  [...value].length <= max &&
  (empty || value.trim().length > 0);

/** HTTPS destinations contain neither embedded credentials nor fragments. */
export function widgetUrl(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length > widgetPolicy.maxUrl ||
    /[\s\p{Cc}]/u.test(value)
  )
    return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.hash &&
      (url.port === "" || url.port === "443") &&
      !!url.hostname
    );
  } catch {
    return false;
  }
}

/** Validates persisted JSON as well as HTTP input; no unvalidated data reach a renderer. */
export function parseWidget(value: unknown): WidgetDefinition | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (
    v.version !== 1 ||
    (v.locale !== "pt-BR" && v.locale !== "en-US") ||
    !integer(v.textSize, 24, 200) ||
    typeof v.foreground !== "string" ||
    !color.test(v.foreground)
  )
    return null;
  const base: Style = {
    version: 1 as const,
    locale: v.locale,
    textSize: v.textSize,
    foreground: v.foreground.toUpperCase(),
  };
  let result: WidgetDefinition;
  switch (v.type) {
    case "clock":
      if (
        ![v.showTime, v.showDate, v.seconds, v.hour12].every(
          (entry) => typeof entry === "boolean",
        ) ||
        (!v.showTime && !v.showDate) ||
        (v.dateStyle !== "short" && v.dateStyle !== "long")
      )
        return null;
      result = {
        ...base,
        type: "clock",
        showTime: v.showTime as boolean,
        showDate: v.showDate as boolean,
        seconds: v.seconds as boolean,
        hour12: v.hour12 as boolean,
        dateStyle: v.dateStyle,
      };
      break;
    case "qr":
      if (!widgetUrl(v.targetUrl) || !text(v.caption, 120, true)) return null;
      result = {
        ...base,
        type: "qr",
        targetUrl: new URL(v.targetUrl).href,
        caption: v.caption.trim(),
      };
      break;
    case "ticker":
      if (!text(v.text, widgetPolicy.maxText) || !integer(v.speed, 20, 160))
        return null;
      result = {
        ...base,
        type: "ticker",
        text: v.text.replace(/\s+/g, " ").trim(),
        speed: v.speed,
      };
      break;
    case "weather":
      if (
        typeof v.latitude !== "number" ||
        !Number.isFinite(v.latitude) ||
        Math.abs(v.latitude) > 90 ||
        typeof v.longitude !== "number" ||
        !Number.isFinite(v.longitude) ||
        Math.abs(v.longitude) > 180 ||
        !text(v.label, 80) ||
        (v.units !== "celsius" && v.units !== "fahrenheit")
      )
        return null;
      result = {
        ...base,
        type: "weather",
        latitude: Math.round(v.latitude * 10000) / 10000,
        longitude: Math.round(v.longitude * 10000) / 10000,
        label: v.label.trim(),
        units: v.units,
      };
      break;
    case "rss":
      if (
        !widgetUrl(v.feedUrl) ||
        !text(v.title, 80) ||
        !integer(v.itemSeconds, 5, 120) ||
        !integer(v.maxItems, 1, widgetPolicy.maxItems)
      )
        return null;
      result = {
        ...base,
        type: "rss",
        feedUrl: new URL(v.feedUrl).href,
        title: v.title.trim(),
        itemSeconds: v.itemSeconds,
        maxItems: v.maxItems,
      };
      break;
    default:
      return null;
  }
  // Reject unknown configuration rather than silently dropping future semantics.
  return Object.keys(v).every((key) => Object.hasOwn(result, key))
    ? result
    : null;
}

/** Fixed key ordering, including the derived QR rendering payload. */
export function canonicalWidget(widget: WidgetSnapshot): WidgetSnapshot {
  const { layoutId, linkId, qrUrl, modules, ...configuration } = widget;
  const parsed = parseWidget(configuration);
  if (!parsed) throw new Error("Invalid widget snapshot");
  return parsed.type === "qr"
    ? { ...parsed, layoutId, linkId, qrUrl, modules }
    : parsed;
}
