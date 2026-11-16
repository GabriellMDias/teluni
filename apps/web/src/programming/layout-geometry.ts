/** Canvas geometry remains the existing freeform model; partitions are authoring aids. */
export type Geometry = { x: number; y: number; width: number; height: number };
export type Size = Pick<Geometry, "width" | "height">;
export type SplitDirection = "left" | "right" | "above" | "below";
export type ResizeEdge = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";
export const minSize = 40;
export const snap = (value: number) => Math.round(value / 10) * 10;
export const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));
const valid = (area: Geometry) =>
  [area.x, area.y, area.width, area.height].every(Number.isFinite) &&
  area.width >= minSize &&
  area.height >= minSize;

/** Preserve every original unit, including odd imported sizes. Never create a gap. */
export function splitGeometry(
  area: Geometry,
  direction: SplitDirection,
): { retained: Geometry; added: Geometry } | null {
  if (!valid(area)) return null;
  const horizontal = direction === "left" || direction === "right";
  const length = horizontal ? area.width : area.height;
  if (length < minSize * 2) return null;
  const firstLength = clamp(snap(length / 2), minSize, length - minSize);
  const rectangle = {
    x: area.x,
    y: area.y,
    width: area.width,
    height: area.height,
  };
  const first = {
    ...rectangle,
    ...(horizontal ? { width: firstLength } : { height: firstLength }),
  };
  const second = {
    ...rectangle,
    ...(horizontal
      ? { x: area.x + firstLength, width: length - firstLength }
      : { y: area.y + firstLength, height: length - firstLength }),
  };
  return direction === "left" || direction === "above"
    ? { retained: second, added: first }
    : { retained: first, added: second };
}

export function insertionGeometry(
  canvas: Size,
  point?: { x: number; y: number },
): Geometry {
  const width = Math.min(480, canvas.width);
  const height = Math.min(270, canvas.height);
  return {
    x: clamp(
      snap((point?.x ?? canvas.width / 2) - width / 2),
      0,
      canvas.width - width,
    ),
    y: clamp(
      snap((point?.y ?? canvas.height / 2) - height / 2),
      0,
      canvas.height - height,
    ),
    width,
    height,
  };
}

/** Opposite edges stay anchored, with all pointer and keyboard movement bounded. */
export function transformGeometry(
  start: Geometry,
  canvas: Size,
  edge: ResizeEdge | "move",
  dx: number,
  dy: number,
): Geometry {
  if (!valid(start) || ![dx, dy].every(Number.isFinite)) return start;
  if (edge === "move")
    return {
      ...start,
      x: clamp(snap(start.x + dx), 0, canvas.width - start.width),
      y: clamp(snap(start.y + dy), 0, canvas.height - start.height),
    };
  let { x, y, width, height } = start;
  if (edge.includes("w")) {
    x = clamp(snap(start.x + dx), 0, start.x + start.width - minSize);
    width = start.x + start.width - x;
  }
  if (edge.includes("n")) {
    y = clamp(snap(start.y + dy), 0, start.y + start.height - minSize);
    height = start.y + start.height - y;
  }
  if (edge.includes("e"))
    width = clamp(snap(start.width + dx), minSize, canvas.width - start.x);
  if (edge.includes("s"))
    height = clamp(snap(start.height + dy), minSize, canvas.height - start.y);
  return { x, y, width, height };
}
