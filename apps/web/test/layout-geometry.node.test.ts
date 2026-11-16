import { describe, expect, test } from "vitest";
import {
  insertionGeometry,
  splitGeometry,
  transformGeometry,
  type SplitDirection,
  type ResizeEdge,
} from "../src/programming/layout-geometry.js";
const canvas = { width: 1920, height: 1080 };
const area = { x: 100, y: 100, width: 501, height: 301 };
describe("layout partitions", () => {
  test.each<SplitDirection>(["left", "right", "above", "below"])(
    "keeps the original footprint when adding %s",
    (direction) => {
      const result = splitGeometry(area, direction)!;
      const parts = [result.retained, result.added];
      expect(parts.every((part) => part.width >= 40 && part.height >= 40)).toBe(
        true,
      );
      expect(
        parts.reduce((sum, part) => sum + part.width * part.height, 0),
      ).toBe(area.width * area.height);
      expect(Math.min(...parts.map((part) => part.x))).toBe(area.x);
      expect(Math.max(...parts.map((part) => part.x + part.width))).toBe(
        area.x + area.width,
      );
      expect(Math.min(...parts.map((part) => part.y))).toBe(area.y);
      expect(Math.max(...parts.map((part) => part.y + part.height))).toBe(
        area.y + area.height,
      );
      if (direction === "left")
        expect(result.added.x + result.added.width).toBe(result.retained.x);
      if (direction === "right")
        expect(result.retained.x + result.retained.width).toBe(result.added.x);
      if (direction === "above")
        expect(result.added.y + result.added.height).toBe(result.retained.y);
      if (direction === "below")
        expect(result.retained.y + result.retained.height).toBe(result.added.y);
    },
  );
  test("returns geometry without copying source identities into a new output", () => {
    const result = splitGeometry(
      { ...area, uid: "original", key: "main" } as typeof area,
      "right",
    )!;
    expect(Object.keys(result.added).sort()).toEqual([
      "height",
      "width",
      "x",
      "y",
    ]);
  });
  test("refuses undersized or incomplete numeric drafts", () => {
    expect(splitGeometry({ ...area, width: 79 }, "left")).toBeNull();
    expect(splitGeometry({ ...area, height: 79 }, "below")).toBeNull();
    expect(splitGeometry({ ...area, x: Number.NaN }, "right")).toBeNull();
    expect(splitGeometry({ ...area, width: 80 }, "right")!.added.width).toBe(
      40,
    );
  });
});
describe("manual canvas movement", () => {
  test.each<ResizeEdge>(["n", "ne", "e", "se", "s", "sw", "w", "nw"])(
    "bounds the %s resize handle and keeps the opposite edge",
    (edge) => {
      const result = transformGeometry(area, canvas, edge, -10000, -10000);
      expect(result.x).toBeGreaterThanOrEqual(0);
      expect(result.y).toBeGreaterThanOrEqual(0);
      expect(result.width).toBeGreaterThanOrEqual(40);
      expect(result.height).toBeGreaterThanOrEqual(40);
      expect(result.x + result.width).toBeLessThanOrEqual(canvas.width);
      expect(result.y + result.height).toBeLessThanOrEqual(canvas.height);
      if (edge.includes("w"))
        expect(result.x + result.width).toBe(area.x + area.width);
      if (edge.includes("n"))
        expect(result.y + result.height).toBe(area.y + area.height);
      if (edge.includes("e")) expect(result.x).toBe(area.x);
      if (edge.includes("s")) expect(result.y).toBe(area.y);
    },
  );
  test("clamps insertions and movement to either orientation", () => {
    expect(insertionGeometry(canvas, { x: -100, y: 2000 })).toEqual({
      x: 0,
      y: 810,
      width: 480,
      height: 270,
    });
    expect(
      insertionGeometry({ width: 1080, height: 1920 }, { x: 1080, y: 1920 }),
    ).toEqual({ x: 600, y: 1650, width: 480, height: 270 });
    expect(transformGeometry(area, canvas, "move", 10000, -10000)).toEqual({
      ...area,
      x: 1419,
      y: 0,
    });
    expect(transformGeometry(area, canvas, "nw", 10000, 10000)).toEqual({
      x: 561,
      y: 361,
      width: 40,
      height: 40,
    });
  });
});
