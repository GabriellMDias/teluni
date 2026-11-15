import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createDatabase, type Database } from "../../src/database.js";
import type { HumanSessionPort } from "../../src/features/identity/public.js";
import { mediaBackupLockKey } from "../../src/features/media/domain.js";
import { createMediaModule } from "../../src/features/media/module.js";
import { PrismaMediaRepository } from "../../src/features/media/prisma-repository.js";
import { MediaObjectStore } from "../../src/features/media/storage.js";
import type { MediaReference } from "../../src/features/media/public.js";
import { createOrganizationsModule } from "../../src/features/organizations/module.js";
import { activateModules, type ApiModule } from "../../src/module.js";
import { withMigratedDatabase } from "../../scripts/migrated-database.js";
import { createFixtures, type Fixtures } from "./fixtures.js";

// Two-company suite of the media library design with real FFmpeg and
// PostgreSQL. A synthetic session port stands in for the identity module so
// tests choose the verified principal and assurance.
type App = ReturnType<typeof createApp>["app"];
let app: App;
let sql: pg.Client;
let database: Database;
let release: () => void;
let stopped: Promise<void>;
let root: string;
let fixtures: Fixtures;
let media: ReturnType<typeof createMediaModule>;
const protectedAssets = new Map<string, MediaReference[]>();

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
  root = await mkdtemp(join(tmpdir(), "teluni-media-"));
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
    const organizations = createOrganizationsModule({
      sessions,
      profiles: { getMany: () => Promise.resolve([]) },
      rateLimit: { max: 10_000, timeWindow: 60_000 },
    });
    media = createMediaModule({
      sessions,
      companies: organizations.companies,
      limits: { requests: { max: 10_000, timeWindow: 60_000 } },
      manual: true,
    });
    media.media.registerReferenceGuard("test", (_tx, _companyId, assetId) =>
      Promise.resolve(protectedAssets.get(assetId) ?? []),
    );
    const modules = activateModules(
      [identityStub, organizations.module, media.module],
      {
        database,
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
    expect(modules.map((module) => module.name)).toContain("media");
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

type Result = {
  status: number;
  headers: Record<string, unknown>;
  body: Record<string, unknown> & { id: string; error?: { code: string } };
  raw: Buffer;
};

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
  const json = (response.headers["content-type"] ?? "")
    .toString()
    .includes("json");
  return {
    status: response.statusCode,
    headers: response.headers,
    body: json ? response.json<Result["body"]>() : ({} as Result["body"]),
    raw: response.rawPayload,
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
  return created.body as { id: string; version: number };
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

const contentTypes: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  mp4: "video/mp4",
  webm: "video/webm",
  txt: "image/png",
};

/** Creates an item and uploads a file to it, returning the item after upload. */
async function upload(
  person: Person,
  companyId: string,
  file: string,
  options: {
    branchId?: string | null;
    contentType?: string;
    name?: string;
  } = {},
) {
  const bytes = await readFile(file);
  const extension = file.split(".").pop() ?? "";
  const created = await call(person, "POST", `/companies/${companyId}/media`, {
    body: {
      name: options.name ?? file.split("/").pop(),
      branchId: options.branchId ?? null,
      contentType: options.contentType ?? contentTypes[extension],
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
  expect(sent.body.status).toBe("PROCESSING");
  return sent.body;
}

async function processAll() {
  while ((await media.runOnce()) > 0);
}

async function get(person: Person, companyId: string, id: string) {
  return call(person, "GET", `/companies/${companyId}/media/${id}`, {});
}

async function probeBytes(bytes: Buffer) {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { writeFile } = await import("node:fs/promises");
  const path = join(root, `probe-${randomUUID()}`);
  await writeFile(path, bytes);
  const { stdout } = await promisify(execFile)("ffprobe", [
    "-v",
    "error",
    "-show_streams",
    "-show_format",
    "-of",
    "json",
    path,
  ]);
  await rm(path);
  return JSON.parse(stdout) as {
    streams: {
      codec_type: string;
      codec_name: string;
      width?: number;
      height?: number;
      side_data_list?: unknown[];
    }[];
    format: { tags?: Record<string, string> };
  };
}

describe("media: upload, processing, scope and lifecycle", () => {
  let companyA: string;
  let companyB: string;
  let a1: { id: string };
  let a2: { id: string };

  beforeAll(async () => {
    companyA = await createCompany("aAdmin", "Lanchonete A");
    companyB = await createCompany("bAdmin", "Clínica B");
    a1 = await createBranch("aAdmin", companyA, "Centro");
    a2 = await createBranch("aAdmin", companyA, "Bairro");
    await grantBranches("aManager", companyA, "BRANCH_MANAGER", [a1.id]);
    await grantBranches("aOperator", companyA, "OPERATOR", [a1.id]);
  }, 60_000);

  it("prepares a rotated JPEG: orientation applied and metadata removed", async () => {
    const item = await upload("aAdmin", companyA, fixtures.jpegRotated);
    await processAll();
    const ready = await get("aAdmin", companyA, item.id);
    expect(ready.body.status).toBe("READY");
    // 640×480 with EXIF orientation 6 is displayed 480×640.
    expect(ready.body.width).toBe(480);
    expect(ready.body.height).toBe(640);
    const display = await call(
      "aAdmin",
      "GET",
      `/companies/${companyA}/media/${item.id}/content?variant=display`,
      {},
    );
    expect(display.status).toBe(200);
    expect(display.headers["content-type"]).toBe("image/jpeg");
    expect(display.headers["x-content-type-options"]).toBe("nosniff");
    expect(display.headers["content-security-policy"]).toContain("sandbox");
    expect(display.raw.includes(Buffer.from("Exif\0\0", "latin1"))).toBe(false);
    const probed = await probeBytes(display.raw);
    expect(probed.streams[0]).toMatchObject({ width: 480, height: 640 });
    const original = await call(
      "aAdmin",
      "GET",
      `/companies/${companyA}/media/${item.id}/content?variant=original`,
      {},
    );
    expect(original.raw.equals(await readFile(fixtures.jpegRotated))).toBe(
      true,
    );
    expect(original.headers["content-disposition"]).toMatch(/^attachment;/);
    const revalidated = await call(
      "aAdmin",
      "GET",
      `/companies/${companyA}/media/${item.id}/content?variant=display`,
      {
        headers: { "if-none-match": String(display.headers.etag) },
      },
    );
    expect(revalidated.status).toBe(304);
  }, 60_000);

  it("keeps transparency as PNG", async () => {
    const item = await upload("aAdmin", companyA, fixtures.pngAlpha);
    await processAll();
    const ready = await get("aAdmin", companyA, item.id);
    expect(ready.body.status).toBe("READY");
    const thumbnail = await call(
      "aAdmin",
      "GET",
      `/companies/${companyA}/media/${item.id}/content?variant=thumbnail`,
      {},
    );
    expect(thumbnail.headers["content-type"]).toBe("image/png");
  }, 60_000);

  it("rejects spoofed, mismatched, oversized, animated and truncated images", async () => {
    const cases: [string, string | undefined, string[]][] = [
      [fixtures.text, "image/png", ["MEDIA_TYPE_UNSUPPORTED"]],
      [fixtures.pngAlpha, "image/jpeg", ["MEDIA_TYPE_MISMATCH"]],
      [fixtures.pngTooWide, undefined, ["MEDIA_DIMENSIONS_EXCEEDED"]],
      [
        fixtures.webpAnimated,
        undefined,
        ["MEDIA_TYPE_UNSUPPORTED", "MEDIA_UNREADABLE"],
      ],
      [fixtures.jpegTruncated, undefined, ["MEDIA_UNREADABLE"]],
    ];
    const ids: [string, string[]][] = [];
    for (const [file, contentType, reasons] of cases)
      ids.push([
        (await upload("aAdmin", companyA, file, { contentType })).id,
        reasons,
      ]);
    await processAll();
    for (const [id, reasons] of ids) {
      const rejected = await get("aAdmin", companyA, id);
      expect(rejected.body.status).toBe("REJECTED");
      expect(reasons).toContain(rejected.body.rejectionReason);
      const { rows } = await sql.query<{ original_sha256: Buffer | null }>(
        "SELECT original_sha256 FROM media_assets WHERE id = $1",
        [id],
      );
      expect(rows[0].original_sha256).toBeNull();
    }
  }, 120_000);

  it("remuxes a compliant video and transcodes or rotates the others", async () => {
    const compliant = await upload("aAdmin", companyA, fixtures.videoCompliant);
    const vp9 = await upload("aAdmin", companyA, fixtures.videoVp9);
    const rotated = await upload("aAdmin", companyA, fixtures.videoRotated);
    const long = await upload("aAdmin", companyA, fixtures.videoTooLong);
    await processAll();
    const ready = await get("aAdmin", companyA, compliant.id);
    expect(ready.body).toMatchObject({
      status: "READY",
      width: 320,
      height: 240,
      hasAudio: true,
    });
    expect(ready.body.durationMs as number).toBeGreaterThan(1500);
    const display = await call(
      "aAdmin",
      "GET",
      `/companies/${companyA}/media/${compliant.id}/content?variant=display`,
      {},
    );
    const remuxed = await probeBytes(display.raw);
    expect(remuxed.streams.map((stream) => stream.codec_name).sort()).toEqual([
      "aac",
      "h264",
    ]);
    const partial = await call(
      "aAdmin",
      "GET",
      `/companies/${companyA}/media/${compliant.id}/content?variant=display`,
      { headers: { range: "bytes=0-99" } },
    );
    expect(partial.status).toBe(206);
    expect(partial.raw.length).toBe(100);
    expect(partial.headers["content-range"]).toBe(
      `bytes 0-99/${display.raw.length}`,
    );
    const unsatisfiable = await call(
      "aAdmin",
      "GET",
      `/companies/${companyA}/media/${compliant.id}/content?variant=display`,
      { headers: { range: `bytes=${display.raw.length}-` } },
    );
    expect(unsatisfiable.status).toBe(416);

    const transcoded = await get("aAdmin", companyA, vp9.id);
    expect(transcoded.body).toMatchObject({ status: "READY", hasAudio: false });
    const vp9Display = await call(
      "aAdmin",
      "GET",
      `/companies/${companyA}/media/${vp9.id}/content?variant=display`,
      {},
    );
    const vp9Probe = await probeBytes(vp9Display.raw);
    expect(vp9Probe.streams[0].codec_name).toBe("h264");

    const portrait = await get("aAdmin", companyA, rotated.id);
    expect(portrait.body).toMatchObject({
      status: "READY",
      width: 240,
      height: 320,
    });
    const rotatedDisplay = await call(
      "aAdmin",
      "GET",
      `/companies/${companyA}/media/${rotated.id}/content?variant=display`,
      {},
    );
    const rotatedProbe = await probeBytes(rotatedDisplay.raw);
    const video = rotatedProbe.streams.find(
      (stream) => stream.codec_type === "video",
    );
    expect(video).toMatchObject({ width: 240, height: 320 });
    expect(video?.side_data_list ?? []).toHaveLength(0);

    const tooLong = await get("aAdmin", companyA, long.id);
    expect(tooLong.body).toMatchObject({
      status: "REJECTED",
      rejectionReason: "MEDIA_DURATION_EXCEEDED",
    });
  }, 240_000);

  it("admits uploads only within scope and declared bounds", async () => {
    const base = { name: "Promo", contentType: "image/jpeg", size: 1000 };
    // Company-wide items need company-wide upload authority.
    const managerCompany = await call(
      "aManager",
      "POST",
      `/companies/${companyA}/media`,
      { body: { ...base, branchId: null } },
    );
    expect(code(managerCompany)).toBe("PERMISSION_DENIED");
    const otherBranch = await call(
      "aOperator",
      "POST",
      `/companies/${companyA}/media`,
      { body: { ...base, branchId: a2.id } },
    );
    expect(code(otherBranch)).toBe("PERMISSION_DENIED");
    const operator = await call(
      "aOperator",
      "POST",
      `/companies/${companyA}/media`,
      { body: { ...base, branchId: a1.id } },
    );
    expect(operator.status).toBe(201);
    const foreign = await call(
      "bAdmin",
      "POST",
      `/companies/${companyA}/media`,
      { body: { ...base, branchId: null } },
    );
    expect(code(foreign)).toBe("RESOURCE_NOT_FOUND");
    const foreignBranch = await call(
      "bAdmin",
      "POST",
      `/companies/${companyB}/media`,
      { body: { ...base, branchId: a1.id } },
    );
    expect(code(foreignBranch)).toBe("VALIDATION_FAILED");
    const tooLarge = await call(
      "aAdmin",
      "POST",
      `/companies/${companyA}/media`,
      {
        body: { ...base, branchId: null, size: 20 * 1024 * 1024 + 1 },
      },
    );
    expect(code(tooLarge)).toBe("MEDIA_TOO_LARGE");
    const unsupported = await call(
      "aAdmin",
      "POST",
      `/companies/${companyA}/media`,
      {
        body: { ...base, branchId: null, contentType: "image/gif" },
      },
    );
    expect(code(unsupported)).toBe("VALIDATION_FAILED");

    // The upload must deliver exactly the declared size.
    const short = await call(
      "aOperator",
      "PUT",
      `/companies/${companyA}/media/${operator.body.id}/content`,
      { bytes: Buffer.alloc(999) },
    );
    expect(code(short)).toBe("MEDIA_UPLOAD_INCOMPLETE");
    const stillUploading = await get("aOperator", companyA, operator.body.id);
    expect(stillUploading.body.status).toBe("UPLOADING");
    const hidden = await call(
      "bAdmin",
      "PUT",
      `/companies/${companyA}/media/${operator.body.id}/content`,
      { bytes: Buffer.alloc(1000) },
    );
    expect(code(hidden)).toBe("RESOURCE_NOT_FOUND");
    const discarded = await call(
      "aOperator",
      "DELETE",
      `/companies/${companyA}/media/${operator.body.id}`,
      { body: { expectedVersion: 1 } },
    );
    expect(discarded.status).toBe(204);
    expect(code(await get("aOperator", companyA, operator.body.id))).toBe(
      "RESOURCE_NOT_FOUND",
    );
  });

  it("shows company items to every branch and branch items only in scope", async () => {
    const shared = await upload("aAdmin", companyA, fixtures.pngAlpha, {
      name: "Logo da empresa",
    });
    const local = await upload("aManager", companyA, fixtures.pngAlpha, {
      branchId: a1.id,
      name: "Cardápio centro",
    });
    const elsewhere = await upload("aAdmin", companyA, fixtures.pngAlpha, {
      branchId: a2.id,
      name: "Cardápio bairro",
    });
    await processAll();
    const list = await call(
      "aOperator",
      "GET",
      `/companies/${companyA}/media?view=selectable&limit=100`,
    );
    const names = (list.body.items as { name: string }[]).map(
      (item) => item.name,
    );
    expect(names).toContain("Logo da empresa");
    expect(names).toContain("Cardápio centro");
    expect(names).not.toContain("Cardápio bairro");
    expect(code(await get("aOperator", companyA, elsewhere.id))).toBe(
      "RESOURCE_NOT_FOUND",
    );
    const thumbnail = await call(
      "aOperator",
      "GET",
      `/companies/${companyA}/media/${elsewhere.id}/content?variant=thumbnail`,
    );
    expect(code(thumbnail)).toBe("RESOURCE_NOT_FOUND");
    // Visible, but only company-wide authority edits a company item.
    const rename = await call(
      "aManager",
      "PATCH",
      `/companies/${companyA}/media/${shared.id}`,
      { body: { expectedVersion: 3, name: "Outro" } },
    );
    expect(code(rename)).toBe("PERMISSION_DENIED");
    const retag = await call(
      "aManager",
      "PATCH",
      `/companies/${companyA}/media/${local.id}`,
      {
        body: { expectedVersion: 3, tags: [" Almoço ", "almoço", "Menu"] },
      },
    );
    expect(retag.status, JSON.stringify(retag.body)).toBe(200);
    expect(retag.body.tags).toEqual(["almoço", "menu"]);
    const byTag = await call(
      "aOperator",
      "GET",
      `/companies/${companyA}/media?tag=menu`,
    );
    expect((byTag.body.items as { id: string }[]).map((i) => i.id)).toEqual([
      local.id,
    ]);
    const byText = await call(
      "aOperator",
      "GET",
      `/companies/${companyA}/media?text=CARD%C3%81PIO`,
    );
    expect((byText.body.items as { id: string }[]).map((i) => i.id)).toEqual([
      local.id,
    ]);
    const conflict = await call(
      "aManager",
      "PATCH",
      `/companies/${companyA}/media/${local.id}`,
      { body: { expectedVersion: 3, name: "Velho" } },
    );
    expect(code(conflict)).toBe("RESOURCE_VERSION_CONFLICT");
    // Cursors stay bound to the caller and filters.
    const first = await call(
      "aAdmin",
      "GET",
      `/companies/${companyA}/media?limit=1`,
      {},
    );
    expect(first.body.nextCursor).toBeTruthy();
    const foreignCursor = await call(
      "aManager",
      "GET",
      `/companies/${companyA}/media?limit=1&cursor=${String(first.body.nextCursor)}`,
      {},
    );
    expect(code(foreignCursor)).toBe("VALIDATION_FAILED");
    // Operators cannot archive without an additional grant.
    const archive = await call(
      "aOperator",
      "POST",
      `/companies/${companyA}/media/${local.id}/archive`,
      { body: { expectedVersion: 4 } },
    );
    expect(code(archive)).toBe("PERMISSION_DENIED");
  }, 120_000);

  it("archives, protects, trashes, restores and purges, sharing objects safely", async () => {
    const first = await upload("aAdmin", companyA, fixtures.videoCompliant, {
      name: "Vídeo 1",
    });
    const twin = await upload("aAdmin", companyA, fixtures.videoCompliant, {
      name: "Vídeo 2",
    });
    await processAll();
    const objectsBefore = await sql.query(
      "SELECT 1 FROM media_objects WHERE company_id = $1",
      [companyA],
    );
    const archived = await call(
      "aManager",
      "POST",
      `/companies/${companyA}/media/${first.id}/archive`,
      { body: { expectedVersion: 3 } },
    );
    expect(code(archived)).toBe("PERMISSION_DENIED");
    const adminArchive = await call(
      "aAdmin",
      "POST",
      `/companies/${companyA}/media/${first.id}/archive`,
      { body: { expectedVersion: 3 } },
    );
    expect(adminArchive.body.status).toBe("ARCHIVED");
    const selectable = await call(
      "aAdmin",
      "GET",
      `/companies/${companyA}/media?view=selectable&limit=100`,
      {},
    );
    expect(
      (selectable.body.items as { id: string }[]).some(
        (item) => item.id === first.id,
      ),
    ).toBe(false);
    // Only archived items go to the trash, and only for administrators.
    const notArchived = await call(
      "aAdmin",
      "POST",
      `/companies/${companyA}/media/${twin.id}/delete`,
      { body: { expectedVersion: 3 } },
    );
    expect(code(notArchived)).toBe("MEDIA_INVALID_STATE");
    protectedAssets.set(first.id, [{ kind: "playlist", branchId: null }]);
    const inUse = await call(
      "aAdmin",
      "POST",
      `/companies/${companyA}/media/${first.id}/delete`,
      { body: { expectedVersion: 4 } },
    );
    expect(code(inUse)).toBe("MEDIA_IN_USE");
    protectedAssets.delete(first.id);
    const deleted = await call(
      "aAdmin",
      "POST",
      `/companies/${companyA}/media/${first.id}/delete`,
      { body: { expectedVersion: 4 } },
    );
    expect(deleted.body.status).toBe("DELETED");
    const purgeAfter = new Date(deleted.body.purgeAfter as string).getTime();
    expect(purgeAfter - Date.now()).toBeGreaterThan(29 * 24 * 3600_000);
    // Trash is visible to administrators only.
    expect(code(await get("aManager", companyA, first.id))).toBe(
      "RESOURCE_NOT_FOUND",
    );
    const trash = await call(
      "aManager",
      "GET",
      `/companies/${companyA}/media?view=trash`,
      {},
    );
    expect(code(trash)).toBe("PERMISSION_DENIED");
    const restored = await call(
      "aAdmin",
      "POST",
      `/companies/${companyA}/media/${first.id}/restore-deleted`,
      { body: { expectedVersion: 5 } },
    );
    expect(restored.body.status).toBe("ARCHIVED");
    await call(
      "aAdmin",
      "POST",
      `/companies/${companyA}/media/${first.id}/delete`,
      { body: { expectedVersion: 6 } },
    );
    // A protected item stays in the trash past its purge instant.
    await sql.query(
      "UPDATE media_assets SET purge_after = now() - interval '1 minute' WHERE id = $1",
      [first.id],
    );
    protectedAssets.set(first.id, [{ kind: "publication", branchId: a1.id }]);
    await media.maintain();
    expect((await get("aAdmin", companyA, first.id)).body.status).toBe(
      "DELETED",
    );
    protectedAssets.delete(first.id);
    await media.maintain();
    expect(code(await get("aAdmin", companyA, first.id))).toBe(
      "RESOURCE_NOT_FOUND",
    );
    const { rows } = await sql.query<{
      status: string;
      original_sha256: Buffer | null;
    }>(
      "SELECT status::text AS status, original_sha256 FROM media_assets WHERE id = $1",
      [first.id],
    );
    expect(rows[0]).toEqual({ status: "PURGED", original_sha256: null });
    // The twin shares every object, so nothing was deleted.
    const objectsAfter = await sql.query(
      "SELECT 1 FROM media_objects WHERE company_id = $1",
      [companyA],
    );
    expect(objectsAfter.rowCount).toBe(objectsBefore.rowCount);
    const twinDisplay = await call(
      "aAdmin",
      "GET",
      `/companies/${companyA}/media/${twin.id}/content?variant=display`,
      {},
    );
    expect(twinDisplay.status).toBe(200);
    const audit = await sql.query<{ action: string }>(
      "SELECT action FROM media_audit_events WHERE asset_id = $1 ORDER BY occurred_at, id",
      [first.id],
    );
    expect(audit.rows.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        "media.created",
        "media.uploaded",
        "media.ready",
        "media.archived",
        "media.deleted",
        "media.trash_restored",
        "media.purged",
      ]),
    );
  }, 120_000);

  it("stores objects per company by hash and keeps paths out of responses", async () => {
    const item = await upload("bAdmin", companyB, fixtures.pngAlpha);
    await processAll();
    const ready = await get("bAdmin", companyB, item.id);
    expect(JSON.stringify(ready.body)).not.toContain(root);
    const bytes = await readFile(fixtures.pngAlpha);
    const hash = createHash("sha256").update(bytes).digest("hex");
    // Company B keeps its own copy of bytes company A also uploaded.
    for (const company of [companyA, companyB])
      expect(
        (await stat(join(root, "objects", company, hash.slice(0, 2), hash)))
          .size,
      ).toBe(bytes.length);
    const fromA = await call(
      "aAdmin",
      "GET",
      `/companies/${companyB}/media/${item.id}/content?variant=display`,
      {},
    );
    expect(code(fromA)).toBe("RESOURCE_NOT_FOUND");
    expect(await readdir(join(root, "work"))).toEqual([]);
  }, 60_000);

  it("expires abandoned uploads and enforces the open-upload limit", async () => {
    const ids: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const created = await call(
        "aOperator",
        "POST",
        `/companies/${companyA}/media`,
        {
          body: {
            name: `Rascunho ${index}`,
            branchId: a1.id,
            contentType: "image/png",
            size: 100,
          },
        },
      );
      expect(created.status).toBe(201);
      ids.push(created.body.id);
    }
    const limited = await call(
      "aOperator",
      "POST",
      `/companies/${companyA}/media`,
      {
        body: {
          name: "Excesso",
          branchId: a1.id,
          contentType: "image/png",
          size: 100,
        },
      },
    );
    expect(code(limited)).toBe("RATE_LIMITED");
    await sql.query(
      "UPDATE media_assets SET created_at = now() - interval '2 hours' WHERE id = ANY($1::uuid[])",
      [ids],
    );
    await media.maintain();
    const { rows } = await sql.query<{ status: string }>(
      "SELECT DISTINCT status::text AS status FROM media_assets WHERE id = ANY($1::uuid[])",
      [ids],
    );
    expect(rows).toEqual([{ status: "PURGED" }]);
  });

  it("keeps object files while a backup holds the media backup lock", async () => {
    // The pilot backup locks before its dump and unlocks once the objects
    // are linked; a file deleted in between would be missing from it.
    const repository = new PrismaMediaRepository(
      database,
      new MediaObjectStore(root),
    );
    const bytes = randomBytes(64);
    const hash = createHash("sha256").update(bytes).digest();
    const directory = join(
      root,
      "objects",
      companyA,
      hash.toString("hex").slice(0, 2),
    );
    await mkdir(directory, { recursive: true });
    const path = join(directory, hash.toString("hex"));
    await writeFile(path, bytes);
    await sql.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [
      mediaBackupLockKey,
    ]);
    try {
      expect(await repository.removeUnrecorded(companyA, hash)).toBe(false);
      expect((await stat(path)).size).toBe(64);
    } finally {
      await sql.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [
        mediaBackupLockKey,
      ]);
    }
    expect(await repository.removeUnrecorded(companyA, hash)).toBe(true);
    await expect(stat(path)).rejects.toThrow();
  });
});
