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
import { createProgrammingModule } from "../../src/features/programming/module.js";
import { createPublicationsModule } from "../../src/features/publications/module.js";
import type { DevicePort } from "../../src/features/devices/public.js";
import type { MediaReferenceGuard } from "../../src/features/media/public.js";
import type { CompanyAccessPort } from "../../src/features/organizations/public.js";
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
    const strong = headers["x-test-strong"] === "true";
    return Promise.resolve({
      principalId,
      sessionId: randomUUID(),
      assuranceLevel: strong ? "teluni-aal2" : "teluni-aal1",
      authenticatedAt: new Date(),
      strongAuthenticatedAt: strong ? new Date() : null,
      strongAuthenticationAgeSeconds: strong ? 1 : null,
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
    const programming = createProgrammingModule({
      sessions,
      companies: organizations.companies,
      devices: devices.devices,
      media: media.media,
      limits,
    });
    publications = createPublicationsModule({
      sessions,
      companies: organizations.companies,
      devices: devices.devices,
      media: media.media,
      programming: programming.programming,
      limits: { ...limits, devices: limits.requests },
      manual: true,
    });
    const modules = activateModules(
      [
        identityStub,
        organizations.module,
        devices.module,
        media.module,
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
    strong?: boolean;
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
            "x-test-strong": String(options.strong ?? person !== "aOperator"),
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
    { strong: true, body: { name } },
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
    strong: true,
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
    { strong: true, bytes },
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
    json(): Body;
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
    strong: true,
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
        json: () => response.json<Body>(),
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
async function verified(statement: unknown) {
  const { payload, protectedHeader } = await compactVerify(
    statement as string,
    keySet,
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
    expect(
      code(
        await call(
          "aPublisher",
          "POST",
          `${base}/groups/${centro.id}/publications/check`,
          { strong: false },
        ),
      ),
    ).toBe("STRONG_AUTHENTICATION_REQUIRED");
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
      ).json() as unknown as JSONWebKeySet,
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
    // The zone's offsets cover two days before to 35 days after the
    // server's time, so the screen never needs its own zone data.
    const serverTime = Date.parse(synced.body.serverTime as string);
    const offsets = synced.body.zoneOffsets as {
      until: string;
      periods: { from: string; offsetSeconds: number }[];
    };
    expect(Date.parse(offsets.until) - serverTime).toBe(35 * 86_400_000);
    expect(serverTime - Date.parse(offsets.periods[0].from)).toBe(
      2 * 86_400_000,
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
            body: { ...idle, protocols: [2] },
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
