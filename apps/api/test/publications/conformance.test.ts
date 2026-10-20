import { readFileSync } from "node:fs";
import { compactVerify, importJWK, type JWK } from "jose";
import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import {
  resolveLocal,
  zoneOffsets,
  type ZoneOffsets,
} from "../../src/features/programming/schedule.js";
import { manifestBytes } from "../../src/features/publications/domain.js";
import {
  statementType,
  type PublicKeySet,
  type StatementClaims,
} from "../../src/features/publications/statements.js";
import {
  conformanceManifest,
  conformanceZones,
  scheduleFixtureOffsets,
} from "./conformance.js";

// The committed player conformance fixtures must stay what the API's own
// serializer, signer and zone rules produce; the player's core tests read
// the same file. Regenerate with `pnpm -C apps/api conformance:write`.
type Fixtures = {
  manifest: { bytes: string; sha256: string };
  keys: PublicKeySet;
  statements: {
    id: string;
    jws: string;
    valid: boolean;
    claims: StatementClaims | null;
  }[];
  zones: {
    timeZone: string;
    offsets: ZoneOffsets;
    resolutions: {
      local: string;
      boundary: "start" | "end";
      instant: string;
      resolution: string | null;
    }[];
  }[];
  scheduleOffsets: Record<string, ZoneOffsets>;
};

const read = (path: string): unknown =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const fixtures = read("./conformance.json") as Fixtures;

async function verify(jws: string) {
  return compactVerify(jws, async (header) => {
    const key = fixtures.keys.keys.find((item) => item.kid === header.kid);
    if (!key) throw new Error("Unknown key");
    return importJWK(key as JWK, "ES256");
  });
}

describe("player protocol conformance fixtures", () => {
  it("hold the exact manifest bytes the API serializes", () => {
    const { header, content } = conformanceManifest;
    const manifest = manifestBytes(header, content);
    expect(fixtures.manifest.bytes).toBe(manifest.bytes.toString("utf8"));
    expect(fixtures.manifest.sha256).toBe(manifest.sha256.toString("hex"));
  });

  it("hold statements that verify, or fail, as the player must decide", async () => {
    expect(fixtures.keys.keys.map((key) => key.kid)).toEqual([
      "conformance-2",
      "conformance-1",
    ]);
    expect(fixtures.statements.map((item) => item.id)).toEqual([
      "current-key",
      "rotated-key",
      "unpublished-source",
      "tampered-payload",
    ]);
    for (const statement of fixtures.statements) {
      if (!statement.valid) {
        await expect(verify(statement.jws)).rejects.toThrow();
        continue;
      }
      const { payload, protectedHeader } = await verify(statement.jws);
      expect(protectedHeader).toMatchObject({
        alg: "ES256",
        typ: statementType,
      });
      expect(JSON.parse(new TextDecoder().decode(payload))).toEqual(
        statement.claims,
      );
    }
    const [current] = fixtures.statements;
    expect(current.claims?.publications).toEqual([
      {
        id: conformanceManifest.header.publicationId,
        sha256: fixtures.manifest.sha256,
      },
    ]);
  });

  it("hold the zone offsets and local resolutions the API computes", () => {
    expect(fixtures.zones).toHaveLength(conformanceZones.length);
    conformanceZones.forEach((zone, index) => {
      const fixture = fixtures.zones[index];
      expect(fixture.timeZone).toBe(zone.timeZone);
      expect(fixture.offsets).toEqual(
        zoneOffsets(zone.timeZone, new Date(zone.from), new Date(zone.until)),
      );
      expect(fixture.resolutions).toEqual(
        zone.locals.map(({ local, boundary }) => {
          const resolved = resolveLocal(
            Temporal.PlainDateTime.from(local),
            zone.timeZone,
            boundary,
          );
          return {
            local,
            boundary,
            instant: new Date(resolved.instant.epochMilliseconds).toISOString(),
            resolution: resolved.resolution,
          };
        }),
      );
    });
  });

  it("hold the zone offsets of every shared schedule fixture", () => {
    expect(fixtures.scheduleOffsets).toEqual(
      scheduleFixtureOffsets(
        read("../programming/schedule-fixtures.json") as Parameters<
          typeof scheduleFixtureOffsets
        >[0],
      ),
    );
  });
});

describe("zone offsets", () => {
  it("start with the offset at the range's start and add each transition", () => {
    expect(
      zoneOffsets(
        "Europe/Lisbon",
        new Date("2027-03-01T00:00:00.000Z"),
        new Date("2027-11-30T00:00:00.000Z"),
      ),
    ).toEqual({
      until: "2027-11-30T00:00:00.000Z",
      periods: [
        { from: "2027-03-01T00:00:00.000Z", offsetSeconds: 0 },
        { from: "2027-03-28T01:00:00.000Z", offsetSeconds: 3600 },
        { from: "2027-10-31T01:00:00.000Z", offsetSeconds: 0 },
      ],
    });
  });

  it("exclude a transition at the end of the range", () => {
    expect(
      zoneOffsets(
        "Europe/Lisbon",
        new Date("2027-03-01T00:00:00.000Z"),
        new Date("2027-03-28T01:00:00.000Z"),
      ).periods,
    ).toEqual([{ from: "2027-03-01T00:00:00.000Z", offsetSeconds: 0 }]);
  });
});
