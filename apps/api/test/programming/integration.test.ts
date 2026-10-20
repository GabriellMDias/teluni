import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createDatabase, type Database } from "../../src/database.js";
import { createCatalogsModule } from "../../src/features/catalogs/module.js";
import { createDevicesModule } from "../../src/features/devices/module.js";
import type { HumanSessionPort } from "../../src/features/identity/public.js";
import { createMediaModule } from "../../src/features/media/module.js";
import { createOrganizationsModule } from "../../src/features/organizations/module.js";
import { createProgrammingModule } from "../../src/features/programming/module.js";
import { activateModules, type ApiModule } from "../../src/module.js";
import { withMigratedDatabase } from "../../scripts/migrated-database.js";
import { createFixtures, type Fixtures } from "../media/fixtures.js";

// Two-company suite of the programming design against PostgreSQL, with the
// real organizations, devices and media modules. A synthetic session port
// stands in for the identity module so tests choose the verified principal
// and assurance.
type App = ReturnType<typeof createApp>["app"];
let app: App;
let sql: pg.Client;
let database: Database;
let release: () => void;
let stopped: Promise<void>;
let root: string;
let fixtures: Fixtures;
let media: ReturnType<typeof createMediaModule>;

const people = {
  aAdmin: randomUUID(),
  aManager: randomUUID(),
  aOperator: randomUUID(),
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
  root = await mkdtemp(join(tmpdir(), "teluni-programming-"));
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
    const { module: programming } = createProgrammingModule({
      sessions,
      companies: organizations.companies,
      devices: devices.devices,
      media: media.media,
      catalogs: catalogs.catalogs,
      limits,
    });
    const modules = activateModules(
      [
        identityStub,
        organizations.module,
        devices.module,
        media.module,
        catalogs.module,
        programming,
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
      },
      "test",
    );
    expect(modules.map((module) => module.name)).toContain("programming");
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
            // Administrator and manager grants need two-step verification.
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

async function grantBranches(
  person: Person,
  companyId: string,
  role: "BRANCH_MANAGER" | "OPERATOR",
  branchIds: string[],
) {
  const membership = randomUUID();
  const grant = randomUUID();
  await sql.query(
    "INSERT INTO memberships (id, company_id, principal_id) VALUES ($1, $2, $3)",
    [membership, companyId, people[person]],
  );
  await sql.query(
    "INSERT INTO membership_grants (id, company_id, membership_id, role, scope) VALUES ($1, $2, $3, $4, 'BRANCHES')",
    [grant, companyId, membership, role],
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

/** Enrolls a simulated screen and pairs it to a branch. */
async function screen(companyId: string, branchId: string, name: string) {
  const bytes = randomBytes(32);
  const started = await call(null, "POST", "/device-enrollments", {
    body: {
      credentialHash: createHash("sha256").update(bytes).digest("base64url"),
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
  const paired = await call(
    "aAdmin",
    "POST",
    `/companies/${companyId}/devices`,
    {
      strong: true,
      body: { userCode: started.body.userCode, name, branchId, rotation: 0 },
    },
  );
  expect(paired.status, JSON.stringify(paired.body)).toBe(201);
  return paired.body;
}

const everyDay = [1, 2, 3, 4, 5, 6, 7];
const morning = {
  weekdays: everyDay,
  allDay: false,
  startTime: "08:00",
  endTime: "12:00",
  startsOn: "2027-01-04",
};

describe("programming: playlists, groups, schedules and assignments", () => {
  let companyA: string;
  let companyB: string;
  let a1: Body;
  let a2: Body;
  let png: string;
  let a1Png: string;
  let a2Png: string;
  let video: string;
  let bPng: string;
  let base: string;

  beforeAll(async () => {
    companyA = await createCompany("aAdmin", "Lanchonete A");
    companyB = await createCompany("bAdmin", "Clínica B");
    a1 = await createBranch("aAdmin", companyA, "Centro");
    a2 = await createBranch("aAdmin", companyA, "Bairro");
    await grantBranches("aManager", companyA, "BRANCH_MANAGER", [a1.id]);
    await grantBranches("aOperator", companyA, "OPERATOR", [a1.id]);
    png = await ready(companyA, fixtures.pngAlpha, null);
    a1Png = await ready(companyA, fixtures.pngAlpha, a1.id);
    a2Png = await ready(companyA, fixtures.pngAlpha, a2.id);
    video = await ready(companyA, fixtures.videoCompliant, null);
    bPng = await ready(companyB, fixtures.pngAlpha, null, "bAdmin");
    base = `/companies/${companyA}/programming`;
  }, 300_000);

  async function playlist(
    person: Person,
    branchId: string | null,
    name: string,
  ): Promise<Body> {
    const created = await call(person, "POST", `${base}/playlists`, {
      body: { name, branchId },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    return created.body;
  }

  async function items(
    person: Person,
    item: Body,
    entries: { mediaAssetId: string; durationSeconds?: number | null }[],
  ) {
    return call(person, "PUT", `${base}/playlists/${item.id}/items`, {
      body: { expectedVersion: item.version, items: entries },
    });
  }

  it("authors playlists in scope with ordered items and durations", async () => {
    const shared = await playlist("aAdmin", null, "  Cardápio   geral ");
    expect(shared).toMatchObject({
      name: "Cardápio geral",
      branch: null,
      transition: "CUT",
      fadeMs: null,
      items: [],
      version: 1,
    });
    const saved = await items("aAdmin", shared, [
      { mediaAssetId: png },
      { mediaAssetId: video },
      { mediaAssetId: png, durationSeconds: 30 },
    ]);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const list = saved.body.items as { kind: string; durationMs: number }[];
    expect(list.map((entry) => entry.kind)).toEqual([
      "IMAGE",
      "VIDEO",
      "IMAGE",
    ]);
    expect(list[0].durationMs).toBe(10_000);
    expect(list[2].durationMs).toBe(30_000);
    expect(saved.body.videoCount).toBe(1);
    expect(saved.body.version).toBe(2);
    // A video has no duration of its own to set.
    expect(
      code(
        await items("aAdmin", saved.body, [
          { mediaAssetId: video, durationSeconds: 5 },
        ]),
      ),
    ).toBe("VALIDATION_FAILED");
    expect(code(await items("aAdmin", shared, [{ mediaAssetId: png }]))).toBe(
      "RESOURCE_VERSION_CONFLICT",
    );
    // Branch media does not fit a company playlist or another branch's.
    expect(
      code(await items("aAdmin", saved.body, [{ mediaAssetId: a1Png }])),
    ).toBe("PLAYLIST_SCOPE_MISMATCH");
    const local = await playlist("aOperator", a1.id, "Centro manhã");
    expect(code(await items("aAdmin", local, [{ mediaAssetId: a2Png }]))).toBe(
      "PLAYLIST_SCOPE_MISMATCH",
    );
    const filled = await items("aOperator", local, [
      { mediaAssetId: a1Png },
      { mediaAssetId: png },
    ]);
    expect(filled.status, JSON.stringify(filled.body)).toBe(200);
    // Media of another branch is invisible to a branch member.
    expect(
      code(await items("aOperator", filled.body, [{ mediaAssetId: a2Png }])),
    ).toBe("RESOURCE_NOT_FOUND");
    // Another company's media does not exist here.
    expect(
      code(await items("aAdmin", filled.body, [{ mediaAssetId: bPng }])),
    ).toBe("RESOURCE_NOT_FOUND");
    const fade = await call(
      "aOperator",
      "PATCH",
      `${base}/playlists/${local.id}`,
      {
        body: {
          expectedVersion: filled.body.version,
          transition: "FADE",
          fadeMs: 500,
        },
      },
    );
    expect(fade.body).toMatchObject({ transition: "FADE", fadeMs: 500 });
  });

  it("limits playlist authority and visibility to the caller's scope", async () => {
    expect(
      code(
        await call("aOperator", "POST", `${base}/playlists`, {
          body: { name: "Empresa", branchId: null },
        }),
      ),
    ).toBe("PERMISSION_DENIED");
    const elsewhere = await playlist("aAdmin", a2.id, "Bairro noite");
    expect(
      code(await call("aManager", "GET", `${base}/playlists/${elsewhere.id}`)),
    ).toBe("RESOURCE_NOT_FOUND");
    const list = await call("aManager", "GET", `${base}/playlists?limit=100`);
    const names = (list.body.items as { name: string }[]).map((p) => p.name);
    expect(names).toContain("Cardápio geral");
    expect(names).toContain("Centro manhã");
    expect(names).not.toContain("Bairro noite");
    const page = await call("aAdmin", "GET", `${base}/playlists?limit=1`);
    expect(page.body.nextCursor).toEqual(expect.any(String));
    const next = await call(
      "aAdmin",
      "GET",
      `${base}/playlists?limit=1&cursor=${page.body.nextCursor as string}`,
    );
    expect(next.status).toBe(200);
    expect(
      code(
        await call(
          "aManager",
          "GET",
          `${base}/playlists?limit=1&cursor=${page.body.nextCursor as string}`,
        ),
      ),
    ).toBe("VALIDATION_FAILED");
    expect(
      code(
        await call(
          "bAdmin",
          "GET",
          `/companies/${companyB}/programming/playlists/${elsewhere.id}`,
        ),
      ),
    ).toBe("RESOURCE_NOT_FOUND");
  });

  it("protects media used by playlists from deletion", async () => {
    const used = await ready(companyA, fixtures.pngAlpha, null);
    const holder = await playlist("aAdmin", null, "Proteção");
    await items("aAdmin", holder, [{ mediaAssetId: used }]);
    const archived = await call(
      "aAdmin",
      "POST",
      `/companies/${companyA}/media/${used}/archive`,
      { strong: true, body: { expectedVersion: 3 } },
    );
    expect(archived.status, JSON.stringify(archived.body)).toBe(200);
    expect(
      code(
        await call(
          "aAdmin",
          "POST",
          `/companies/${companyA}/media/${used}/delete`,
          {
            strong: true,
            body: { expectedVersion: archived.body.version },
          },
        ),
      ),
    ).toBe("MEDIA_IN_USE");
    // Archived media stays in the playlist and cannot be added again.
    const kept = await call("aAdmin", "GET", `${base}/playlists/${holder.id}`);
    expect(kept.body.items).toEqual([
      expect.objectContaining({ mediaAssetId: used, mediaStatus: "ARCHIVED" }),
    ]);
    expect(
      code(
        await items("aAdmin", kept.body, [
          { mediaAssetId: used },
          { mediaAssetId: used },
        ]),
      ),
    ).toBe(undefined);
    const other = await playlist("aAdmin", null, "Outra");
    expect(code(await items("aAdmin", other, [{ mediaAssetId: used }]))).toBe(
      "MEDIA_NOT_READY",
    );
  });

  it("manages groups across branches with span visibility and archive guards", async () => {
    const created = await call("aAdmin", "POST", `${base}/groups`, {
      body: { name: "Rede", allBranches: false, branchIds: [a1.id, a2.id] },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.branches).toHaveLength(2);
    expect(
      code(
        await call("aAdmin", "POST", `${base}/groups`, {
          body: { name: "REDE", allBranches: true, branchIds: [] },
        }),
      ),
    ).toBe("GROUP_NAME_IN_USE");
    // A manager of one branch cannot see a group that spans two.
    expect(
      code(await call("aManager", "GET", `${base}/groups/${created.body.id}`)),
    ).toBe("RESOURCE_NOT_FOUND");
    const visible = await call("aManager", "GET", `${base}/groups`);
    expect(
      (visible.body.items as { name: string }[]).map((g) => g.name),
    ).not.toContain("Rede");
    expect(
      code(
        await call("aManager", "POST", `${base}/groups`, {
          body: { name: "Centro", allBranches: false, branchIds: [a2.id] },
        }),
      ),
    ).toBe("PERMISSION_DENIED");
    const own = await call("aManager", "POST", `${base}/groups`, {
      body: { name: "Centro", allBranches: false, branchIds: [a1.id] },
    });
    expect(own.status).toBe(201);
    // A branch named by a group's span cannot be archived.
    const archive = await call(
      "aAdmin",
      "POST",
      `/companies/${companyA}/branches/${a2.id}/archive`,
      { strong: true, body: { expectedVersion: a2.version } },
    );
    expect(code(archive)).toBe("BRANCH_IN_USE");
    const narrowed = await call(
      "aAdmin",
      "PATCH",
      `${base}/groups/${created.body.id}`,
      {
        body: {
          expectedVersion: created.body.version,
          allBranches: false,
          branchIds: [a1.id],
        },
      },
    );
    expect(narrowed.status, JSON.stringify(narrowed.body)).toBe(200);
    const removed = await call(
      "aAdmin",
      "DELETE",
      `${base}/groups/${created.body.id}`,
      { body: { expectedVersion: narrowed.body.version } },
    );
    expect(removed.status).toBe(204);
  });

  it("validates schedules, playlist reach and playlist deletion", async () => {
    const group = await call("aAdmin", "POST", `${base}/groups`, {
      body: {
        name: "Duas lojas",
        allBranches: false,
        branchIds: [a1.id, a2.id],
      },
    });
    const shared = await playlist("aAdmin", null, "Almoço");
    const local = await playlist("aAdmin", a1.id, "Centro tarde");
    const output = `${base}/groups/${group.body.id}/program/outputs/screen`;
    const program = await call(
      "aAdmin",
      "GET",
      `${base}/groups/${group.body.id}/program`,
    );
    expect(program.body).toMatchObject({
      version: 1,
      layout: null,
      outputs: [
        {
          key: "screen",
          kind: "screen",
          name: null,
          defaultPlaylistId: null,
          defaultPlaylist: null,
          rules: [],
        },
      ],
    });
    const overlapping = [
      { ...morning, playlistId: shared.id },
      {
        ...morning,
        playlistId: shared.id,
        startTime: "11:00",
        endTime: "13:00",
      },
    ];
    expect(
      code(
        await call("aAdmin", "PUT", output, {
          body: {
            expectedVersion: 1,
            defaultPlaylistId: null,
            rules: overlapping,
          },
        }),
      ),
    ).toBe("SCHEDULE_CONFLICT");
    const check = await call("aOperator", "POST", `${base}/rule-checks`, {
      body: {
        rules: [
          ...overlapping,
          {
            ...morning,
            playlistId: shared.id,
            startTime: "09:00",
            endTime: "09:00",
          },
        ],
      },
    });
    expect(check.body).toEqual({
      issues: [{ index: 2, code: "SCHEDULE_TIMES_EQUAL" }],
      conflicts: [{ first: 0, second: 1, date: "2027-01-04" }],
    });
    expect(
      code(
        await call("aAdmin", "PUT", output, {
          body: {
            expectedVersion: 1,
            defaultPlaylistId: null,
            rules: [{ ...morning, playlistId: local.id }],
          },
        }),
      ),
    ).toBe("PLAYLIST_SCOPE_MISMATCH");
    const saved = await call("aAdmin", "PUT", output, {
      body: {
        expectedVersion: 1,
        defaultPlaylistId: shared.id,
        rules: [
          { ...morning, playlistId: shared.id },
          {
            ...morning,
            playlistId: shared.id,
            startTime: "12:00",
            endTime: "14:00",
          },
        ],
      },
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.version).toBe(2);
    expect(
      (saved.body.outputs as { rules: { startTime: string }[] }[])[0].rules.map(
        (rule) => rule.startTime,
      ),
    ).toEqual(["08:00", "12:00"]);
    expect(
      code(
        await call("aAdmin", "DELETE", `${base}/playlists/${shared.id}`, {
          body: { expectedVersion: shared.version },
        }),
      ),
    ).toBe("PLAYLIST_IN_USE");
    expect(
      (
        await call("aAdmin", "DELETE", `${base}/playlists/${local.id}`, {
          body: { expectedVersion: local.version },
        })
      ).status,
    ).toBe(204);
    // A member of one branch cannot preview a group spanning two.
    const timeline = await call(
      "aOperator",
      "GET",
      `${base}/groups/${group.body.id}/timeline?timeZone=America/Sao_Paulo&from=2027-01-04T00:00:00Z&to=2027-01-05T00:00:00Z`,
    );
    expect(code(timeline)).toBe("RESOURCE_NOT_FOUND");
  });

  it("assigns screens with confirmation and evaluates their timelines", async () => {
    const device = await screen(companyA, a1.id, "Caixa 1");
    const group = await call("aAdmin", "POST", `${base}/groups`, {
      body: { name: "Somente centro", allBranches: false, branchIds: [a1.id] },
    });
    const shared = await playlist("aAdmin", null, "Manhã");
    await call(
      "aAdmin",
      "PUT",
      `${base}/groups/${group.body.id}/program/outputs/screen`,
      {
        body: {
          expectedVersion: 1,
          defaultPlaylistId: null,
          rules: [{ ...morning, playlistId: shared.id }],
        },
      },
    );
    const programming = `${base}/devices/${device.id}`;
    const before = await call("aOperator", "GET", programming);
    expect(before.body).toMatchObject({
      group: null,
      individual: false,
      source: "individual",
      version: 0,
      device: { timeZone: null, branch: { timeZone: "America/Sao_Paulo" } },
    });
    const assignment = {
      expectedVersion: 0,
      groupId: group.body.id,
      individual: false,
      confirmUnpublished: false,
    };
    expect(
      code(
        await call("aAdmin", "PUT", `${programming}/assignment`, {
          strong: true,
          body: assignment,
        }),
      ),
    ).toBe("ASSIGNMENT_CONFIRMATION_REQUIRED");
    expect(
      code(
        await call("aOperator", "PUT", `${programming}/assignment`, {
          strong: true,
          body: { ...assignment, confirmUnpublished: true },
        }),
      ),
    ).toBe("PERMISSION_DENIED");
    const assigned = await call(
      "aManager",
      "PUT",
      `${programming}/assignment`,
      {
        strong: true,
        body: { ...assignment, confirmUnpublished: true },
      },
    );
    expect(assigned.status, JSON.stringify(assigned.body)).toBe(200);
    expect(assigned.body).toMatchObject({
      group: { id: group.body.id, name: "Somente centro" },
      source: "group",
      version: 1,
    });
    const range = "from=2027-01-04T00:00:00Z&to=2027-01-05T00:00:00Z";
    const local = await call(
      "aOperator",
      "GET",
      `${programming}/timeline?${range}`,
    );
    expect(local.status, JSON.stringify(local.body)).toBe(200);
    expect(local.body).toMatchObject({
      source: { kind: "group", group: { id: group.body.id } },
      timeZone: "America/Sao_Paulo",
    });
    const segments = local.body.segments as {
      start: string;
      end: string;
      source: string;
      playlist: { name: string } | null;
    }[];
    expect(
      segments.map(({ start, end, source }) => [start, end, source]),
    ).toEqual([
      ["2027-01-04T00:00:00Z", "2027-01-04T11:00:00Z", "none"],
      ["2027-01-04T11:00:00Z", "2027-01-04T15:00:00Z", "rule"],
      ["2027-01-04T15:00:00Z", "2027-01-05T00:00:00Z", "none"],
    ]);
    expect(segments[1].playlist?.name).toBe("Manhã");
    // An explicit screen zone moves the same local hours.
    const current = await call(
      "aAdmin",
      "GET",
      `/companies/${companyA}/devices/${device.id}`,
    );
    const zoned = await call(
      "aAdmin",
      "PATCH",
      `/companies/${companyA}/devices/${device.id}`,
      {
        strong: true,
        body: {
          expectedVersion: current.body.version,
          timeZone: "Europe/Lisbon",
        },
      },
    );
    expect(zoned.status, JSON.stringify(zoned.body)).toBe(200);
    expect(zoned.body.timeZone).toBe("Europe/Lisbon");
    const lisbon = await call(
      "aOperator",
      "GET",
      `${programming}/timeline?${range}`,
    );
    expect(
      (lisbon.body.segments as { start: string; source: string }[]).find(
        (segment) => segment.source === "rule",
      )?.start,
    ).toBe("2027-01-04T08:00:00Z");
    expect(
      code(
        await call(
          "aAdmin",
          "PATCH",
          `/companies/${companyA}/devices/${device.id}`,
          {
            strong: true,
            body: {
              expectedVersion: zoned.body.version,
              timeZone: "Mars/Olympus",
            },
          },
        ),
      ),
    ).toBe("VALIDATION_FAILED");
    // Members keep their group from being deleted or narrowed away.
    expect(
      code(
        await call("aAdmin", "DELETE", `${base}/groups/${group.body.id}`, {
          body: { expectedVersion: group.body.version },
        }),
      ),
    ).toBe("GROUP_HAS_MEMBERS");
    expect(
      code(
        await call("aAdmin", "PATCH", `${base}/groups/${group.body.id}`, {
          body: {
            expectedVersion: group.body.version,
            allBranches: false,
            branchIds: [a2.id],
          },
        }),
      ),
    ).toBe("GROUP_SPAN_EXCLUDES_DEVICE");
    // Individual programming keeps the membership and uses the screen's own program.
    const individual = await call(
      "aAdmin",
      "PUT",
      `${programming}/assignment`,
      {
        strong: true,
        body: {
          expectedVersion: 1,
          groupId: group.body.id,
          individual: true,
          confirmUnpublished: true,
        },
      },
    );
    expect(individual.body).toMatchObject({ source: "individual", version: 2 });
    const own = await call(
      "aOperator",
      "GET",
      `${programming}/timeline?${range}`,
    );
    expect(own.body.source).toEqual({ kind: "individual" });
    expect(
      (own.body.segments as { source: string }[]).map((s) => s.source),
    ).toEqual(["none"]);
    const ownOutput = await call(
      "aOperator",
      "PUT",
      `${programming}/program/outputs/screen`,
      {
        body: {
          expectedVersion: 0,
          defaultPlaylistId: shared.id,
          rules: [],
        },
      },
    );
    expect(ownOutput.status, JSON.stringify(ownOutput.body)).toBe(200);
    expect(ownOutput.body.version).toBe(1);
    // Moving the screen outside the group's span leaves the group.
    const latest = await call(
      "aAdmin",
      "GET",
      `/companies/${companyA}/devices/${device.id}`,
    );
    const moved = await call(
      "aAdmin",
      "POST",
      `/companies/${companyA}/devices/${device.id}/move`,
      {
        strong: true,
        body: { expectedVersion: latest.body.version, branchId: a2.id },
      },
    );
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    const after = await call("aAdmin", "GET", programming);
    expect(after.body).toMatchObject({
      group: null,
      individual: false,
      source: "individual",
      version: 3,
    });
    const { rows } = await sql.query<{ action: string }>(
      "SELECT action FROM programming_audit_events WHERE company_id = $1 AND subject_id = $2 ORDER BY occurred_at, id",
      [companyA, device.id],
    );
    expect(rows.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        "device.assignment_changed",
        "device.left_group_on_move",
      ]),
    );
    expect(
      code(
        await call(
          "bAdmin",
          "GET",
          `/companies/${companyB}/programming/devices/${device.id}`,
        ),
      ),
    ).toBe("RESOURCE_NOT_FOUND");
  });

  it("hides groups and playlists outside the caller's access from a screen", async () => {
    const range = "from=2027-01-04T00:00:00Z&to=2027-01-05T00:00:00Z";
    const shared = await playlist("aAdmin", null, "Rede geral");
    const network = await call("aAdmin", "POST", `${base}/groups`, {
      body: {
        name: "Rede inteira",
        allBranches: false,
        branchIds: [a1.id, a2.id],
      },
    });
    expect(network.status, JSON.stringify(network.body)).toBe(201);
    await call(
      "aAdmin",
      "PUT",
      `${base}/groups/${network.body.id}/program/outputs/screen`,
      {
        body: {
          expectedVersion: 1,
          defaultPlaylistId: null,
          rules: [{ ...morning, playlistId: shared.id }],
        },
      },
    );
    const member = await screen(companyA, a1.id, "Vitrine 1");
    const memberPath = `${base}/devices/${member.id}`;
    const joined = await call("aAdmin", "PUT", `${memberPath}/assignment`, {
      strong: true,
      body: {
        expectedVersion: 0,
        groupId: network.body.id,
        individual: false,
        confirmUnpublished: true,
      },
    });
    expect(joined.status, JSON.stringify(joined.body)).toBe(200);
    // A manager of one branch sees the screen follow a group, not which one.
    const managed = await call("aManager", "GET", memberPath);
    expect(managed.body).toMatchObject({
      group: null,
      individual: false,
      source: "group",
    });
    const plays = await call(
      "aManager",
      "GET",
      `${memberPath}/timeline?${range}`,
    );
    expect(plays.status, JSON.stringify(plays.body)).toBe(200);
    expect(plays.body.source).toEqual({ kind: "group", group: null });
    expect(
      (plays.body.segments as { playlist: { name: string } | null }[]).map(
        (segment) => segment.playlist?.name ?? null,
      ),
    ).toEqual([null, "Rede geral", null]);
    expect(
      (await call("aAdmin", "GET", `${memberPath}/timeline?${range}`)).body
        .source,
    ).toEqual({
      kind: "group",
      group: { id: network.body.id, name: "Rede inteira" },
    });
    // A moved screen keeps playlists of its previous branch, unresolved for
    // a caller who cannot see that branch.
    const local = await playlist("aAdmin", a2.id, "Só no bairro");
    const mover = await screen(companyA, a2.id, "Vitrine 2");
    const moverPath = `${base}/devices/${mover.id}`;
    const own = await call(
      "aAdmin",
      "PUT",
      `${moverPath}/program/outputs/screen`,
      {
        body: {
          expectedVersion: 0,
          defaultPlaylistId: local.id,
          rules: [{ ...morning, playlistId: local.id }],
        },
      },
    );
    expect(own.status, JSON.stringify(own.body)).toBe(200);
    const device = await call(
      "aAdmin",
      "GET",
      `/companies/${companyA}/devices/${mover.id}`,
    );
    const moved = await call(
      "aAdmin",
      "POST",
      `/companies/${companyA}/devices/${mover.id}/move`,
      {
        strong: true,
        body: { expectedVersion: device.body.version, branchId: a1.id },
      },
    );
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    const program = await call("aManager", "GET", `${moverPath}/program`);
    expect(program.status, JSON.stringify(program.body)).toBe(200);
    expect(program.body.outputs).toMatchObject([
      {
        defaultPlaylistId: local.id,
        defaultPlaylist: null,
        rules: [{ playlistId: local.id, playlist: null }],
      },
    ]);
    const hidden = await call(
      "aManager",
      "GET",
      `${moverPath}/timeline?${range}`,
    );
    expect(
      (hidden.body.segments as { source: string; playlist: unknown }[]).map(
        ({ source, playlist }) => [source, playlist],
      ),
    ).toEqual([
      ["default", null],
      ["rule", null],
      ["default", null],
    ]);
    const full = await call("aAdmin", "GET", `${moverPath}/program`);
    expect(full.body.outputs).toMatchObject([
      { defaultPlaylist: { id: local.id, name: "Só no bairro" } },
    ]);
    // Keeping the old branch playlist is rejected for the new branch.
    expect(
      code(
        await call("aManager", "PUT", `${moverPath}/program/outputs/screen`, {
          body: {
            expectedVersion: program.body.version,
            defaultPlaylistId: local.id,
            rules: [],
          },
        }),
      ),
    ).toBe("PLAYLIST_SCOPE_MISMATCH");
    // So is its previous branch's layout, which the new branch sees without
    // its names until another layout replaces it.
    const bairro = await call("aAdmin", "POST", `${base}/layouts`, {
      body: {
        name: "Layout do bairro",
        branchId: a2.id,
        definition: {
          orientation: "landscape",
          areas: [
            {
              key: "main",
              name: "Área do bairro",
              x: 0,
              y: 0,
              width: 1920,
              height: 1080,
              z: 0,
              kind: "media",
            },
          ],
        },
      },
    });
    expect(bairro.status, JSON.stringify(bairro.body)).toBe(201);
    const framed = await screen(companyA, a2.id, "Vitrine 3");
    const framedPath = `${base}/devices/${framed.id}`;
    const chosen = await call("aAdmin", "PUT", `${framedPath}/program/layout`, {
      body: { expectedVersion: 0, layoutId: bairro.body.id },
    });
    expect(chosen.status, JSON.stringify(chosen.body)).toBe(200);
    const framedDevice = await call(
      "aAdmin",
      "GET",
      `/companies/${companyA}/devices/${framed.id}`,
    );
    expect(
      (
        await call(
          "aAdmin",
          "POST",
          `/companies/${companyA}/devices/${framed.id}/move`,
          {
            strong: true,
            body: {
              expectedVersion: framedDevice.body.version,
              branchId: a1.id,
            },
          },
        )
      ).status,
    ).toBe(200);
    const stale = await call("aManager", "GET", `${framedPath}/program`);
    expect(stale.body).toMatchObject({
      layout: { id: bairro.body.id, name: null },
      outputs: [{ key: "main", kind: "media", name: null }],
    });
    expect(
      (await call("aManager", "GET", `${framedPath}/timeline?${range}`)).body
        .outputs,
    ).toEqual([{ key: "main", kind: "media", name: null }]);
    expect(
      code(
        await call("aManager", "PUT", `${framedPath}/program/outputs/main`, {
          body: {
            expectedVersion: stale.body.version,
            defaultPlaylistId: null,
            rules: [],
          },
        }),
      ),
    ).toBe("LAYOUT_SCOPE_MISMATCH");
    const replaced = await call(
      "aManager",
      "PUT",
      `${framedPath}/program/layout`,
      { body: { expectedVersion: stale.body.version, layoutId: null } },
    );
    expect(replaced.body).toMatchObject({
      layout: null,
      outputs: [{ key: "screen" }],
    });
  });

  it("holds the playlist limit under concurrent creation", async () => {
    const companyC = await createCompany("aAdmin", "Rede C");
    await sql.query(
      `INSERT INTO playlists (id, company_id, branch_id, name, transition, fade_ms)
       SELECT gen_random_uuid(), $1, NULL, 'Lista ' || n, 'CUT', NULL
       FROM generate_series(1, 998) AS n`,
      [companyC],
    );
    const results = await Promise.all(
      [1, 2, 3, 4].map((n) =>
        call("aAdmin", "POST", `/companies/${companyC}/programming/playlists`, {
          body: { name: `Concorrente ${n}`, branchId: null },
        }),
      ),
    );
    expect(results.map((result) => result.status).sort()).toEqual([
      201, 201, 409, 409,
    ]);
    const { rows } = await sql.query<{ total: number }>(
      "SELECT count(*)::int AS total FROM playlists WHERE company_id = $1",
      [companyC],
    );
    expect(rows[0].total).toBe(1_000);
  });
});
