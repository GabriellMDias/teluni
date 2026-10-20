// Writes the player protocol conformance fixtures of the player design
// (docs/project/player-design.md#server-additions) from the API's own
// serializer, signer and zone rules: a protocol 1 manifest as exact bytes,
// statements signed by throwaway keys whose private halves are discarded
// (in flattened JWS JSON serialization),
// zone offsets with local-time resolutions, and the zone offsets of every
// shared schedule fixture. test/publications/conformance.test.ts verifies
// the committed file against the same code; the player's core tests read it.
import { generateKeyPairSync } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import prettier from "prettier";
import { Temporal } from "temporal-polyfill";
import {
  conformanceManifest,
  conformanceZones,
  scheduleFixtureOffsets,
} from "../test/publications/conformance.js";
import { manifestBytes } from "../src/features/publications/domain.js";
import {
  publicKeySet,
  signStatement,
  type SigningKey,
  type StatementClaims,
} from "../src/features/publications/statements.js";
import {
  resolveLocal,
  zoneOffsets,
} from "../src/features/programming/schedule.js";

const target = resolve(
  import.meta.dirname,
  "../test/publications/conformance.json",
);
const scheduleFixtures = resolve(
  import.meta.dirname,
  "../test/programming/schedule-fixtures.json",
);

const key = (id: string): SigningKey => ({
  id,
  privateKey: generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey,
});

const { header, content } = conformanceManifest;
const manifest = manifestBytes(header, content);
const sha256 = manifest.sha256.toString("hex");
const newest = key("conformance-2");
const older = key("conformance-1");
const iat = Date.UTC(2026, 9, 20, 12, 0, 0) / 1000;
const claims: StatementClaims = {
  sub: "6f0c2d0e-3c55-4c8e-9a43-2b1f0f9d7a10",
  company: header.companyId,
  iat,
  exp: iat + 7 * 24 * 60 * 60,
  publications: [{ id: header.publicationId, sha256 }],
};
const current = await signStatement([newest, older], claims);
const rotated = await signStatement([older], claims);
const empty = await signStatement([newest], { ...claims, publications: [] });
const [protectedHeader, , signature] = current.split(".");
const tampered = [
  protectedHeader,
  Buffer.from(
    JSON.stringify({ ...claims, exp: claims.exp + 24 * 60 * 60 }),
  ).toString("base64url"),
  signature,
].join(".");

function flattened(jws: string) {
  const [protectedHeader, payload, signature] = jws.split(".");
  return { protected: protectedHeader, payload, signature };
}

const zones = conformanceZones.map((zone) => ({
  timeZone: zone.timeZone,
  offsets: zoneOffsets(
    zone.timeZone,
    new Date(zone.from),
    new Date(zone.until),
  ),
  resolutions: zone.locals.map(({ local, boundary }) => {
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
}));

const fixtures = {
  description:
    "Player protocol conformance fixtures (docs/project/player-design.md#server-additions), written by apps/api/scripts/conformance.ts from the API's serializer, signer and zone rules and verified by apps/api/test/publications/conformance.test.ts. The keys are throwaway test keys whose private halves were discarded. Do not edit by hand.",
  version: 1,
  manifest: {
    header: { ...header, publishedAt: header.publishedAt.toISOString() },
    content,
    bytes: manifest.bytes.toString("utf8"),
    sha256,
  },
  keys: await publicKeySet([newest, older]),
  // Flattened JWS JSON serialization (RFC 7515, section 7.2.2): the compact
  // form a screen receives is `protected.payload.signature`. Kept apart so
  // secret scanners do not report these test vectors as live tokens.
  statements: [
    { id: "current-key", ...flattened(current), valid: true, claims },
    { id: "rotated-key", ...flattened(rotated), valid: true, claims },
    {
      id: "unpublished-source",
      ...flattened(empty),
      valid: true,
      claims: { ...claims, publications: [] },
    },
    {
      id: "tampered-payload",
      ...flattened(tampered),
      valid: false,
      claims: null,
    },
  ],
  zones,
  scheduleOffsets: scheduleFixtureOffsets(
    JSON.parse(await readFile(scheduleFixtures, "utf8")) as Parameters<
      typeof scheduleFixtureOffsets
    >[0],
  ),
};

const text = await prettier.format(JSON.stringify(fixtures), {
  ...(await prettier.resolveConfig(target)),
  filepath: target,
});
await writeFile(target, text);
console.log(`Wrote ${target}`);
