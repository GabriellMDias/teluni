import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compactVerify, createLocalJWKSet, type JSONWebKeySet } from "jose";
import pg from "pg";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createDatabase, type Database } from "../../src/database.js";
import { createDevicesModule } from "../../src/features/devices/module.js";
import type { HumanSessionPort } from "../../src/features/identity/public.js";
import { createMediaModule } from "../../src/features/media/module.js";
import { createOrganizationsModule } from "../../src/features/organizations/module.js";
import { createCatalogsModule } from "../../src/features/catalogs/module.js";
import { createProgrammingModule } from "../../src/features/programming/module.js";
import { createPublicationsModule } from "../../src/features/publications/module.js";
import type { DevicePort } from "../../src/features/devices/public.js";
import type { MediaReferenceGuard } from "../../src/features/media/public.js";
import type { CompanyAccessPort } from "../../src/features/organizations/public.js";
import type { PriceChangeListener } from "../../src/features/catalogs/public.js";
import { companyAccess } from "../../src/features/organizations/domain.js";
import type { PublicationFacts } from "../../src/features/programming/public.js";
import { activateModules, type ApiModule } from "../../src/module.js";
import { withMigratedDatabase } from "../../scripts/migrated-database.js";
import { createFixtures, type Fixtures } from "../media/fixtures.js";

// Two-company suite of the publication and synchronization design against
// PostgreSQL, with the real organizations, devices, media and programming
// modules and simulated screens. A synthetic session port stands in for the
// identity module so tests choose the verified principal and assurance.
type App = ReturnType<typeof createApp>["app"];
let app: App;
let sql: pg.Client;
let database: Database;
let release: () => void;
let stopped: Promise<void>;
let root: string;
let fixtures: Fixtures;
let media: ReturnType<typeof createMediaModule>;
let publications: ReturnType<typeof createPublicationsModule>;

const people = {
  aAdmin: randomUUID(),
  aManager: randomUUID(),
  aOperator: randomUUID(),
  aPublisher: randomUUID(),
  bAdmin: randomUUID(),
};
type Person = keyof typeof people;

const sessions: HumanSessionPort = {
  authenticate: ({ headers }) => {
    const principalId = headers["x-test-principal"] as string | undefined;
    if (!principalId)
      return Promise.reject(
        Object.assign(new Error("no session"), { code: "AUTH" }),
      );
    return Promise.resolve({
      principalId,
      sessionId: randomUUID(),
      assuranceLevel: "teluni-aal1",
      authenticatedAt: new Date(),
      authenticationAgeSeconds: 1,
      scopes: new Set(),
    });
  },
};
const identityStub: ApiModule = {
  name: "identity",
  tag: "Identity",
  requires: [],
  operations: [],
  errors: {},
  activate: () => ({ name: "identity", register: () => undefined }),
};

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "teluni-publications-"));
  fixtures = await createFixtures(await mkdtemp(join(tmpdir(), "fixtures-")));
  let ready!: () => void;
  const started = new Promise<void>((resolve) => (ready = resolve));
  stopped = withMigratedDatabase(async (runtimeUrl, migrationUrl) => {
    sql = new pg.Client({ connectionString: migrationUrl });
    await sql.connect();
    for (const [name, id] of Object.entries(people))
      await sql.query(
        "INSERT INTO principals (id, issuer, subject) VALUES ($1, 'https://issuer.example.test/realms/teluni', $2)",
        [id, name],
      );
    database = createDatabase(runtimeUrl);
    const limits = { requests: { max: 10_000, timeWindow: 60_000 } };
    const organizations = createOrganizationsModule({
      sessions,
      profiles: { getMany: () => Promise.resolve([]) },
      rateLimit: { max: 10_000, timeWindow: 60_000 },
    });
    const devices = createDevicesModule({
      sessions,
      companies: organizations.companies,
      limits: { ...limits, enrollmentStarts: limits.requests },
    });
    media = createMediaModule({
      sessions,
      companies: organizations.companies,
      limits,
      manual: true,
    });
    const catalogs = createCatalogsModule({
      sessions,
      companies: organizations.companies,
      media: media.media,
      limits,
    });
    const programming = createProgrammingModule({
      sessions,
      companies: organizations.companies,
      devices: devices.devices,
      media: media.media,
      catalogs: catalogs.catalogs,
      limits,
    });
    publications = createPublicationsModule({
      sessions,
      companies: organizations.companies,
      devices: devices.devices,
      media: media.media,
      programming: programming.programming,
      catalogs: catalogs.catalogs,
      limits: { ...limits, devices: limits.requests },
      manual: true,
    });
    const modules = activateModules(
      [
        identityStub,
        organizations.module,
        devices.module,
        media.module,
        catalogs.module,
        programming.module,
        publications.module,
      ],
      {
        database,
        deviceEnrollment: {
          codeKeys: [{ id: "current", key: randomBytes(32) }],
        },
        mediaStorage: {
          environment: "test",
          root,
          ffmpegPath: "ffmpeg",
          ffprobePath: "ffprobe",
          concurrency: 2,
        },
        syncSigning: {
          keys: [
            {
              id: "test-1",
              privateKey: generateKeyPairSync("ec", { namedCurve: "P-256" })
                .privateKey,
            },
          ],
        },
      },
      "test",
    );
    expect(modules.map((module) => module.name)).toContain("publications");
    ({ app } = createApp(pino({ level: "silent" }), undefined, { modules }));
    await app.ready();
    ready();
    await new Promise<void>((resolve) => (release = resolve));
    await app.close();
    await database.$disconnect();
    await sql.end();
  });
  await Promise.race([started, stopped]);
}, 300_000);

afterAll(async () => {
  release?.();
  await stopped;
  await rm(root, { recursive: true, force: true });
}, 60_000);

type Body = Record<string, unknown> & {
  id: string;
  version: number;
  error?: { code: string };
};
type Result = { status: number; body: Body };

async function call(
  person: Person | null,
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  url: string,
  options: {
    body?: unknown;
    bytes?: Buffer;
    headers?: Record<string, string>;
  } = {},
): Promise<Result> {
  const response = await app.inject({
    method,
    url,
    headers: {
      ...(person
        ? {
            "x-test-principal": people[person],
            // Administrator, manager and publisher grants need two-step
            // verification.
          }
        : {}),
      ...(options.bytes ? { "content-type": "application/octet-stream" } : {}),
      ...options.headers,
    },
    ...(options.bytes
      ? { payload: options.bytes }
      : options.body === undefined
        ? {}
        : { payload: options.body as object }),
  });
  return {
    status: response.statusCode,
    body: response.statusCode === 204 ? ({} as Body) : response.json<Body>(),
  };
}

const code = (result: Result) => result.body.error?.code;

async function createCompany(person: Person, displayName: string) {
  const created = await app.inject({
    method: "POST",
    url: "/companies",
    headers: {
      "x-test-principal": people[person],
      "idempotency-key": `key-${randomUUID()}`,
    },
    payload: {
      displayName,
      defaultLocale: "pt-BR",
      timeZone: "America/Sao_Paulo",
    },
  });
  expect(created.statusCode).toBe(201);
  return created.json<{ company: { id: string } }>().company.id;
}

async function createBranch(person: Person, companyId: string, name: string) {
  const created = await call(
    person,
    "POST",
    `/companies/${companyId}/branches`,
    { body: { name } },
  );
  expect(created.status).toBe(201);
  return created.body;
}

async function membership(person: Person, companyId: string) {
  const id = randomUUID();
  await sql.query(
    "INSERT INTO memberships (id, company_id, principal_id) VALUES ($1, $2, $3)",
    [id, companyId, people[person]],
  );
  return id;
}

async function grantBranches(
  person: Person,
  companyId: string,
  authority: { role: "BRANCH_MANAGER" | "OPERATOR" } | { profileId: string },
  branchIds: string[],
) {
  const grant = randomUUID();
  await sql.query(
    "INSERT INTO membership_grants (id, company_id, membership_id, role, profile_id, scope) VALUES ($1, $2, $3, $4, $5, 'BRANCHES')",
    [
      grant,
      companyId,
      await membership(person, companyId),
      "role" in authority ? authority.role : null,
      "profileId" in authority ? authority.profileId : null,
    ],
  );
  for (const branchId of branchIds)
    await sql.query(
      "INSERT INTO membership_grant_branches (company_id, grant_id, branch_id) VALUES ($1, $2, $3)",
      [companyId, grant, branchId],
    );
}

/** Uploads and processes an image or video, returning its ID. */
async function ready(
  companyId: string,
  file: string,
  branchId: string | null,
  person: Person = "aAdmin",
): Promise<string> {
  const bytes = await readFile(file);
  const created = await call(person, "POST", `/companies/${companyId}/media`, {
    body: {
      name: file.split("/").pop(),
      branchId,
      contentType: file.endsWith(".mp4") ? "video/mp4" : "image/png",
      size: bytes.length,
    },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const sent = await call(
    person,
    "PUT",
    `/companies/${companyId}/media/${created.body.id}/content`,
    { bytes },
  );
  expect(sent.status, JSON.stringify(sent.body)).toBe(200);
  while ((await media.runOnce()) > 0);
  return created.body.id;
}

type Screen = Readonly<{
  id: string;
  version: number;
  call(
    method: "GET" | "POST",
    url: string,
    options?: { body?: unknown; headers?: Record<string, string> },
  ): Promise<{
    status: number;
    headers: Record<string, unknown>;
    raw: Buffer;
    json<T = Body>(): T;
  }>;
}>;

/** Enrolls a simulated screen with its own credential and pairs it. */
async function screen(
  companyId: string,
  branchId: string,
  name: string,
  pairer: Person = "aAdmin",
): Promise<Screen> {
  const credential = randomBytes(32);
  const started = await call(null, "POST", "/device-enrollments", {
    body: {
      credentialHash: createHash("sha256")
        .update(credential)
        .digest("base64url"),
      report: {
        appVersion: "1.0.0",
        protocolVersion: 1,
        manufacturer: "Test",
        model: "TV 1",
        osVersion: "12",
        display: { width: 1920, height: 1080 },
        rotations: [0],
      },
    },
  });
  expect(started.status).toBe(201);
  const paired = await call(pairer, "POST", `/companies/${companyId}/devices`, {
    body: { userCode: started.body.userCode, name, branchId, rotation: 0 },
  });
  expect(paired.status, JSON.stringify(paired.body)).toBe(201);
  return {
    id: paired.body.id,
    version: paired.body.version,
    async call(method, url, options = {}) {
      const response = await app.inject({
        method,
        url,
        headers: {
          authorization: `Bearer ${credential.toString("base64url")}`,
          ...options.headers,
        },
        ...(options.body === undefined
          ? {}
          : { payload: options.body as object }),
      });
      return {
        status: response.statusCode,
        headers: response.headers,
        raw: response.rawPayload,
        json: <T = Body>() => response.json<T>(),
      };
    },
  };
}

type Report = {
  protocols: number[];
  appVersion: string;
  active: { publicationId: string; activatedAt: string } | null;
  recovery: { publicationId: string } | null;
  staging: {
    publicationId: string;
    state: "DOWNLOADING" | "VERIFYING" | "READY" | "FAILED";
    failure: string | null;
    bytesDone: number;
    bytesTotal: number;
  } | null;
  playback: string;
  storage: { freeBytes: number; totalBytes: number } | null;
  deviceTime: string | null;
  diagnostics?: {
    clock: "ANCHORED" | "ESTIMATED" | "UNTRUSTED";
    systemSkewMillis: number | null;
    crashCount: number | null;
  } | null;
};

const idle: Report = {
  protocols: [1],
  appVersion: "1.0.0",
  active: null,
  recovery: null,
  staging: null,
  playback: "SETUP",
  storage: { freeBytes: 6e9, totalBytes: 8e9 },
  deviceTime: null,
};

async function sync(device: Screen, report: Partial<Report> = {}) {
  const response = await device.call("POST", "/device/sync", {
    body: { ...idle, ...report },
  });
  return { status: response.status, body: response.json() };
}

let keySet: ReturnType<typeof createLocalJWKSet>;

/** Verifies a statement as the player does, with the pinned key set. */
async function verified(statement: unknown, keys = keySet) {
  const { payload, protectedHeader } = await compactVerify(
    statement as string,
    keys,
  );
  expect(protectedHeader.typ).toBe("teluni-authorization+jws");
  return JSON.parse(new TextDecoder().decode(payload)) as {
    sub: string;
    company: string;
    iat: number;
    exp: number;
    publications: { id: string; sha256: string }[];
  };
}

const everyDay = [1, 2, 3, 4, 5, 6, 7];
const morning = {
  weekdays: everyDay,
  allDay: false,
  startTime: "08:00",
  endTime: "12:00",
  startsOn: "2027-01-04",
};

describe("publications: publishing, synchronization and retention", () => {
  let companyA: string;
  let companyB: string;
  let a1: Body;
  let a2: Body;
  let png: string;
  let video: string;
  let a1Png: string;
  let base: string;

  beforeAll(async () => {
    companyA = await createCompany("aAdmin", "Lanchonete A");
    companyB = await createCompany("bAdmin", "Clínica B");
    a1 = await createBranch("aAdmin", companyA, "Centro");
    a2 = await createBranch("aAdmin", companyA, "Bairro");
    await grantBranches("aManager", companyA, { role: "BRANCH_MANAGER" }, [
      a1.id,
    ]);
    await grantBranches("aOperator", companyA, { role: "OPERATOR" }, [a1.id]);
    png = await ready(companyA, fixtures.pngAlpha, null);
    video = await ready(companyA, fixtures.videoCompliant, null);
    a1Png = await ready(companyA, fixtures.pngAlpha, a1.id);
    base = `/companies/${companyA}/programming`;
  }, 300_000);

  it("stores bounded player diagnostics without trusting them or retaining stale legacy values", async () => {
    const tv = await screen(companyA, a1.id, "Diagnostics");
    const path = `/companies/${companyA}/devices/${tv.id}/sync-state`;
    expect((await sync(tv)).status).toBe(200);
    expect((await call("aAdmin", "GET", path)).body).toMatchObject({
      reported: { diagnostics: null },
    });
    const diagnostics = {
      clock: "ANCHORED" as const,
      systemSkewMillis: -Number.MAX_SAFE_INTEGER,
      crashCount: 2_147_483_647,
    };
    const answer = await sync(tv, { diagnostics });
    expect(answer.status).toBe(200);
    const keys = createLocalJWKSet(
      (await tv.call("GET", "/device/keys")).json<JSONWebKeySet>(),
    );
    const statement = await verified(answer.body.authorization, keys);
    expect(statement.exp - statement.iat).toBe(7 * 86_400);
    expect((await call("aAdmin", "GET", path)).body).toMatchObject({
      reported: { diagnostics },
    });
    expect(
      code(
        await call(
          "bAdmin",
          "GET",
          `/companies/${companyB}/devices/${tv.id}/sync-state`,
        ),
      ),
    ).toBe("RESOURCE_NOT_FOUND");
    await sync(tv, {
      diagnostics: {
        clock: "ESTIMATED",
        systemSkewMillis: null,
        crashCount: null,
      },
    });
    expect((await call("aAdmin", "GET", path)).body).toMatchObject({
      reported: {
        diagnostics: {
          clock: "ESTIMATED",
          systemSkewMillis: null,
          crashCount: null,
        },
      },
    });
    await sync(tv);
    expect((await call("aAdmin", "GET", path)).body).toMatchObject({
      reported: { diagnostics: null },
    });
  });

  it("rejects invalid diagnostic values and discards unrecognized private fields", async () => {
    const tv = await screen(companyA, a1.id, "Validation");
    for (const diagnostics of [
      { clock: "ANCHORED", systemSkewMillis: 0, crashCount: -1 },
      { clock: "ANCHORED", systemSkewMillis: 0, crashCount: 2_147_483_648 },
      {
        clock: "ANCHORED",
        systemSkewMillis: Number.MAX_SAFE_INTEGER + 1,
        crashCount: 0,
      },
      { clock: "ESTIMATED", systemSkewMillis: 1, crashCount: 0 },
      { clock: "UNTRUSTED", systemSkewMillis: -1, crashCount: null },
      { clock: "UNKNOWN", systemSkewMillis: null, crashCount: 0 },
    ]) {
      const response = await tv.call("POST", "/device/sync", {
        body: { ...idle, diagnostics },
      });
      expect(response.status).toBe(400);
      expect(JSON.stringify(response.json())).not.toContain("SYNTHETIC_SECRET");
    }
    const rows = await sql.query(
      "SELECT * FROM publication_device_states WHERE company_id = $1 AND device_id = $2",
      [companyA, tv.id],
    );
    expect(rows.rowCount).toBe(0);
    // Existing request normalization removes unrecognized properties; persist only the allowlist.
    const extra = await tv.call("POST", "/device/sync", {
      body: {
        ...idle,
        diagnostics: {
          clock: "ANCHORED",
          systemSkewMillis: null,
          crashCount: null,
          frames: ["SYNTHETIC_SECRET"],
        },
      },
    });
    expect(extra.status).toBe(200);
    const visible = await call(
      "aAdmin",
      "GET",
      `/companies/${companyA}/devices/${tv.id}/sync-state`,
    );
    expect(visible.body).toMatchObject({
      reported: {
        diagnostics: {
          clock: "ANCHORED",
          systemSkewMillis: null,
          crashCount: null,
        },
      },
    });
    expect(JSON.stringify(visible.body)).not.toContain("SYNTHETIC_SECRET");
    const stored = await sql.query(
      "SELECT row_to_json(s) AS value FROM publication_device_states s WHERE company_id = $1 AND device_id = $2",
      [companyA, tv.id],
    );
    expect(JSON.stringify(stored.rows)).not.toContain("SYNTHETIC_SECRET");
  });

  it("enforces nullable diagnostic consistency in migrated PostgreSQL", async () => {
    const tv = await screen(companyA, a1.id, "Constraints");
    await sync(tv);
    for (const values of [
      [null, null, 1],
      ["INVALID", null, 0],
      ["UNTRUSTED", 1, 0],
      ["ANCHORED", "9007199254740992", 0],
      ["ANCHORED", 0, -1],
    ]) {
      await expect(
        sql.query(
          "UPDATE publication_device_states SET clock_state = $3, clock_skew_millis = $4, crash_count = $5 WHERE company_id = $1 AND device_id = $2",
          [companyA, tv.id, ...values],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    }
  });

  async function playlist(
    branchId: string | null,
    name: string,
    entries: { mediaAssetId: string; durationSeconds?: number }[],
  ): Promise<Body> {
    const created = await call("aAdmin", "POST", `${base}/playlists`, {
      body: { name, branchId },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const filled = await call(
      "aAdmin",
      "PUT",
      `${base}/playlists/${created.body.id}/items`,
      { body: { expectedVersion: created.body.version, items: entries } },
    );
    expect(filled.status, JSON.stringify(filled.body)).toBe(200);
    return filled.body;
  }

  async function group(name: string, branchIds: string[] | "all") {
    const created = await call("aAdmin", "POST", `${base}/groups`, {
      body:
        branchIds === "all"
          ? { name, allBranches: true, branchIds: [] }
          : { name, allBranches: false, branchIds },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    return created.body;
  }

  async function schedule(
    program: string,
    rules: Record<string, unknown>[],
    defaultPlaylistId: string | null = null,
  ) {
    const current = await call("aAdmin", "GET", `${base}/${program}/program`);
    const saved = await call(
      "aAdmin",
      "PUT",
      `${base}/${program}/program/outputs/screen`,
      {
        body: {
          expectedVersion: current.body.version,
          defaultPlaylistId,
          rules,
        },
      },
    );
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  }

  async function check(program: string, person: Person = "aAdmin") {
    return call(person, "POST", `${base}/${program}/publications/check`);
  }

  async function publish(program: string, person: Person = "aAdmin") {
    const checked = await check(program, person);
    expect(checked.status, JSON.stringify(checked.body)).toBe(200);
    return call(person, "POST", `${base}/${program}/publications`, {
      body: { contentDigest: checked.body.contentDigest },
    });
  }

  async function assign(
    device: Screen,
    target: { groupId: string | null; individual: boolean },
    confirmUnpublished: boolean,
  ) {
    const current = await call("aAdmin", "GET", `${base}/devices/${device.id}`);
    return call("aAdmin", "PUT", `${base}/devices/${device.id}/assignment`, {
      body: {
        expectedVersion: current.body.version,
        ...target,
        confirmUnpublished,
      },
    });
  }

  it("checks, publishes and versions a group program exactly as reviewed", async () => {
    const menu = await playlist(null, "Cardápio", [
      { mediaAssetId: png },
      { mediaAssetId: video },
    ]);
    const network = await group("Rede", "all");
    const program = `groups/${network.id}`;
    // A group starts with an empty program, which can be published to show
    // neutral output deliberately.
    const empty = await check(program);
    expect(empty.body).toMatchObject({
      publishable: true,
      problems: [],
      counts: { rules: 0, playlists: 0, items: 0, media: 0, mediaBytes: 0 },
      unchanged: false,
      latest: null,
      followers: 0,
    });
    await schedule(program, [{ ...morning, playlistId: menu.id }], menu.id);
    const checked = await check(program);
    expect(checked.body).toMatchObject({
      publishable: true,
      counts: { rules: 1, playlists: 1, items: 2, media: 2 },
      unchanged: false,
    });
    expect(checked.body.contentDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(
      code(
        await call("aAdmin", "POST", `${base}/${program}/publications`, {
          body: { contentDigest: "0".repeat(64) },
        }),
      ),
    ).toBe("RESOURCE_VERSION_CONFLICT");
    const first = await call(
      "aAdmin",
      "POST",
      `${base}/${program}/publications`,
      { body: { contentDigest: checked.body.contentDigest } },
    );
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body).toMatchObject({
      created: true,
      publication: {
        generation: 1,
        protocol: 1,
        state: "current",
        restoredFromGeneration: null,
        publishedBy: { isCaller: true },
        counts: { rules: 1, playlists: 1, items: 2, media: 2 },
        supersededAt: null,
      },
    });
    // Publishing unchanged content again is a safe retry.
    const again = await call(
      "aAdmin",
      "POST",
      `${base}/${program}/publications`,
      { body: { contentDigest: checked.body.contentDigest } },
    );
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({
      created: false,
      publication: { generation: 1 },
    });
    expect((await check(program)).body).toMatchObject({ unchanged: true });
    // A playlist edit changes the content: the old digest no longer
    // publishes, the new one makes generation 2.
    const edited = await call(
      "aAdmin",
      "PUT",
      `${base}/playlists/${menu.id}/items`,
      {
        body: {
          expectedVersion: menu.version,
          items: [{ mediaAssetId: video }, { mediaAssetId: png }],
        },
      },
    );
    expect(edited.status).toBe(200);
    expect(
      code(
        await call("aAdmin", "POST", `${base}/${program}/publications`, {
          body: { contentDigest: checked.body.contentDigest },
        }),
      ),
    ).toBe("RESOURCE_VERSION_CONFLICT");
    const second = await publish(program);
    expect(second.status).toBe(201);
    expect(second.body).toMatchObject({ publication: { generation: 2 } });
    const history = await call(
      "aAdmin",
      "GET",
      `${base}/${program}/publications?limit=1`,
    );
    expect(history.status, JSON.stringify(history.body)).toBe(200);
    expect(history.body.items).toMatchObject([
      { generation: 2, state: "current", publishedBy: { isCaller: true } },
    ]);
    // A whole-company group does not exist for a branch member.
    expect(
      code(await call("aOperator", "GET", `${base}/${program}/publications`)),
    ).toBe("RESOURCE_NOT_FOUND");
    const older = await call(
      "aAdmin",
      "GET",
      `${base}/${program}/publications?cursor=${history.body.nextCursor as string}`,
    );
    expect(older.body.items).toMatchObject([
      { generation: 1, state: "retained" },
    ]);
    expect(older.body.nextCursor).toBeNull();
    const audit = await sql.query<{ action: string }>(
      "SELECT action, details FROM publication_audit_events WHERE company_id = $1 AND subject_id = (SELECT program_id FROM publications WHERE id = $2) ORDER BY occurred_at",
      [companyA, (first.body.publication as Body).id],
    );
    expect(audit.rows.map((row) => row.action)).toEqual([
      "publication.published",
      "publication.published",
    ]);
    expect(JSON.stringify(audit.rows)).not.toContain("manifest");
  });

  it("refuses what cannot play as it is and says why", async () => {
    // A screen never programmed has nothing to publish.
    const lonely = await screen(companyA, a1.id, "Sozinha");
    expect((await check(`devices/${lonely.id}`)).body.problems).toEqual([
      { code: "NOTHING_TO_PUBLISH" },
    ]);
    // Fades wait for a qualified screen profile.
    const fading = await call("aAdmin", "POST", `${base}/playlists`, {
      body: { name: "Suave", branchId: null, transition: "FADE", fadeMs: 500 },
    });
    await call("aAdmin", "PUT", `${base}/playlists/${fading.body.id}/items`, {
      body: {
        expectedVersion: fading.body.version,
        items: [{ mediaAssetId: png }],
      },
    });
    const soft = await group("Suave", [a1.id]);
    await schedule(`groups/${soft.id}`, [
      { ...morning, playlistId: fading.body.id },
    ]);
    const refused = await check(`groups/${soft.id}`);
    expect(refused.body).toMatchObject({
      publishable: false,
      problems: [
        { code: "TRANSITION_UNSUPPORTED", playlistId: fading.body.id },
      ],
    });
    expect(
      code(
        await call("aAdmin", "POST", `${base}/groups/${soft.id}/publications`, {
          body: { contentDigest: refused.body.contentDigest },
        }),
      ),
    ).toBe("PUBLICATION_INVALID");
    // A moved screen keeps its old branch's playlists as drafts, which
    // cannot be published for its new branch.
    const local = await playlist(a1.id, "Centro", [{ mediaAssetId: a1Png }]);
    const mover = await screen(companyA, a1.id, "Viajante");
    await schedule(`devices/${mover.id}`, [
      { ...morning, playlistId: local.id },
    ]);
    expect((await check(`devices/${mover.id}`)).body.publishable).toBe(true);
    const moved = await call(
      "aAdmin",
      "POST",
      `/companies/${companyA}/devices/${mover.id}/move`,
      { body: { expectedVersion: mover.version, branchId: a2.id } },
    );
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect((await check(`devices/${mover.id}`)).body.problems).toEqual([
      { code: "PLAYLIST_OUT_OF_SCOPE", playlistId: local.id },
    ]);
    // Media that is no longer available cannot be published.
    const gone = await ready(companyA, fixtures.pngAlpha, null);
    const fragile = await playlist(null, "Frágil", [{ mediaAssetId: gone }]);
    const somewhere = await group("Frágil", [a2.id]);
    await schedule(`groups/${somewhere.id}`, [
      { ...morning, playlistId: fragile.id },
    ]);
    await sql.query(
      "UPDATE media_assets SET status = 'DELETED', deleted_at = now(), purge_after = now() + interval '30 days' WHERE id = $1",
      [gone],
    );
    expect((await check(`groups/${somewhere.id}`)).body.problems).toEqual([
      { code: "MEDIA_UNAVAILABLE", mediaId: gone },
    ]);
  });

  it("publishes a program with a layout as protocol 2 with its catalog", async () => {
    const catalogs = `/companies/${companyA}/catalogs`;
    const created = await call("aAdmin", "POST", catalogs, {
      body: {
        name: "Cardápio",
        branchId: null,
        fields: [
          { label: "Nome", type: "text", required: true },
          { label: "Preço", type: "money", currency: "BRL" },
          { label: "Descrição", type: "longText" },
        ],
      },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const catalog = `${catalogs}/${created.body.id}`;
    const [title, price] = created.body.fields as { id: string }[];
    async function item(name: string, base: number) {
      const record = await call("aAdmin", "POST", `${catalog}/records`, {
        body: { values: { [title.id]: name } },
      });
      expect(record.status, JSON.stringify(record.body)).toBe(201);
      const priced = await call(
        "aAdmin",
        "PUT",
        `${catalog}/records/${record.body.id}/prices/${price.id}`,
        { body: { expectedVersion: record.body.version, amount: base } },
      );
      expect(priced.status, JSON.stringify(priced.body)).toBe(200);
      return priced.body;
    }
    const coffee = await item("Café", 500);
    const bread = await item("Pão de queijo", 750);
    const prices = `${catalog}/records/${coffee.id}/prices/${price.id}`;
    let version = coffee.version;
    for (const [branchId, amount] of [
      [a1.id, 450],
      [a2.id, 550],
    ] as const) {
      const branch = await call(
        "aAdmin",
        "PUT",
        `${prices}/branches/${branchId}`,
        {
          body: { expectedVersion: version, amount },
        },
      );
      expect(branch.status, JSON.stringify(branch.body)).toBe(200);
      version = branch.body.version;
    }
    for (const branchId of [null, a2.id])
      expect(
        (
          await call("aAdmin", "POST", `${prices}/promotions`, {
            body: {
              branchId,
              amount: branchId ? 300 : 400,
              startsAt: branchId ? "2027-02-01T08:00" : "2027-01-04T08:00",
              endsAt: branchId ? "2027-02-02T08:00" : "2027-01-05T08:00",
            },
          })
        ).status,
      ).toBe(201);
    const layout = await call("aAdmin", "POST", `${base}/layouts`, {
      body: {
        name: "Cardápio e vídeo",
        branchId: null,
        definition: {
          orientation: "landscape",
          areas: [
            {
              key: "video",
              name: "Vídeo",
              x: 0,
              y: 0,
              width: 1280,
              height: 1080,
              z: 0,
              kind: "media",
            },
            {
              key: "menu",
              name: "Cardápio",
              x: 1280,
              y: 0,
              width: 640,
              height: 1080,
              z: 1,
              kind: "catalog",
              view: {
                catalogId: created.body.id,
                fields: [
                  { fieldId: title.id, role: "title" },
                  { fieldId: price.id, role: "price" },
                ],
                presentation: "menu",
                textSize: 40,
              },
            },
          ],
        },
      },
    });
    expect(layout.status, JSON.stringify(layout.body)).toBe(201);
    const shop = await group("Cardápio", [a1.id]);
    const chosen = await call(
      "aAdmin",
      "PUT",
      `${base}/groups/${shop.id}/program/layout`,
      {
        body: { expectedVersion: 1, layoutId: layout.body.id },
      },
    );
    expect(chosen.status, JSON.stringify(chosen.body)).toBe(200);
    const clips = await playlist(null, "Clipes", [{ mediaAssetId: png }]);
    const output = await call(
      "aAdmin",
      "PUT",
      `${base}/groups/${shop.id}/program/outputs/video`,
      {
        body: {
          expectedVersion: chosen.body.version,
          defaultPlaylistId: clips.id,
          rules: [],
        },
      },
    );
    expect(output.status, JSON.stringify(output.body)).toBe(200);
    // A record whose title cannot fit blocks publication until it is gone.
    const long = await call("aAdmin", "POST", `${catalog}/records`, {
      body: {
        values: {
          [title.id]:
            "Hambúrguer artesanal duplo com queijo, bacon e cebola caramelizada",
        },
      },
    });
    expect((await check(`groups/${shop.id}`)).body.problems).toEqual([
      { code: "CATALOG_OVERFLOW", areaKey: "menu" },
    ]);
    expect(
      (
        await call("aAdmin", "DELETE", `${catalog}/records/${long.body.id}`, {
          body: { expectedVersion: long.body.version },
        })
      ).status,
    ).toBe(204);
    const published = await publish(`groups/${shop.id}`);
    expect(published.status, JSON.stringify(published.body)).toBe(201);
    const publication = published.body.publication as Body;
    expect(publication).toMatchObject({ protocol: 2 });
    const tv = await screen(companyA, a1.id, "Cardápio");
    expect(
      (await assign(tv, { groupId: shop.id, individual: false }, false)).status,
    ).toBe(200);
    // Players that support protocol 2 agree on it; older ones learn which
    // protocol the desired publication needs.
    const newer = await sync(tv, { protocols: [1, 2] });
    expect(newer.body).toMatchObject({
      protocol: 2,
      branchId: a1.id,
      desired: { protocol: 2 },
    });
    expect((await sync(tv)).body).toMatchObject({
      protocol: 1,
      desired: { protocol: 2 },
    });
    const manifest = await tv.call(
      "GET",
      `/device/publications/${publication.id}/manifest`,
    );
    expect(manifest.status).toBe(200);
    expect(createHash("sha256").update(manifest.raw).digest("hex")).toBe(
      (newer.body.desired as { manifestSha256: string }).manifestSha256,
    );
    const parsed = manifest.json<
      Record<string, unknown> & {
        layout: { areas: { key: string; view: { pages: unknown } | null }[] };
        catalogs: {
          fields: { id: string }[];
          records: { id: string; values: Record<string, unknown> }[];
          prices: {
            recordId: string;
            overrides: { branchId: string }[];
            promotions: { branchId: string | null }[];
          }[];
        }[];
        media: { id: string }[];
      }
    >();
    expect(Object.keys(parsed)).toEqual([
      "format",
      "protocol",
      "publicationId",
      "companyId",
      "programId",
      "generation",
      "publishedAt",
      "layout",
      "outputs",
      "catalogs",
      "playlists",
      "media",
    ]);
    expect(parsed.protocol).toBe(2);
    expect(parsed.outputs).toEqual([
      { key: "video", default: { playlistId: clips.id }, rules: [] },
      { key: "menu", default: { view: true }, rules: [] },
    ]);
    expect(parsed.layout.areas.map((area) => area.key)).toEqual([
      "video",
      "menu",
    ]);
    expect(parsed.layout.areas[1].view?.pages).toEqual([
      [
        { recordId: coffee.id, group: null },
        { recordId: bread.id, group: null },
      ],
    ]);
    const [snapshot] = parsed.catalogs;
    expect(snapshot.fields.map((field) => field.id)).toEqual([
      title.id,
      price.id,
    ]);
    expect(snapshot.records).toEqual([
      { id: coffee.id, available: true, values: { [title.id]: "Café" } },
      {
        id: bread.id,
        available: true,
        values: { [title.id]: "Pão de queijo" },
      },
    ]);
    // Only the branches the group reaches keep their prices.
    const coffeePrices = snapshot.prices.find(
      (entry) => entry.recordId === coffee.id,
    );
    expect(coffeePrices).toMatchObject({
      base: 500,
      overrides: [{ branchId: a1.id, amount: 450 }],
      promotions: [{ branchId: null, amount: 400 }],
    });
    expect(parsed.media.map((entry) => entry.id)).toEqual([png]);
    // A restored copy keeps its prices, so it may not serve a branch the
    // group reaches only now; within its reach it is the same content.
    const before = await call("aAdmin", "GET", `${base}/groups/${shop.id}`);
    const widened = await call("aAdmin", "PATCH", `${base}/groups/${shop.id}`, {
      body: {
        expectedVersion: before.body.version,
        allBranches: false,
        branchIds: [a1.id, a2.id],
      },
    });
    expect(widened.status, JSON.stringify(widened.body)).toBe(200);
    const restore = `${base}/groups/${shop.id}/publications/${publication.id}/restore`;
    expect(code(await call("aAdmin", "POST", restore))).toBe(
      "PUBLICATION_INVALID",
    );
    expect(
      (
        await call("aAdmin", "PATCH", `${base}/groups/${shop.id}`, {
          body: {
            expectedVersion: widened.body.version,
            allBranches: false,
            branchIds: [a1.id],
          },
        })
      ).status,
    ).toBe(200);
    expect((await call("aAdmin", "POST", restore)).body).toMatchObject({
      created: false,
      publication: { id: publication.id, protocol: 2 },
    });
    // A page naming a view page the records no longer fill blocks it too.
    const paged = await call("aAdmin", "POST", `${base}/layouts`, {
      body: {
        name: "Páginas do cardápio",
        branchId: null,
        definition: {
          orientation: "portrait",
          areas: [
            {
              key: "menu",
              name: "Cardápio",
              x: 0,
              y: 0,
              width: 1080,
              height: 1920,
              z: 0,
              kind: "catalog",
              pageControlled: true,
              view: {
                catalogId: created.body.id,
                fields: [{ fieldId: title.id, role: "title" }],
                presentation: "list",
                textSize: 40,
              },
            },
          ],
          pages: [1, 2].map((viewPage) => ({
            durationSeconds: 10,
            contents: [{ areaKey: "menu", viewPage }],
          })),
        },
      },
    });
    expect(paged.status, JSON.stringify(paged.body)).toBe(201);
    const flipping = await group("Páginas", [a1.id]);
    expect(
      (
        await call(
          "aAdmin",
          "PUT",
          `${base}/groups/${flipping.id}/program/layout`,
          {
            body: { expectedVersion: 1, layoutId: paged.body.id },
          },
        )
      ).status,
    ).toBe(200);
    expect((await check(`groups/${flipping.id}`)).body.problems).toEqual([
      { code: "CATALOG_PAGE_MISSING", areaKey: "menu" },
    ]);
  });

  it("publishes price changes to the programs that show their catalog", async () => {
    const a3 = await createBranch("aAdmin", companyA, "Praia");
    const a4 = await createBranch("aAdmin", companyA, "Serra");
    // The manager also manages Praia, through a grant of its own.
    const grantId = randomUUID();
    await sql.query(
      `INSERT INTO membership_grants (id, company_id, membership_id, role, scope)
       SELECT $1, company_id, id, 'BRANCH_MANAGER', 'BRANCHES' FROM memberships
       WHERE company_id = $2 AND principal_id = $3`,
      [grantId, companyA, people.aManager],
    );
    await sql.query(
      "INSERT INTO membership_grant_branches (company_id, grant_id, branch_id) VALUES ($1, $2, $3)",
      [companyA, grantId, a3.id],
    );
    const catalogs = `/companies/${companyA}/catalogs`;
    const created = await call("aAdmin", "POST", catalogs, {
      body: {
        name: "Bebidas",
        branchId: null,
        fields: [
          { label: "Nome", type: "text", required: true },
          { label: "Preço", type: "money", currency: "BRL" },
        ],
      },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const catalog = `${catalogs}/${created.body.id}`;
    const [title, price] = created.body.fields as { id: string }[];
    const coffee = await call("aAdmin", "POST", `${catalog}/records`, {
      body: { values: { [title.id]: "Café" } },
    });
    expect(coffee.status, JSON.stringify(coffee.body)).toBe(201);
    const prices = `${catalog}/records/${coffee.body.id}/prices/${price.id}`;
    let version = coffee.body.version;
    async function setPrice(person: Person, path: string, amount: number) {
      const saved = await call(person, "PUT", path, {
        body: { expectedVersion: version, amount },
      });
      if (saved.status === 200) version = saved.body.version;
      return saved;
    }
    expect((await setPrice("aAdmin", prices, 500)).status).toBe(200);
    const layout = await call("aAdmin", "POST", `${base}/layouts`, {
      body: {
        name: "Bebidas",
        branchId: null,
        definition: {
          orientation: "landscape",
          areas: [
            {
              key: "video",
              name: "Vídeo",
              x: 0,
              y: 0,
              width: 1280,
              height: 1080,
              z: 0,
              kind: "media",
            },
            {
              key: "menu",
              name: "Bebidas",
              x: 1280,
              y: 0,
              width: 640,
              height: 1080,
              z: 1,
              kind: "catalog",
              view: {
                catalogId: created.body.id,
                fields: [
                  { fieldId: title.id, role: "title" },
                  { fieldId: price.id, role: "price" },
                ],
                presentation: "menu",
                textSize: 40,
              },
            },
          ],
        },
      },
    });
    expect(layout.status, JSON.stringify(layout.body)).toBe(201);
    async function shop(name: string, branchIds: string[]) {
      const made = await group(name, branchIds);
      const chosen = await call(
        "aAdmin",
        "PUT",
        `${base}/groups/${made.id}/program/layout`,
        { body: { expectedVersion: 1, layoutId: layout.body.id } },
      );
      expect(chosen.status, JSON.stringify(chosen.body)).toBe(200);
      const published = await publish(`groups/${made.id}`);
      expect(published.status, JSON.stringify(published.body)).toBe(201);
      return made;
    }
    async function manifestOf(publicationId: string) {
      const { rows } = await sql.query<{ text: string }>(
        "SELECT convert_from(manifest, 'UTF8') AS text FROM publications WHERE id = $1",
        [publicationId],
      );
      return JSON.parse(rows[0].text) as {
        outputs: { key: string; default: unknown }[];
        catalogs: {
          prices: {
            base: number | null;
            overrides: { branchId: string; amount: number }[];
          }[];
        }[];
      };
    }
    async function latestOf(groupId: string) {
      const listed = await call(
        "aAdmin",
        "GET",
        `${base}/groups/${groupId}/publications`,
      );
      return (listed.body.items as Body[])[0];
    }
    const praia = await shop("Praia", [a3.id]);
    // A draft change after publication never rides on a price publication.
    const clips = await playlist(null, "Clipes de bebidas", [
      { mediaAssetId: png },
    ]);
    const program = await call(
      "aAdmin",
      "GET",
      `${base}/groups/${praia.id}/program`,
    );
    expect(
      (
        await call(
          "aAdmin",
          "PUT",
          `${base}/groups/${praia.id}/program/outputs/video`,
          {
            body: {
              expectedVersion: program.body.version,
              defaultPlaylistId: clips.id,
              rules: [],
            },
          },
        )
      ).status,
    ).toBe(200);

    // Praia's manager changes Praia's price: the intent becomes generation 2.
    const list = `${catalog}/price-publications`;
    expect(
      (await setPrice("aManager", `${prices}/branches/${a3.id}`, 450)).status,
    ).toBe(200);
    expect((await call("aManager", "GET", list)).body.items).toMatchObject([
      {
        state: "pending",
        target: { kind: "group", id: praia.id, name: "Praia" },
        authorIsCaller: true,
        generation: null,
      },
    ]);
    expect(await publications.publishPrices()).toBe(1);
    expect((await call("aManager", "GET", list)).body.items).toMatchObject([
      { state: "published", reason: null, generation: 2 },
    ]);
    const second = await latestOf(praia.id);
    expect(second).toMatchObject({
      generation: 2,
      origin: "price",
      publishedBy: { isCaller: false },
    });
    const repriced = await manifestOf(second.id);
    expect(repriced.outputs).toEqual([
      { key: "video", default: null, rules: [] },
      { key: "menu", default: { view: true }, rules: [] },
    ]);
    expect(repriced.catalogs[0].prices).toEqual([
      expect.objectContaining({
        base: 500,
        overrides: [{ branchId: a3.id, amount: 450 }],
      }),
    ]);

    // A program the manager cannot publish refuses the change, and nothing
    // is saved.
    const both = await shop("Praia e Serra", [a3.id, a4.id]);
    expect(
      code(await setPrice("aManager", `${prices}/branches/${a3.id}`, 400)),
    ).toBe("PRICE_TARGET_FORBIDDEN");
    const record = await call(
      "aAdmin",
      "GET",
      `${catalog}/records/${coffee.body.id}`,
    );
    expect(record.body.version).toBe(version);
    expect(record.body.overrides).toMatchObject([
      { branch: { id: a3.id }, amount: 450 },
    ]);

    // Later changes coalesce per program; a person's publication settles
    // what it includes.
    expect((await setPrice("aAdmin", prices, 520)).status).toBe(200);
    expect((await setPrice("aAdmin", prices, 530)).status).toBe(200);
    const pending = (
      (await call("aAdmin", "GET", list)).body.items as Body[]
    ).filter((item) => item.state === "pending");
    expect(pending.map((item) => (item.target as Body).id).sort()).toEqual(
      [praia.id, both.id].sort(),
    );
    expect(new Set(pending.map((item) => item.priceSequence)).size).toBe(1);
    expect((await publish(`groups/${both.id}`)).status).toBe(201);
    expect(await publications.publishPrices()).toBe(1);
    const settled = (await call("aAdmin", "GET", list)).body.items as Body[];
    expect(
      settled.find((item) => (item.target as Body).id === both.id),
    ).toMatchObject({ state: "skipped", reason: "INCLUDED", generation: 2 });
    expect(
      settled.find(
        (item) =>
          (item.target as Body).id === praia.id && item.state !== "published",
      ),
    ).toBeUndefined();
    expect(await latestOf(praia.id)).toMatchObject({
      generation: 3,
      origin: "price",
    });
    expect(
      (await manifestOf((await latestOf(praia.id)).id)).catalogs[0].prices[0]
        .base,
    ).toBe(530);

    // Removed authority blocks an intent until someone who may publish the
    // program authorizes it again.
    const removed = await call("aAdmin", "GET", `${base}/groups/${both.id}`);
    expect(
      (
        await call("aAdmin", "DELETE", `${base}/groups/${both.id}`, {
          body: { expectedVersion: removed.body.version },
        })
      ).status,
    ).toBe(204);
    // A Praia price stays local (IA-11): a program only for Serra shows the
    // catalog but is not a target, so the manager may change it.
    const serra = await shop("Serra", [a4.id]);
    expect(
      (await setPrice("aManager", `${prices}/branches/${a3.id}`, 410)).status,
    ).toBe(200);
    expect(
      ((await call("aAdmin", "GET", list)).body.items as Body[])
        .filter((item) => item.state === "pending")
        .map((item) => (item.target as Body).id),
    ).toEqual([praia.id]);
    await sql.query(
      "UPDATE membership_grants SET revoked_at = now() WHERE company_id = $1 AND id = $2",
      [companyA, grantId],
    );
    expect(await publications.publishPrices()).toBe(1);
    const [blocked] = (await call("aAdmin", "GET", list)).body.items as Body[];
    expect(blocked).toMatchObject({
      state: "blocked",
      reason: "AUTHOR_NOT_AUTHORIZED",
      authorIsCaller: false,
    });
    const retried = await call(
      "aAdmin",
      "POST",
      `/companies/${companyA}/price-publications/${blocked.id}/retry`,
    );
    expect(retried.status, JSON.stringify(retried.body)).toBe(200);
    expect(retried.body).toMatchObject({
      state: "pending",
      reauthorized: true,
      authorIsCaller: false,
    });
    expect(
      code(
        await call(
          "aAdmin",
          "POST",
          `/companies/${companyA}/price-publications/${blocked.id}/retry`,
        ),
      ),
    ).toBe("RESOURCE_VERSION_CONFLICT");
    expect(await publications.publishPrices()).toBe(1);
    expect(await latestOf(praia.id)).toMatchObject({
      generation: 4,
      origin: "price",
      publishedBy: { isCaller: true },
    });
    const { rows: audited } = await sql.query<{
      action: string;
      details: Body;
    }>(
      `SELECT action, details FROM publication_audit_events
       WHERE company_id = $1 AND action IN ('publication.price_reauthorized', 'publication.price_published')
         AND details ->> 'intentId' = $2 ORDER BY occurred_at`,
      [companyA, blocked.id],
    );
    expect(audited.map((row) => row.action)).toEqual([
      "publication.price_reauthorized",
      "publication.price_published",
    ]);
    expect(audited[0].details).toMatchObject({
      previousState: "BLOCKED",
      previousReason: "AUTHOR_NOT_AUTHORIZED",
      outcome: "queued",
    });

    // A restored generation shows its old prices until the current ones
    // follow as a price publication.
    const first = (
      (await call("aAdmin", "GET", `${base}/groups/${praia.id}/publications`))
        .body.items as Body[]
    ).find((item) => item.generation === 1)!;
    const restored = await call(
      "aAdmin",
      "POST",
      `${base}/groups/${praia.id}/publications/${first.id}/restore`,
    );
    expect(restored.status, JSON.stringify(restored.body)).toBe(201);
    expect(restored.body.publication).toMatchObject({
      generation: 5,
      origin: "restore",
    });
    expect(await publications.publishPrices()).toBe(1);
    const current = await latestOf(praia.id);
    expect(current).toMatchObject({ generation: 6, origin: "price" });
    expect((await manifestOf(current.id)).catalogs[0].prices).toEqual([
      expect.objectContaining({
        base: 530,
        overrides: [{ branchId: a3.id, amount: 410 }],
      }),
    ]);
    // A price too wide for its column fails the intent with the catalog
    // problem, and screens keep the current generation.
    expect((await setPrice("aAdmin", prices, 99_999_999_999)).status).toBe(200);
    expect(await publications.publishPrices()).toBe(2);
    const failed = (
      (await call("aAdmin", "GET", list)).body.items as Body[]
    ).slice(0, 2);
    expect(failed.map((item) => (item.target as Body).id).sort()).toEqual(
      [praia.id, serra.id].sort(),
    );
    for (const item of failed)
      expect(item).toMatchObject({
        state: "failed",
        reason: "CATALOG_OVERFLOW",
      });
    expect(await latestOf(praia.id)).toMatchObject({ generation: 6 });
    // Members who cannot see the catalog cannot list its publications.
    expect(code(await call("bAdmin", "GET", list))).toBe("RESOURCE_NOT_FOUND");
  });

  it("lets only scoped publishers publish", async () => {
    const local = await playlist(a1.id, "Centro noite", [
      { mediaAssetId: a1Png },
    ]);
    const centro = await group("Centro", [a1.id]);
    const both = await group("Duas", [a1.id, a2.id]);
    await schedule(`groups/${centro.id}`, [
      { ...morning, playlistId: local.id },
    ]);
    // Operators author drafts but do not publish without an additional
    // grant.
    expect(code(await check(`groups/${centro.id}`, "aOperator"))).toBe(
      "PERMISSION_DENIED",
    );
    expect(
      (
        await call(
          "aOperator",
          "GET",
          `${base}/groups/${centro.id}/publications`,
        )
      ).status,
    ).toBe(200);
    // Managers publish in their branches; a group they see only partly
    // does not exist for them.
    expect((await publish(`groups/${centro.id}`, "aManager")).status).toBe(201);
    expect(code(await check(`groups/${both.id}`, "aManager"))).toBe(
      "RESOURCE_NOT_FOUND",
    );
    // An access profile grants publishing, always with two-step
    // verification.
    const profileId = randomUUID();
    await sql.query(
      "INSERT INTO access_profiles (id, company_id, name, capabilities) VALUES ($1, $2, 'Publica', ARRAY['programming.view', 'publications.publish'])",
      [profileId, companyA],
    );
    await grantBranches("aPublisher", companyA, { profileId }, [a1.id]);
    await schedule(`groups/${centro.id}`, [
      { ...morning, playlistId: local.id, startTime: "09:00" },
    ]);
    expect((await publish(`groups/${centro.id}`, "aPublisher")).status).toBe(
      201,
    );
    const seen = await call(
      "aOperator",
      "GET",
      `${base}/groups/${centro.id}/publications`,
    );
    expect(seen.body.items).toMatchObject([
      { generation: 2, publishedBy: { isCaller: false } },
      { generation: 1, publishedBy: { isCaller: false } },
    ]);
    // Another company sees nothing of this one.
    expect(
      code(
        await call(
          "bAdmin",
          "GET",
          `/companies/${companyB}/programming/groups/${centro.id}/publications`,
        ),
      ),
    ).toBe("RESOURCE_NOT_FOUND");
    expect(
      code(
        await call(
          "bAdmin",
          "POST",
          `${base}/groups/${centro.id}/publications/check`,
        ),
      ),
    ).toBe("RESOURCE_NOT_FOUND");
  });

  it("synchronizes a screen with its desired publication, statement and files", async () => {
    keySet = createLocalJWKSet(
      (
        await (
          await screen(companyA, a2.id, "Chaves")
        ).call("GET", "/device/keys")
      ).json<JSONWebKeySet>(),
    );
    const menu = await playlist(null, "Vitrine", [
      { mediaAssetId: png },
      { mediaAssetId: video },
    ]);
    const shop = await group("Loja", [a1.id]);
    const unpublished = await group("Rascunho", [a1.id]);
    await schedule(`groups/${shop.id}`, [{ ...morning, playlistId: menu.id }]);
    const published = await publish(`groups/${shop.id}`);
    const first = published.body.publication as Body & {
      manifestSha256: string;
    };
    const tv = await screen(companyA, a1.id, "Balcão");
    // Assignments to a published destination need no confirmation; an
    // unpublished one still does.
    expect(
      code(
        await assign(tv, { groupId: unpublished.id, individual: false }, false),
      ),
    ).toBe("ASSIGNMENT_CONFIRMATION_REQUIRED");
    expect(
      (await assign(tv, { groupId: shop.id, individual: false }, false)).status,
    ).toBe(200);
    expect((await check(`groups/${shop.id}`)).body.followers).toBe(1);

    const synced = await sync(tv);
    expect(synced.status, JSON.stringify(synced.body)).toBe(200);
    expect(synced.body).toMatchObject({
      protocol: 1,
      status: "active",
      clearRequired: false,
      timeZone: "America/Sao_Paulo",
      rotation: 0,
      desired: {
        publicationId: first.id,
        generation: 1,
        manifestSha256: first.manifestSha256,
        source: "group",
      },
      nextSyncSeconds: 30,
    });
    const statement = await verified(synced.body.authorization);
    expect(statement).toMatchObject({
      sub: tv.id,
      company: companyA,
      publications: [{ id: first.id, sha256: first.manifestSha256 }],
    });
    expect(statement.exp - statement.iat).toBe(7 * 24 * 60 * 60);
    // The zone's offsets cover three days before to 35 days after the
    // server's time, so the screen never needs its own zone data.
    const serverTime = Date.parse(synced.body.serverTime as string);
    const offsets = synced.body.zoneOffsets as {
      until: string;
      periods: { from: string; offsetSeconds: number }[];
    };
    expect(Date.parse(offsets.until) - serverTime).toBe(35 * 86_400_000);
    expect(serverTime - Date.parse(offsets.periods[0].from)).toBe(
      3 * 86_400_000,
    );
    expect(offsets.periods).toEqual([
      { from: offsets.periods[0].from, offsetSeconds: -10_800 },
    ]);

    const manifest = await tv.call(
      "GET",
      `/device/publications/${first.id}/manifest`,
    );
    expect(manifest.status).toBe(200);
    expect(manifest.headers["etag"]).toBe(`"${first.manifestSha256}"`);
    expect(createHash("sha256").update(manifest.raw).digest("hex")).toBe(
      first.manifestSha256,
    );
    const parsed = JSON.parse(manifest.raw.toString("utf8")) as {
      generation: number;
      companyId: string;
      outputs: { rules: { id: string; playlistId: string }[] }[];
      media: { id: string; sha256: string; size: number }[];
    };
    expect(parsed).toMatchObject({ generation: 1, companyId: companyA });
    expect(parsed.outputs[0].rules).toMatchObject([
      { id: "r1", playlistId: menu.id },
    ]);
    expect(JSON.stringify(parsed)).not.toContain("Vitrine");
    for (const item of parsed.media) {
      const file = await tv.call("GET", `/device/media/${item.id}`);
      expect(file.status).toBe(200);
      expect(file.raw.length).toBe(item.size);
      expect(createHash("sha256").update(file.raw).digest("hex")).toBe(
        item.sha256,
      );
      expect(file.headers["etag"]).toBe(`"${item.sha256}"`);
    }
    const part = await tv.call("GET", `/device/media/${parsed.media[0].id}`, {
      headers: { range: "bytes=0-9" },
    });
    expect(part.status).toBe(206);
    expect(part.raw.length).toBe(10);
    // Nothing outside the desired publication is delivered.
    expect((await tv.call("GET", `/device/media/${a1Png}`)).status).toBe(404);
    const stranger = await screen(companyA, a2.id, "Outra");
    expect(
      (await stranger.call("GET", `/device/publications/${first.id}/manifest`))
        .status,
    ).toBe(404);
    expect(
      (await stranger.call("GET", `/device/media/${parsed.media[0].id}`))
        .status,
    ).toBe(404);

    // The screen reports activation; the panel shows it as up to date.
    const activatedAt = new Date().toISOString();
    await sync(tv, {
      active: { publicationId: first.id, activatedAt },
      playback: "PLAYING",
    });
    const state = await call(
      "aManager",
      "GET",
      `/companies/${companyA}/devices/${tv.id}/sync-state`,
    );
    expect(state.status, JSON.stringify(state.body)).toBe(200);
    expect(state.body).toMatchObject({
      deviceId: tv.id,
      connection: "online",
      source: "group",
      desired: { publicationId: first.id, generation: 1 },
      publication: "up_to_date",
      reported: {
        appVersion: "1.0.0",
        active: { publicationId: first.id, generation: 1 },
        playback: "PLAYING",
        storage: { freeBytes: 6e9, totalBytes: 8e9 },
      },
    });
    // Another branch's manager does not see this screen.
    await grantBranches("bAdmin", companyA, { role: "BRANCH_MANAGER" }, [
      a2.id,
    ]);
    expect(
      code(
        await call(
          "bAdmin",
          "GET",
          `/companies/${companyA}/devices/${tv.id}/sync-state`,
        ),
      ),
    ).toBe("RESOURCE_NOT_FOUND");
    const listed = await call(
      "aAdmin",
      "GET",
      `/companies/${companyA}/publications/screen-states?deviceId=${tv.id}&deviceId=${stranger.id}`,
    );
    expect(
      (listed.body.items as { deviceId: string; publication: string }[]).map(
        (item) => [item.deviceId, item.publication],
      ),
    ).toEqual(
      [
        [tv.id, "up_to_date"],
        [stranger.id, "unknown"],
      ].sort(),
    );

    // A new generation becomes desired at the next sync; the old one stays
    // authorized while the screen stages the new one.
    await schedule(`groups/${shop.id}`, [
      { ...morning, playlistId: menu.id, endTime: "13:00" },
    ]);
    const second = (await publish(`groups/${shop.id}`)).body
      .publication as Body & { manifestSha256: string };
    const next = await sync(tv, {
      active: { publicationId: first.id, activatedAt },
      staging: {
        publicationId: second.id,
        state: "FAILED",
        failure: "STORAGE_FULL",
        bytesDone: 10,
        bytesTotal: 100,
      },
      playback: "PLAYING",
    });
    expect(next.body.desired).toMatchObject({
      publicationId: second.id,
      generation: 2,
    });
    expect((await verified(next.body.authorization)).publications).toEqual([
      { id: second.id, sha256: second.manifestSha256 },
      { id: first.id, sha256: first.manifestSha256 },
    ]);
    expect(
      (await tv.call("GET", `/device/publications/${first.id}/manifest`))
        .status,
    ).toBe(404);
    const failed = await call(
      "aAdmin",
      "GET",
      `/companies/${companyA}/devices/${tv.id}/sync-state`,
    );
    expect(failed.body).toMatchObject({
      publication: "failed",
      reported: {
        active: { generation: 1 },
        staging: { generation: 2, state: "FAILED", failure: "STORAGE_FULL" },
      },
    });
    const events = await sql.query<{ kind: string }>(
      "SELECT kind, detail FROM publication_device_events WHERE device_id = $1 ORDER BY occurred_at, kind",
      [tv.id],
    );
    expect(events.rows.map((row) => row.kind)).toEqual(
      expect.arrayContaining([
        "DESIRED_DELIVERED",
        "ACTIVATED",
        "PLAYBACK_CHANGED",
        "STAGING_FAILED",
      ]),
    );

    // Once the new generation is active, the old one gets no new authority
    // even if the screen keeps reporting it.
    const activated = await sync(tv, {
      active: { publicationId: second.id, activatedAt },
      recovery: { publicationId: first.id },
      playback: "PLAYING",
    });
    expect((await verified(activated.body.authorization)).publications).toEqual(
      [{ id: second.id, sha256: second.manifestSha256 }],
    );

    // Individual programming without a publication means neutral output:
    // the statement authorizes nothing.
    expect(
      (await assign(tv, { groupId: shop.id, individual: true }, true)).status,
    ).toBe(200);
    const neutral = await sync(tv, {
      active: { publicationId: second.id, activatedAt },
      playback: "PLAYING",
    });
    expect(neutral.body.desired).toBeNull();
    expect((await verified(neutral.body.authorization)).publications).toEqual(
      [],
    );
    expect(
      (
        await call(
          "aAdmin",
          "GET",
          `/companies/${companyA}/devices/${tv.id}/sync-state`,
        )
      ).body,
    ).toMatchObject({ source: "individual", publication: "neutral" });
  });

  it("answers suspended, unlinked, unknown and incompatible screens safely", async () => {
    const tv = await screen(companyA, a1.id, "Fim");
    expect(
      code({
        status: 0,
        body: (
          await tv.call("POST", "/device/sync", {
            body: { ...idle, protocols: [3] },
          })
        ).json(),
      }),
    ).toBe("PROTOCOL_UNSUPPORTED");
    const unknown = await app.inject({
      method: "POST",
      url: "/device/sync",
      headers: {
        authorization: `Bearer ${randomBytes(32).toString("base64url")}`,
      },
      payload: idle,
    });
    expect(unknown.statusCode).toBe(401);
    expect(unknown.json<{ error: { code: string } }>().error.code).toBe(
      "DEVICE_UNAUTHORIZED",
    );
    await sql.query("UPDATE companies SET status = 'SUSPENDED' WHERE id = $1", [
      companyA,
    ]);
    try {
      const suspended = await sync(tv);
      expect(suspended.body).toMatchObject({
        status: "suspended",
        desired: null,
        authorization: null,
      });
      expect(
        code(
          await call(
            "aAdmin",
            "GET",
            `/companies/${companyA}/devices/${tv.id}/sync-state`,
          ),
        ),
      ).toBe("COMPANY_SUSPENDED");
      expect(
        code(
          await call(
            "aAdmin",
            "GET",
            `/companies/${companyA}/publications/screen-states?deviceId=${tv.id}`,
          ),
        ),
      ).toBe("COMPANY_SUSPENDED");
    } finally {
      await sql.query("UPDATE companies SET status = 'ACTIVE' WHERE id = $1", [
        companyA,
      ]);
    }
    const unlinked = await call(
      "aAdmin",
      "POST",
      `/companies/${companyA}/devices/${tv.id}/unlink`,
      { body: { expectedVersion: tv.version } },
    );
    expect(unlinked.status, JSON.stringify(unlinked.body)).toBe(200);
    expect((await sync(tv)).body).toMatchObject({
      status: "unlinked",
      clearRequired: true,
      timeZone: null,
      zoneOffsets: null,
      rotation: null,
      desired: null,
      authorization: null,
    });
    expect(
      code(
        await call(
          "aAdmin",
          "GET",
          `/companies/${companyA}/devices/${tv.id}/sync-state`,
        ),
      ),
    ).toBe("DEVICE_UNLINKED");
  });

  it("protects published media, restores, prunes and limits publications", async () => {
    const special = await ready(companyA, fixtures.pngAlpha, null);
    const promo = await playlist(null, "Promoção", [{ mediaAssetId: special }]);
    const plain = await playlist(null, "Comum", [{ mediaAssetId: png }]);
    const campaign = await group("Campanha", [a2.id]);
    const program = `groups/${campaign.id}`;
    await schedule(program, [{ ...morning, playlistId: promo.id }]);
    const first = (await publish(program)).body.publication as Body;
    await schedule(program, [{ ...morning, playlistId: plain.id }]);
    const second = (await publish(program)).body.publication as Body;
    // The draft no longer uses the promotion, but its publication does.
    const promoNow = await call(
      "aAdmin",
      "GET",
      `${base}/playlists/${promo.id}`,
    );
    expect(
      (
        await call("aAdmin", "DELETE", `${base}/playlists/${promo.id}`, {
          body: { expectedVersion: promoNow.body.version },
        })
      ).status,
    ).toBe(204);
    const item = await call(
      "aAdmin",
      "GET",
      `/companies/${companyA}/media/${special}`,
    );
    const archived = await call(
      "aAdmin",
      "POST",
      `/companies/${companyA}/media/${special}/archive`,
      { body: { expectedVersion: item.body.version } },
    );
    expect(archived.status, JSON.stringify(archived.body)).toBe(200);
    expect(
      code(
        await call(
          "aAdmin",
          "POST",
          `/companies/${companyA}/media/${special}/delete`,
          { body: { expectedVersion: archived.body.version } },
        ),
      ),
    ).toBe("MEDIA_IN_USE");

    // Restoring generation 1 republishes its content as generation 3,
    // archived media included; restoring it again changes nothing.
    const restored = await call(
      "aAdmin",
      "POST",
      `${base}/${program}/publications/${first.id}/restore`,
    );
    expect(restored.status, JSON.stringify(restored.body)).toBe(201);
    expect(restored.body).toMatchObject({
      created: true,
      publication: { generation: 3, restoredFromGeneration: 1 },
    });
    const replay = await call(
      "aAdmin",
      "POST",
      `${base}/${program}/publications/${first.id}/restore`,
    );
    expect(replay.body).toMatchObject({
      created: false,
      publication: { generation: 3 },
    });
    // Another company's publication is not restorable here.
    expect(
      code(
        await call(
          "aAdmin",
          "POST",
          `${base}/${program}/publications/${randomUUID()}/restore`,
        ),
      ),
    ).toBe("RESOURCE_NOT_FOUND");

    // Superseded more than 90 days ago and reported by no screen: pruned.
    // Reported in use within seven days: kept.
    const reporter = await screen(companyA, a2.id, "Memória");
    await sync(reporter, {
      active: {
        publicationId: second.id,
        activatedAt: new Date().toISOString(),
      },
      playback: "PLAYING",
    });
    await sql.query(
      "UPDATE publications SET superseded_at = now() - interval '91 days', published_at = now() - interval '92 days' WHERE id = ANY($1::uuid[])",
      [[first.id, second.id]],
    );
    const pruning = await publications.maintain();
    expect(pruning.pruned).toBeGreaterThanOrEqual(1);
    const history = await call(
      "aAdmin",
      "GET",
      `${base}/${program}/publications`,
    );
    expect(
      (history.body.items as { generation: number; state: string }[]).map(
        (row) => [row.generation, row.state],
      ),
    ).toEqual([
      [3, "current"],
      [2, "retained"],
      [1, "pruned"],
    ]);
    expect(
      code(
        await call(
          "aAdmin",
          "POST",
          `${base}/${program}/publications/${first.id}/restore`,
        ),
      ),
    ).toBe("PUBLICATION_NOT_RESTORABLE");
    // Generation 3 still holds the promotion's media.
    expect(
      code(
        await call(
          "aAdmin",
          "POST",
          `/companies/${companyA}/media/${special}/delete`,
          { body: { expectedVersion: archived.body.version } },
        ),
      ),
    ).toBe("MEDIA_IN_USE");
    // The guard and the publication facts query through the caller's
    // transaction, so they hold even while the module is unmounted.
    let guard: MediaReferenceGuard | undefined;
    let facts: PublicationFacts | undefined;
    let priceListener: PriceChangeListener | undefined;
    const unmounted = (): never => {
      throw new Error("not active");
    };
    createPublicationsModule({
      sessions,
      companies: {} as CompanyAccessPort,
      devices: {} as DevicePort,
      media: {
        registerReferenceGuard: (_kind, registered) => (guard = registered),
        requireSelectable: unmounted,
        describe: unmounted,
        describeForPublication: unmounted,
        openObject: unmounted,
      },
      programming: {
        onPublicationFacts: (registered) => (facts = registered),
        target: unmounted,
        snapshot: unmounted,
        currentProgram: unmounted,
        followers: unmounted,
        describePrograms: unmounted,
        programSource: unmounted,
        repriceCatalog: unmounted,
      },
      catalogs: {
        registerUsageGuard: unmounted,
        onPriceChange: (registered) => (priceListener = registered),
        requireBindable: unmounted,
        visible: unmounted,
        describe: unmounted,
        priceSequences: unmounted,
        viewData: unmounted,
      },
    });
    const protectedBy = await database.$transaction((tx) =>
      guard!(tx, companyA, special),
    );
    expect(protectedBy).toEqual([{ kind: "publication", branchId: a2.id }]);
    const programId = (
      await sql.query<{ program_id: string }>(
        "SELECT program_id FROM publications WHERE id = $1",
        [first.id],
      )
    ).rows[0].program_id;
    expect(
      await database.$transaction((tx) => facts!(tx, companyA, programId)),
    ).toBe(true);
    // Price changes reach the listener even while the module is unmounted;
    // a catalog no program shows needs no authorization.
    expect(
      await database.$transaction((tx) =>
        priceListener!(tx, {
          access: companyAccess({
            companyId: companyA,
            companyStatus: "ACTIVE",
            membershipId: randomUUID(),
            principalId: randomUUID(),
            responsible: false,
            grants: [],
          }),
          catalogId: randomUUID(),
          branchId: null,
          sequence: 1,
        }),
      ),
    ).toBe(true);

    // At most 30 publications per program per hour.
    await sql.query(
      `INSERT INTO publications (id, company_id, program_id, branch_ids, generation,
         protocol, content_sha256, manifest_sha256, manifest_size, rule_count,
         playlist_count, item_count, media_count, media_bytes,
         published_by_principal_id, published_by_membership_id, published_at,
         superseded_at, pruned_at)
       SELECT gen_random_uuid(), company_id, program_id, branch_ids, 100 + n,
         protocol, content_sha256, manifest_sha256, manifest_size, rule_count,
         playlist_count, item_count, media_count, media_bytes,
         published_by_principal_id, published_by_membership_id, now(), now(), now()
       FROM publications, generate_series(1, 30) AS n WHERE id = $1`,
      [first.id],
    );
    await schedule(program, [
      { ...morning, playlistId: plain.id, endTime: "11:00" },
    ]);
    const limited = await call(
      "aAdmin",
      "POST",
      `${base}/${program}/publications`,
      {
        body: {
          contentDigest: (await check(program)).body.contentDigest,
        },
      },
    );
    expect(code(limited)).toBe("RATE_LIMITED");
  });

  it("deletes a group's publications with the group", async () => {
    const temporary = await group("Temporário", [a1.id]);
    const only = await playlist(null, "Única", [{ mediaAssetId: png }]);
    await schedule(`groups/${temporary.id}`, [
      { ...morning, playlistId: only.id },
    ]);
    expect((await publish(`groups/${temporary.id}`)).status).toBe(201);
    const current = await call(
      "aAdmin",
      "GET",
      `${base}/groups/${temporary.id}`,
    );
    const deleted = await call(
      "aAdmin",
      "DELETE",
      `${base}/groups/${temporary.id}`,
      { body: { expectedVersion: current.body.version } },
    );
    expect(deleted.status, JSON.stringify(deleted.body)).toBe(204);
    const left = await sql.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM publications p JOIN programs g ON g.id = p.program_id WHERE g.group_id = $1",
      [temporary.id],
    );
    expect(left.rows[0].n).toBe(0);
  });
});
