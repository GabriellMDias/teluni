import { useRef, useState, type PointerEvent, type KeyboardEvent } from "react";
import { UiIcon } from "../ui-icon.js";
import { useProgrammingMessages } from "./common.js";
import {
  insertionGeometry,
  transformGeometry,
  type Geometry,
  type Size,
  type ResizeEdge,
} from "./layout-geometry.js";

export const layoutComponentType = "application/x-teluni-layout-component";
type Kind = "media" | "catalog";
type CanvasArea = Geometry & {
  uid: string;
  name: string;
  kind: Kind;
  background: string;
  z: number;
};
const edges: ResizeEdge[] = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];

/** Schematic composition, shared by the authorized editor and read-only details. */
export function LayoutCanvas({
  name,
  canvas,
  areas,
  selected,
  flagged,
  onSelect,
  onMove,
  onGestureStart,
  onGestureEnd,
  dragging,
  onInsert,
}: {
  name: string;
  canvas: Size;
  areas: readonly CanvasArea[];
  selected?: string | null;
  flagged?: ReadonlySet<number>;
  onSelect?: (uid: string) => void;
  onMove?: (uid: string, geometry: Geometry) => void;
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
  dragging?: Kind | null;
  onInsert?: (kind: Kind, geometry: Geometry) => void;
}) {
  const { t } = useProgrammingMessages();
  const box = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<Geometry | null>(null);
  const drag = useRef<{
    uid: string;
    edge: ResizeEdge | "move";
    x: number;
    y: number;
    start: Geometry;
    last: Geometry;
  } | null>(null);
  const begin = (
    event: PointerEvent<HTMLElement>,
    area: CanvasArea,
    edge: ResizeEdge | "move",
  ) => {
    if (!onMove || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.closest("button")?.focus();
    drag.current = {
      uid: area.uid,
      edge,
      x: event.clientX,
      y: event.clientY,
      start: area,
      last: area,
    };
    onSelect?.(area.uid);
    onGestureStart?.();
  };
  const follow = (event: PointerEvent<HTMLElement>) => {
    const current = drag.current;
    const rect = box.current?.getBoundingClientRect();
    if (!current || !rect || !onMove) return;
    const next = transformGeometry(
      current.start,
      canvas,
      current.edge,
      ((event.clientX - current.x) * canvas.width) / rect.width,
      ((event.clientY - current.y) * canvas.height) / rect.height,
    );
    if (
      ["x", "y", "width", "height"].every(
        (key) =>
          next[key as keyof Geometry] === current.last[key as keyof Geometry],
      )
    )
      return;
    current.last = next;
    onMove(current.uid, next);
  };
  const end = () => {
    if (!drag.current) return;
    drag.current = null;
    onGestureEnd?.();
  };
  const keys = (event: KeyboardEvent<HTMLButtonElement>, area: CanvasArea) => {
    const step = {
      ArrowLeft: [-10, 0],
      ArrowRight: [10, 0],
      ArrowUp: [0, -10],
      ArrowDown: [0, 10],
    }[event.key];
    if (!step || !onMove) return;
    event.preventDefault();
    onMove(
      area.uid,
      transformGeometry(
        area,
        canvas,
        event.shiftKey ? "se" : "move",
        step[0],
        step[1],
      ),
    );
  };
  const style = (area: Geometry) => ({
    left: `${(area.x / canvas.width) * 100}%`,
    top: `${(area.y / canvas.height) * 100}%`,
    width: `${(area.width / canvas.width) * 100}%`,
    height: `${(area.height / canvas.height) * 100}%`,
  });
  return (
    <div
      ref={box}
      className={`layout-canvas${dragging ? " accepting-component" : ""}`}
      role="group"
      aria-label={t.layouts.canvasLabel(name)}
      style={{
        aspectRatio: `${canvas.width} / ${canvas.height}`,
        width: `min(100%, ${(70 * canvas.width) / canvas.height}vh)`,
      }}
      onDragOver={(event) => {
        if (
          !dragging ||
          !onInsert ||
          !event.dataTransfer.types.includes(layoutComponentType)
        )
          return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        const rect = event.currentTarget.getBoundingClientRect();
        setPreview(
          insertionGeometry(canvas, {
            x: ((event.clientX - rect.left) * canvas.width) / rect.width,
            y: ((event.clientY - rect.top) * canvas.height) / rect.height,
          }),
        );
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setPreview(null);
      }}
      onDrop={(event) => {
        event.preventDefault();
        const kind = event.dataTransfer.getData(layoutComponentType);
        if (onInsert && dragging && kind === dragging) {
          const rect = event.currentTarget.getBoundingClientRect();
          onInsert(
            dragging,
            insertionGeometry(canvas, {
              x: ((event.clientX - rect.left) * canvas.width) / rect.width,
              y: ((event.clientY - rect.top) * canvas.height) / rect.height,
            }),
          );
        }
        setPreview(null);
      }}
    >
      {areas.map((area, index) => {
        const label = t.layouts.areaButton(
          area.name,
          t.layouts.kinds[area.kind],
        );
        const content = (
          <>
            <span className="layout-area-label">{label}</span>
            <span className="layout-area-symbol" aria-hidden="true">
              <UiIcon name={area.kind === "media" ? "image" : "grid"} />
              <small>
                {area.width} × {area.height}
              </small>
            </span>
          </>
        );
        const areaStyle = {
          ...style(area),
          zIndex: area.z + 1,
          background: area.background,
        };
        return !onSelect ? (
          <div key={area.uid} className="layout-area" style={areaStyle}>
            {content}
          </div>
        ) : (
          <button
            key={area.uid}
            type="button"
            aria-label={label}
            className={`layout-area${area.uid === selected ? " selected" : ""}${flagged?.has(index) ? " flagged" : ""}`}
            aria-pressed={area.uid === selected}
            style={areaStyle}
            onClick={() => onSelect(area.uid)}
            onPointerDown={(event) => begin(event, area, "move")}
            onPointerMove={follow}
            onPointerUp={end}
            onPointerCancel={end}
            onLostPointerCapture={end}
            onKeyDown={(event) => keys(event, area)}
          >
            {content}
            {onMove &&
              area.uid === selected &&
              edges.map((edge) => (
                <span
                  key={edge}
                  className={`layout-area-handle handle-${edge}`}
                  data-resize={edge}
                  aria-hidden="true"
                  onPointerDown={(event) => begin(event, area, edge)}
                />
              ))}
          </button>
        );
      })}
      {dragging && preview && (
        <div
          className="layout-drop-preview"
          style={style(preview)}
          aria-hidden="true"
        >
          {t.layouts.kinds[dragging]}
        </div>
      )}
    </div>
  );
}
