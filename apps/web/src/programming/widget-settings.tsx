import { useEffect, useState, type CSSProperties } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, TextField } from "../components.js";
import { UiIcon } from "../ui-icon.js";
import { listBranchChoices } from "../organizations/api.js";
import {
  previewWidget,
  type Layout,
  type WidgetLive,
  type WidgetPreview,
} from "./api.js";
import { Failure, useProgrammingMessages } from "./common.js";
import { widgetMessages } from "./widget-messages.js";
import type { Widget } from "./widgets.js";

/** Configuration-only face in the schematic canvas; live data is loaded explicitly in the inspector. */
export function WidgetFace({
  widget,
  width,
  live,
  modules,
}: {
  widget: Widget;
  width: number;
  live?: WidgetLive;
  modules?: string[];
}) {
  const [now, setNow] = useState(() => new Date());
  const { locale } = useProgrammingMessages();
  const t = widgetMessages[locale];
  useEffect(() => {
    if (widget.type !== "clock" && widget.type !== "rss") return;
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, [widget.type]);
  let main: string,
    secondary = "",
    footer = "";
  if (widget.type === "clock") {
    const time = widget.showTime
      ? new Intl.DateTimeFormat(widget.locale, {
          hour: "2-digit",
          minute: "2-digit",
          ...(widget.seconds ? { second: "2-digit" } : {}),
          hour12: widget.hour12,
        }).format(now)
      : "";
    const date = widget.showDate
      ? new Intl.DateTimeFormat(widget.locale, {
          dateStyle: widget.dateStyle === "long" ? "full" : "short",
        }).format(now)
      : "";
    main = time || date;
    secondary = time ? date : "";
  } else if (widget.type === "qr") {
    main = widget.caption;
  } else if (widget.type === "ticker") {
    main = widget.text;
  } else if (widget.type === "weather") {
    const data = live?.data?.type === "weather" ? live.data : undefined;
    main = data
      ? `${Math.round(widget.units === "celsius" ? data.temperatureC : (data.temperatureC * 9) / 5 + 32)}°${widget.units === "celsius" ? "C" : "F"}`
      : t.names.weather;
    secondary = widget.label;
    footer = data ? "MET Norway · CC BY 4.0" : "";
  } else {
    const data = live?.data?.type === "rss" ? live.data : undefined;
    const index = data?.items.length
      ? Math.floor(now.getTime() / 1000 / widget.itemSeconds) %
        data.items.length
      : 0;
    main = data?.items[index]?.title ?? widget.title;
    secondary = data ? widget.title : t.names.rss;
    footer = data?.source ?? "";
  }
  const size = (widget.textSize / width) * 100;
  return (
    <span
      className={`widget-face widget-${widget.type}`}
      style={
        {
          color: widget.foreground,
          "--widget-size": `${size}cqw`,
        } as CSSProperties
      }
    >
      {widget.type === "qr" ? (
        <>
          {modules ? (
            <svg
              className="widget-qr-code"
              viewBox={`0 0 ${modules.length + 8} ${modules.length + 8}`}
              role="img"
              aria-label={t.names.qr}
              shapeRendering="crispEdges"
            >
              <rect width="100%" height="100%" fill="white" />
              <path
                fill="black"
                d={modules
                  .flatMap((row, y) =>
                    [...row].flatMap((cell, x) =>
                      cell === "1" ? [`M${x + 4} ${y + 4}h1v1h-1z`] : [],
                    ),
                  )
                  .join("")}
              />
            </svg>
          ) : (
            <span className="widget-qr-placeholder">
              <UiIcon name="qr" />
            </span>
          )}
          {main && <span className="widget-secondary">{main}</span>}
        </>
      ) : (
        <>
          <strong className="widget-primary">{main}</strong>
          {secondary && <span className="widget-secondary">{secondary}</span>}
          {footer && <small className="widget-footer">{footer}</small>}
        </>
      )}
    </span>
  );
}

export function WidgetSettings({
  companyId,
  layout,
  areaKey,
  widget,
  background,
  onChange,
}: {
  companyId: string;
  layout: Layout;
  areaKey: string;
  widget: Widget;
  background: string;
  onChange: (widget: Widget) => void;
}) {
  const { locale } = useProgrammingMessages();
  const t = widgetMessages[locale];
  const id = `widget-${areaKey}`;
  const serialized = JSON.stringify(widget);
  const preview = useMutation({
    mutationFn: () =>
      previewWidget(companyId, {
        layoutId: layout.id,
        branchId: layout.branch?.id ?? null,
        areaKey,
        widget,
      }),
    mutationKey: ["widget-preview", layout.id, areaKey, serialized],
  });
  const [shown, setShown] = useState<{
    input: string;
    data: WidgetPreview;
  } | null>(null);
  const branches = useQuery({
    queryKey: ["organizations", "branches", "choices", companyId],
    queryFn: () => listBranchChoices(companyId),
    enabled: widget.type === "weather",
  });
  const patch = (value: Partial<Widget>) =>
    onChange({ ...widget, ...value } as Widget);
  const numeric = (
    key: "latitude" | "longitude" | "textSize" | "itemSeconds" | "maxItems",
    label: string,
    value: number,
    min: number,
    max: number,
    step = 1,
  ) => (
    <TextField
      label={label}
      id={`${id}-${key}`}
      type="number"
      required
      min={min}
      max={max}
      step={step}
      value={Number.isFinite(value) ? value : ""}
      onChange={(event) =>
        patch({
          [key]:
            event.target.value === "" ? Number.NaN : Number(event.target.value),
        })
      }
    />
  );
  const check = (
    key: "showTime" | "showDate" | "seconds" | "hour12",
    label: string,
    value: boolean,
  ) => (
    <label className="checkbox-row">
      <input
        type="checkbox"
        checked={value}
        onChange={(event) => patch({ [key]: event.target.checked })}
      />
      {label}
    </label>
  );
  const data = shown?.input === serialized ? shown.data : undefined;
  return (
    <div className="form-stack widget-settings">
      <h4>{t.settings}</h4>
      {widget.type === "clock" && (
        <>
          {check("showTime", t.showTime, widget.showTime)}
          {check("showDate", t.showDate, widget.showDate)}
          {check("seconds", t.seconds, widget.seconds)}
          {check("hour12", t.hour12, widget.hour12)}
          <label htmlFor={`${id}-date`}>{t.dateStyle}</label>
          <select
            id={`${id}-date`}
            value={widget.dateStyle}
            onChange={(event) =>
              patch({ dateStyle: event.target.value as "short" | "long" })
            }
          >
            <option value="short">{t.short}</option>
            <option value="long">{t.long}</option>
          </select>
          <p className="hint">{t.clockHint}</p>
        </>
      )}
      {widget.type === "qr" && (
        <>
          <TextField
            label={t.target}
            id={`${id}-url`}
            type="url"
            required
            maxLength={2048}
            value={widget.targetUrl}
            onChange={(event) => patch({ targetUrl: event.target.value })}
          />
          <TextField
            label={t.caption}
            id={`${id}-caption`}
            maxLength={120}
            value={widget.caption}
            onChange={(event) => patch({ caption: event.target.value })}
          />
          <p className="hint">{t.qrHint}</p>
        </>
      )}
      {widget.type === "ticker" && (
        <>
          <label htmlFor={`${id}-text`}>{t.text}</label>
          <textarea
            id={`${id}-text`}
            required
            maxLength={2000}
            rows={4}
            value={widget.text}
            onChange={(event) => patch({ text: event.target.value })}
          />
          <label htmlFor={`${id}-speed`}>
            {t.speed}: {widget.speed}
          </label>
          <input
            id={`${id}-speed`}
            type="range"
            min={20}
            max={160}
            step={5}
            value={widget.speed}
            onChange={(event) => patch({ speed: Number(event.target.value) })}
          />
          <div className="widget-range-labels">
            <small>{t.slower}</small>
            <small>{t.faster}</small>
          </div>
        </>
      )}
      {widget.type === "weather" && (
        <>
          <label htmlFor={`${id}-branch`}>{t.branchLocation}</label>
          <select
            id={`${id}-branch`}
            value=""
            onChange={(event) => {
              const branch = branches.data?.items.find(
                (entry) => entry.id === event.target.value,
              );
              if (branch?.location)
                patch({
                  latitude: branch.location.latitude,
                  longitude: branch.location.longitude,
                  label: branch.name,
                });
            }}
          >
            <option value="">{t.chooseBranch}</option>
            {branches.data?.items
              .filter((branch) => branch.location)
              .map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
          </select>
          {branches.error && (
            <Failure error={branches.error} operation="read" />
          )}
          <TextField
            label={t.location}
            id={`${id}-location`}
            required
            maxLength={80}
            value={widget.label}
            onChange={(event) => patch({ label: event.target.value })}
          />
          {numeric("latitude", t.latitude, widget.latitude, -90, 90, 0.0001)}
          {numeric(
            "longitude",
            t.longitude,
            widget.longitude,
            -180,
            180,
            0.0001,
          )}
          <label htmlFor={`${id}-units`}>{t.units}</label>
          <select
            id={`${id}-units`}
            value={widget.units}
            onChange={(event) =>
              patch({ units: event.target.value as "celsius" | "fahrenheit" })
            }
          >
            <option value="celsius">°C</option>
            <option value="fahrenheit">°F</option>
          </select>
          <a
            className="hint"
            href="https://api.met.no/doc/License"
            target="_blank"
            rel="noopener noreferrer"
          >
            MET Norway · CC BY 4.0
          </a>
        </>
      )}
      {widget.type === "rss" && (
        <>
          <TextField
            label={t.feed}
            id={`${id}-feed`}
            type="url"
            required
            maxLength={2048}
            value={widget.feedUrl}
            onChange={(event) => patch({ feedUrl: event.target.value })}
          />
          <TextField
            label={t.title}
            id={`${id}-title`}
            required
            maxLength={80}
            value={widget.title}
            onChange={(event) => patch({ title: event.target.value })}
          />
          {numeric("itemSeconds", t.itemSeconds, widget.itemSeconds, 5, 120)}
          {numeric("maxItems", t.maxItems, widget.maxItems, 1, 20)}
          <p className="hint">{t.rssHint}</p>
        </>
      )}
      <label htmlFor={`${id}-locale`}>{t.locale}</label>
      <select
        id={`${id}-locale`}
        value={widget.locale}
        onChange={(event) =>
          patch({ locale: event.target.value as Widget["locale"] })
        }
      >
        <option value="pt-BR">Português (Brasil)</option>
        <option value="en-US">English (US)</option>
      </select>
      {numeric("textSize", t.textSize, widget.textSize, 24, 200)}
      <label htmlFor={`${id}-foreground`}>{t.foreground}</label>
      <input
        id={`${id}-foreground`}
        type="color"
        value={widget.foreground.toLowerCase()}
        onChange={(event) =>
          patch({ foreground: event.target.value.toUpperCase() })
        }
      />
      <p className="hint">{t.previewHint}</p>
      {(widget.type === "qr" ||
        widget.type === "weather" ||
        widget.type === "rss") && (
        <Button
          disabled={preview.isPending}
          onClick={() => {
            const input = serialized;
            preview.mutate(undefined, {
              onSuccess: (value) => setShown({ input, data: value }),
            });
          }}
        >
          {preview.isPending ? t.loading : t.preview}
        </Button>
      )}
      {preview.error && <Failure error={preview.error} operation="read" />}
      {data && (
        <>
          <div className="widget-loaded-preview" style={{ background }}>
            <WidgetFace
              widget={widget}
              width={700}
              live={data.live}
              modules={data.widget.modules}
            />
          </div>
          {data.live.status === "stale" && <p className="hint">{t.stale}</p>}
          {(widget.type === "weather" || widget.type === "rss") &&
            data.live.status === "unavailable" && (
              <p role="status" className="hint">
                {t.unavailable}
              </p>
            )}
        </>
      )}
    </div>
  );
}
