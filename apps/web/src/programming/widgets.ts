import type { AreaInput } from "./api.js";
import type { Locale } from "../locale.js";
import { widgetMessages } from "./widget-messages.js";
export type Widget = NonNullable<AreaInput["widget"]>;
export type WidgetType = Widget["type"];
export type LayoutComponent = "media" | "catalog" | WidgetType;
export const layoutComponents = [
  "media",
  "catalog",
  "clock",
  "qr",
  "ticker",
  "weather",
  "rss",
] as const;
export const widgetTypes = ["clock", "qr", "ticker", "weather", "rss"] as const;
export function defaultWidget(type: WidgetType, locale: Locale): Widget {
  const base = {
    version: 1 as const,
    locale,
    textSize: 48,
    foreground: "#FFFFFF",
  };
  const t = widgetMessages[locale];
  switch (type) {
    case "clock":
      return {
        ...base,
        type,
        showTime: true,
        showDate: true,
        seconds: false,
        hour12: false,
        dateStyle: "long",
      };
    case "qr":
      return { ...base, type, targetUrl: "", caption: "" };
    case "ticker":
      return { ...base, type, text: t.defaultTicker, speed: 60 };
    case "weather":
      return {
        ...base,
        type,
        latitude: Number.NaN,
        longitude: Number.NaN,
        label: t.defaultWeather,
        units: "celsius",
      };
    case "rss":
      return {
        ...base,
        type,
        feedUrl: "",
        title: t.defaultNews,
        itemSeconds: 10,
        maxItems: 5,
      };
  }
}
