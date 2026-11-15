import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { normalizeLogo } from "../../src/features/organizations/logo.js";
import {
  resolveLocation,
  searchLocations,
} from "../../src/features/organizations/locations.js";

const encode = (bytes: Buffer) =>
  `data:image/png;base64,${bytes.toString("base64")}`;

describe("company logo admission", () => {
  it("decodes and normalizes a bounded PNG and supports removal", () => {
    const image = new PNG({ width: 32, height: 16 });
    image.data.fill(127);
    const normalized = normalizeLogo(encode(PNG.sync.write(image)))!;
    expect(
      PNG.sync.read(Buffer.from(normalized.split(",")[1], "base64")),
    ).toMatchObject({ width: 32, height: 16 });
    expect(normalizeLogo(null)).toBeNull();
  });

  it("rejects URLs, SVG, oversized headers, CRC corruption and truncated files", () => {
    const bytes = PNG.sync.write(new PNG({ width: 2, height: 2 }));
    const huge = Buffer.from(bytes);
    huge.writeUInt32BE(100000, 16);
    const corrupt = Buffer.from(bytes);
    corrupt[29] ^= 1;
    const interlaced = Buffer.from(bytes);
    interlaced[28] = 1;
    const duplicated = Buffer.concat([
      bytes.subarray(0, 33),
      bytes.subarray(8),
    ]);
    for (const value of [
      "https://example.test/logo.png",
      "data:image/svg+xml;base64,PHN2Zz4=",
      encode(huge),
      encode(corrupt),
      encode(bytes.subarray(0, 30)),
      encode(interlaced),
      encode(duplicated),
    ])
      expect(() => normalizeLogo(value)).toThrow(
        expect.objectContaining({ code: "VALIDATION_FAILED" }),
      );
  });
});

describe("branch city catalog", () => {
  it("ships the catalog snapshot recorded by the source manifest", () => {
    const bytes = readFileSync(
      new URL(
        "../../src/features/organizations/locations.tsv.gz",
        import.meta.url,
      ),
    );
    const source = JSON.parse(
      readFileSync(
        new URL(
          "../../src/features/organizations/locations-source.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as { count: number; sha256: string };
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      source.sha256,
    );
    expect(
      gunzipSync(bytes).toString("utf8").trimEnd().split("\n"),
    ).toHaveLength(source.count);
  });

  it("finds accent-insensitive names with regional disambiguation and bounds results", () => {
    const found = searchLocations("sao paulo BR");
    expect(found.some((item) => item.id === "3448439")).toBe(true);
    expect(
      searchLocations("São Paulo Brasil").some((item) => item.id === "3448439"),
    ).toBe(true);
    expect(searchLocations("sa").length).toBeLessThanOrEqual(20);
    expect(searchLocations(" ")).toEqual([]);
  });
  it("derives IANA zones from exact map points and rejects invalid or ambiguous coordinates", () => {
    expect(
      resolveLocation({ latitude: -23.55052, longitude: -46.633308 }),
    ).toMatchObject({
      location: { latitude: -23.55052, longitude: -46.633308 },
      timeZone: "America/Sao_Paulo",
    });
    expect(
      resolveLocation({ latitude: -3.119028, longitude: -60.021731 }),
    ).toMatchObject({ timeZone: "America/Manaus" });
    expect(() => resolveLocation({ latitude: 91, longitude: 0 })).toThrow(
      expect.objectContaining({ code: "VALIDATION_FAILED" }),
    );
    expect(() => resolveLocation({ latitude: NaN, longitude: 0 })).toThrow(
      expect.objectContaining({ code: "VALIDATION_FAILED" }),
    );
    expect(() =>
      resolveLocation({ latitude: 43.839319, longitude: 87.526148 }),
    ).toThrow(
      expect.objectContaining({ code: "LOCATION_TIME_ZONE_UNRESOLVED" }),
    );
  });
});
