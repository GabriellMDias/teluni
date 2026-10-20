import { randomBytes, randomUUID } from "node:crypto";
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
import { activateModules, type ApiModule } from "../../src/module.js";
import { withMigratedDatabase } from "../../scripts/migrated-database.js";
import { createFixtures, type Fixtures } from "../media/fixtures.js";

// Two-company suite of the catalog design against PostgreSQL as the runtime
// role, with the real organizations and media modules. A synthetic session
// port stands in for the identity module so tests choose the verified
// principal and assurance.
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
  aPricer: randomUUID(),
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
  root = await mkdtemp(join(tmpdir(), "teluni-catalogs-"));
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
    const { module: catalogs } = createCatalogsModule({
      sessions,
      companies: organizations.companies,
      media: media.media,
      limits,
    });
    const modules = activateModules(
      [
        identityStub,
        organizations.module,
        devices.module,
        media.module,
        catalogs,
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
    expect(modules.map((module) => module.name)).toContain("catalogs");
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

type Issue = { path: string; reason: string; fieldId?: string; count?: number };
type Body = Record<string, unknown> & {
  id: string;
  version: number;
  error?: { code: string; issues?: Issue[] };
};
type Result = { status: number; body: Body };
type Field = {
  id: string;
  label: string;
  type: string;
  choices?: { id: string; label: string }[];
} & Record<string, unknown>;

async function call(
  person: Person | null,
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  url: string,
  options: {
    body?: unknown;
    bytes?: Buffer;
    strong?: boolean;
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
            "x-test-strong": String(
              options.strong ??
                (person !== "aOperator" && person !== "aPricer"),
            ),
          }
        : {}),
      ...(options.bytes ? { "content-type": "application/octet-stream" } : {}),
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
const issues = (result: Result) =>
  (result.body.error?.issues ?? []).map(
    (issue) =>
      `${issue.path} ${issue.reason}${issue.count === undefined ? "" : ` ${issue.count}`}`,
  );

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
  return created.body.id;
}

async function grantBranches(
  person: Person,
  companyId: string,
  authority: { role: "BRANCH_MANAGER" | "OPERATOR" } | { profileId: string },
  branchIds: string[],
) {
  const membership = randomUUID();
  const grant = randomUUID();
  await sql.query(
    "INSERT INTO memberships (id, company_id, principal_id) VALUES ($1, $2, $3)",
    [membership, companyId, people[person]],
  );
  await sql.query(
    "INSERT INTO membership_grants (id, company_id, membership_id, role, profile_id, scope) VALUES ($1, $2, $3, $4, $5, 'BRANCHES')",
    [
      grant,
      companyId,
      membership,
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
): Promise<string> {
  const bytes = await readFile(file);
  const created = await call(
    "aAdmin",
    "POST",
    `/companies/${companyId}/media`,
    {
      strong: true,
      body: {
        name: file.split("/").pop(),
        branchId,
        contentType: file.endsWith(".mp4") ? "video/mp4" : "image/png",
        size: bytes.length,
      },
    },
  );
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const sent = await call(
    "aAdmin",
    "PUT",
    `/companies/${companyId}/media/${created.body.id}/content`,
    { strong: true, bytes },
  );
  expect(sent.status, JSON.stringify(sent.body)).toBe(200);
  while ((await media.runOnce()) > 0);
  return created.body.id;
}

async function audit(catalogId: string) {
  const { rows } = await sql.query<{
    action: string;
    record_id: string | null;
    branch_ids: string[];
    details: Record<string, unknown>;
  }>(
    "SELECT action, record_id, branch_ids, details FROM catalog_audit_events WHERE catalog_id = $1 ORDER BY occurred_at, id",
    [catalogId],
  );
  return rows;
}

const productFields = [
  { label: "Nome", type: "text", required: true },
  { label: "Descrição", type: "longText" },
  {
    label: "Categoria",
    type: "selection",
    choices: [{ label: "Bebidas" }, { label: "Lanches" }],
  },
  { label: "Preço", type: "money", currency: "BRL" },
  { label: "Foto", type: "media" },
];

describe("catalogs: schemas, items, prices and promotions", () => {
  let companyA: string;
  let companyB: string;
  let a1: string;
  let a2: string;
  let base: string;
  let products: Body & { fields: Field[] };
  let price: Field;

  const field = (catalog: { fields: Field[] }, label: string) => {
    const found = catalog.fields.find((entry) => entry.label === label);
    if (!found) throw new Error(`No field ${label}`);
    return found;
  };

  const item = async (
    person: Person,
    catalogId: string,
    values: Record<string, unknown>,
  ) =>
    call(person, "POST", `${base}/${catalogId}/records`, {
      body: { values },
    });

  beforeAll(async () => {
    companyA = await createCompany("aAdmin", "Lanchonete A");
    companyB = await createCompany("bAdmin", "Clínica B");
    a1 = await createBranch("aAdmin", companyA, "Centro");
    a2 = await createBranch("aAdmin", companyA, "Bairro");
    await grantBranches("aManager", companyA, { role: "BRANCH_MANAGER" }, [a1]);
    await grantBranches("aOperator", companyA, { role: "OPERATOR" }, [a1]);
    const profile = randomUUID();
    await sql.query(
      "INSERT INTO access_profiles (id, company_id, name, capabilities) VALUES ($1, $2, 'Preços', ARRAY['catalogs.view', 'prices.edit'])",
      [profile, companyA],
    );
    await grantBranches("aPricer", companyA, { profileId: profile }, [a1]);
    base = `/companies/${companyA}/catalogs`;
    const created = await call("aAdmin", "POST", base, {
      body: { name: "Produtos", branchId: null, fields: productFields },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    products = created.body as typeof products;
    price = field(products, "Preço");
  });

  it("creates catalogs in scope with typed fields and hides them elsewhere", async () => {
    expect(products).toMatchObject({
      name: "Produtos",
      branch: null,
      status: "ACTIVE",
      recordCount: 0,
      schemaVersion: 1,
      version: 1,
    });
    expect(products.fields.map((entry) => entry.type)).toEqual([
      "text",
      "longText",
      "selection",
      "money",
      "media",
    ]);
    expect(price).toMatchObject({
      currency: "BRL",
      promotions: true,
      required: false,
    });
    const branchCatalog = await call("aManager", "POST", base, {
      body: {
        name: "Agenda do Centro",
        branchId: a1,
        fields: [
          { label: "Título", type: "text", required: true },
          { label: "Dias", type: "weekdays" },
          { label: "Início", type: "time" },
        ],
      },
    });
    expect(branchCatalog.status, JSON.stringify(branchCatalog.body)).toBe(201);
    expect(branchCatalog.body.branch).toEqual({ id: a1, name: "Centro" });
    const other = await call("aAdmin", "POST", base, {
      body: { name: "Agenda do Bairro", branchId: a2 },
    });
    expect(other.status).toBe(201);
    // Managers create catalogs only for their branches; operators never.
    expect(
      code(
        await call("aManager", "POST", base, {
          body: { name: "Empresa", branchId: null },
        }),
      ),
    ).toBe("PERMISSION_DENIED");
    expect(
      code(
        await call("aOperator", "POST", base, {
          body: { name: "Operador", branchId: a1 },
        }),
      ),
    ).toBe("PERMISSION_DENIED");
    expect(
      code(
        await call("aManager", "POST", base, {
          body: { name: "Fraco", branchId: a1 },
          strong: false,
        }),
      ),
    ).toBe("STRONG_AUTHENTICATION_REQUIRED");
    // The manager sees company catalogs and their branch's, not others.
    const listed = await call("aManager", "GET", base);
    const names = (listed.body.items as { name: string }[]).map(
      (entry) => entry.name,
    );
    expect(names).toContain("Produtos");
    expect(names).toContain("Agenda do Centro");
    expect(names).not.toContain("Agenda do Bairro");
    expect(
      code(await call("aManager", "GET", `${base}/${other.body.id}`)),
    ).toBe("RESOURCE_NOT_FOUND");
    // Another company sees nothing of company A.
    expect(code(await call("bAdmin", "GET", `${base}/${products.id}`))).toBe(
      "RESOURCE_NOT_FOUND",
    );
    const bOwn = await call("bAdmin", "GET", `/companies/${companyB}/catalogs`);
    expect(bOwn.body.items).toEqual([]);
    // Paging follows creation order, newest first.
    const first = await call("aAdmin", "GET", `${base}?limit=1`);
    expect(first.body.nextCursor).toEqual(expect.any(String));
    const second = await call(
      "aAdmin",
      "GET",
      `${base}?limit=1&cursor=${first.body.nextCursor as string}`,
    );
    expect((second.body.items as Body[])[0].id).not.toBe(
      (first.body.items as Body[])[0].id,
    );
    expect(
      code(
        await call(
          "aManager",
          "GET",
          `${base}?limit=1&cursor=${first.body.nextCursor as string}`,
        ),
      ),
    ).toBe("VALIDATION_FAILED");
    expect((await audit(products.id))[0]).toMatchObject({
      action: "catalog.created",
      branch_ids: [],
    });
  });

  it("validates schema changes against stored items", async () => {
    const created = await call("aAdmin", "POST", base, {
      body: { name: "Esquema", branchId: null, fields: productFields },
    });
    const catalog = created.body as typeof products;
    const name = field(catalog, "Nome");
    const description = field(catalog, "Descrição");
    const category = field(catalog, "Categoria");
    const photo = field(catalog, "Foto");
    for (const value of ["Café", "Chá"])
      expect(
        (await item("aAdmin", catalog.id, { [name.id]: value })).status,
      ).toBe(201);
    await item("aAdmin", catalog.id, {
      [name.id]: "Suco",
      [description.id]: "Laranja",
      [category.id]: category.choices![0].id,
    });
    const save = (fields: unknown[], expectedVersion = catalog.version) =>
      call("aAdmin", "PUT", `${base}/${catalog.id}/schema`, {
        body: { expectedVersion, fields },
      });
    const same = catalog.fields.map((entry) => ({ ...entry }));
    const required = await save(
      same.map((entry) =>
        entry.id === description.id ? { ...entry, required: true } : entry,
      ),
    );
    expect(code(required)).toBe("CATALOG_SCHEMA_INVALID");
    expect(issues(required)).toEqual([
      "/fields/1/required REQUIRED_MISSING_VALUES 2",
    ]);
    const removed = await save(
      same.filter((entry) => entry.id !== category.id),
    );
    expect(removed.body.error?.issues).toEqual([
      {
        path: "/fields",
        reason: "FIELD_HAS_VALUES",
        fieldId: category.id,
        count: 1,
      },
    ]);
    expect(
      issues(
        await save(
          same.map((entry) =>
            entry.id === category.id
              ? { ...entry, choices: [category.choices![1]] }
              : entry.id === description.id
                ? { ...entry, type: "text" }
                : entry,
          ),
        ),
      ),
    ).toEqual(["/fields/1/type TYPE_IMMUTABLE"]);
    expect(
      issues(
        await save(
          same.map((entry) =>
            entry.id === category.id
              ? { ...entry, choices: [category.choices![1]] }
              : entry,
          ),
        ),
      ),
    ).toEqual(["/fields/2/choices CHOICE_IN_USE 1"]);
    expect(
      issues(
        await save(
          same.map((entry) =>
            entry.id === name.id ? { ...entry, maxLength: 3 } : entry,
          ),
        ),
      ),
    ).toEqual(["/fields/0/maxLength VALUES_TOO_LONG 2"]);
    // A field without values can be removed; one with values is archived.
    const saved = await save([
      ...same
        .filter((entry) => entry.id !== photo.id)
        .map((entry) =>
          entry.id === category.id ? { ...entry, archived: true } : entry,
        ),
      { label: "Destaque", type: "boolean" },
    ]);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body).toMatchObject({ schemaVersion: 2, version: 2 });
    const fields = saved.body.fields as Field[];
    expect(fields.map((entry) => entry.label)).toEqual([
      "Nome",
      "Descrição",
      "Categoria",
      "Preço",
      "Destaque",
    ]);
    expect(fields[2]).toMatchObject({ id: category.id, archived: true });
    expect(code(await save(same))).toBe("RESOURCE_VERSION_CONFLICT");
    // Archived values stay, and archived fields cannot be written.
    const listed = await call("aAdmin", "GET", `${base}/${catalog.id}/records`);
    const juice = (listed.body.items as Body[]).find(
      (entry) => entry.title === "Suco",
    )!;
    expect((juice.values as Record<string, unknown>)[category.id]).toBe(
      category.choices![0].id,
    );
    const archivedWrite = await call(
      "aAdmin",
      "PATCH",
      `${base}/${catalog.id}/records/${juice.id}`,
      {
        body: {
          expectedVersion: juice.version,
          values: { [name.id]: "Suco", [category.id]: category.choices![1].id },
        },
      },
    );
    expect(issues(archivedWrite)).toEqual([
      `/values/${category.id} ARCHIVED_FIELD`,
    ]);
    // Managers of a branch cannot change company schemas.
    expect(
      code(
        await call("aManager", "PUT", `${base}/${catalog.id}/schema`, {
          body: { expectedVersion: 2, fields: same },
        }),
      ),
    ).toBe("PERMISSION_DENIED");
    expect(
      (await audit(catalog.id)).find(
        (event) => event.action === "catalog.schema_changed",
      )?.details,
    ).toMatchObject({
      added: [expect.any(String)],
      archived: [category.id],
      removed: [photo.id],
      schemaVersion: 2,
    });
  });

  it("edits items in order with media, references and deletion guards", async () => {
    const name = field(products, "Nome");
    const photo = field(products, "Foto");
    const image = await ready(companyA, fixtures.pngAlpha, null);
    const branchImage = await ready(companyA, fixtures.pngAlpha, a1);
    const video = await ready(companyA, fixtures.videoCompliant, null);
    const coffee = await item("aAdmin", products.id, {
      [name.id]: "Café",
      [photo.id]: image,
    });
    expect(coffee.status, JSON.stringify(coffee.body)).toBe(201);
    expect(coffee.body).toMatchObject({
      title: "Café",
      available: true,
      media: [
        expect.objectContaining({
          fieldId: photo.id,
          mediaAssetId: image,
          status: "READY",
        }),
      ],
    });
    expect(
      issues(
        await item("aAdmin", products.id, {
          [name.id]: "Vídeo",
          [photo.id]: video,
        }),
      ),
    ).toEqual([`/values/${photo.id} MEDIA_NOT_IMAGE`]);
    expect(
      issues(
        await item("aAdmin", products.id, {
          [name.id]: "Filial",
          [photo.id]: branchImage,
        }),
      ),
    ).toEqual([`/values/${photo.id} MEDIA_SCOPE`]);
    expect(
      issues(
        await item("aAdmin", products.id, {
          [name.id]: "Preço",
          [price.id]: 100,
        }),
      ),
    ).toEqual([`/values/${price.id} PRICE_FIELD`]);
    expect(issues(await item("aAdmin", products.id, {}))).toEqual([
      `/values/${name.id} REQUIRED`,
    ]);
    // Media named by an item cannot be deleted.
    const archived = await call(
      "aAdmin",
      "POST",
      `/companies/${companyA}/media/${image}/archive`,
      { strong: true, body: { expectedVersion: 3 } },
    );
    expect(archived.status, JSON.stringify(archived.body)).toBe(200);
    expect(
      code(
        await call(
          "aAdmin",
          "POST",
          `/companies/${companyA}/media/${image}/delete`,
          { strong: true, body: { expectedVersion: archived.body.version } },
        ),
      ),
    ).toBe("MEDIA_IN_USE");
    // Order: append, then move to the top.
    const tea = await item("aAdmin", products.id, { [name.id]: "Chá" });
    const juice = await item("aAdmin", products.id, { [name.id]: "Suco" });
    const moved = await call(
      "aAdmin",
      "POST",
      `${base}/${products.id}/records/${juice.body.id}/move`,
      { body: { expectedVersion: juice.body.version, afterRecordId: null } },
    );
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    const between = await call(
      "aAdmin",
      "POST",
      `${base}/${products.id}/records/${tea.body.id}/move`,
      {
        body: {
          expectedVersion: tea.body.version,
          afterRecordId: juice.body.id,
        },
      },
    );
    expect(between.status).toBe(200);
    const ordered = await call(
      "aAdmin",
      "GET",
      `${base}/${products.id}/records`,
    );
    expect((ordered.body.items as Body[]).map((entry) => entry.title)).toEqual([
      "Suco",
      "Chá",
      "Café",
    ]);
    const searched = await call(
      "aAdmin",
      "GET",
      `${base}/${products.id}/records?text=ch`,
    );
    expect((searched.body.items as Body[]).map((entry) => entry.title)).toEqual(
      ["Chá"],
    );
    // References name items of the target catalog; a referenced item stays.
    const combos = await call("aAdmin", "POST", base, {
      body: {
        name: "Combos",
        branchId: null,
        fields: [
          { label: "Nome", type: "text", required: true },
          {
            label: "Bebida",
            type: "reference",
            targetCatalogId: products.id,
          },
        ],
      },
    });
    expect(combos.status, JSON.stringify(combos.body)).toBe(201);
    const [comboName, drink] = combos.body.fields as Field[];
    const combo = await item("aAdmin", combos.body.id, {
      [comboName.id]: "Combo manhã",
      [drink.id]: coffee.body.id,
    });
    expect(combo.status, JSON.stringify(combo.body)).toBe(201);
    expect(combo.body.references).toEqual([
      { fieldId: drink.id, recordId: coffee.body.id, title: "Café" },
    ]);
    expect(
      issues(
        await item("aAdmin", combos.body.id, {
          [comboName.id]: "Errado",
          [drink.id]: combo.body.id,
        }),
      ),
    ).toEqual([`/values/${drink.id} REFERENCE_NOT_FOUND`]);
    const refused = await call(
      "aAdmin",
      "DELETE",
      `${base}/${products.id}/records/${coffee.body.id}`,
      { body: { expectedVersion: coffee.body.version } },
    );
    expect(code(refused)).toBe("CATALOG_RECORD_REFERENCED");
    expect(issues(refused)).toEqual([" REFERRED_BY_RECORDS 1"]);
    expect(
      code(
        await call("aAdmin", "DELETE", `${base}/${products.id}`, {
          body: { expectedVersion: products.version },
        }),
      ),
    ).toBe("CATALOG_NOT_EMPTY");
    // A branch catalog cannot point to another branch's catalog.
    const bairro = await call("aAdmin", "POST", base, {
      body: { name: "Bairro", branchId: a2 },
    });
    expect(
      issues(
        await call("aManager", "POST", base, {
          body: {
            name: "Centro refs",
            branchId: a1,
            fields: [
              {
                label: "Ref",
                type: "reference",
                targetCatalogId: bairro.body.id,
              },
            ],
          },
        }),
      ),
    ).toEqual(["/fields/0/targetCatalogId TARGET_INVALID"]);
    expect(
      issues(
        await call("bAdmin", "POST", `/companies/${companyB}/catalogs`, {
          body: {
            name: "Cross",
            branchId: null,
            fields: [
              { label: "Ref", type: "reference", targetCatalogId: products.id },
            ],
          },
        }),
      ),
    ).toEqual(["/fields/0/targetCatalogId TARGET_INVALID"]);
    // Operators edit their branch's items, never company catalogs.
    const agenda = await call("aManager", "POST", base, {
      body: {
        name: "Agenda",
        branchId: a1,
        fields: [{ label: "Título", type: "text", required: true }],
      },
    });
    const title = (agenda.body.fields as Field[])[0];
    const event = await item("aOperator", agenda.body.id, {
      [title.id]: "Show",
    });
    expect(event.status, JSON.stringify(event.body)).toBe(201);
    const hidden = await call(
      "aOperator",
      "PATCH",
      `${base}/${agenda.body.id}/records/${event.body.id}`,
      { body: { expectedVersion: 1, available: false } },
    );
    expect(hidden.body).toMatchObject({ available: false, version: 2 });
    expect(
      code(await item("aOperator", products.id, { [name.id]: "Não" })),
    ).toBe("PERMISSION_DENIED");
    const events = await audit(agenda.body.id);
    expect(events.map((entry) => entry.action)).toEqual([
      "catalog.created",
      "catalog.record_created",
      "catalog.record_updated",
    ]);
    expect(events[2]).toMatchObject({
      record_id: event.body.id,
      branch_ids: [a1],
      details: { fields: [], available: false },
    });
  });

  it("saves prices with strong authentication, branch prices and promotions", async () => {
    const name = field(products, "Nome");
    const burger = await item("aAdmin", products.id, { [name.id]: "X-Burger" });
    const url = `${base}/${products.id}/records/${burger.body.id}/prices/${price.id}`;
    let version = burger.body.version;
    // Base prices need company-wide authority and strong authentication;
    // administrators in a standard session are asked to verify first.
    expect(code(await call("aAdmin", "GET", base, { strong: false }))).toBe(
      "STRONG_AUTHENTICATION_REQUIRED",
    );
    expect(
      code(
        await call("aManager", "PUT", url, {
          body: { expectedVersion: version, amount: 1990 },
        }),
      ),
    ).toBe("PERMISSION_DENIED");
    // Zero is a price and null clears it; request coercion changes neither.
    const free = await call("aAdmin", "PUT", url, {
      body: { expectedVersion: version, amount: 0 },
    });
    expect((free.body.values as Record<string, unknown>)[price.id]).toBe(0);
    const unpriced = await call("aAdmin", "PUT", url, {
      body: { expectedVersion: free.body.version, amount: null },
    });
    expect(unpriced.body.values).not.toHaveProperty(price.id);
    version = unpriced.body.version;
    const based = await call("aAdmin", "PUT", url, {
      body: { expectedVersion: version, amount: 1990 },
    });
    expect(based.status, JSON.stringify(based.body)).toBe(200);
    expect((based.body.values as Record<string, unknown>)[price.id]).toBe(1990);
    version = based.body.version;
    // Branch prices need the capability on that branch.
    const managerPrice = await call(
      "aManager",
      "PUT",
      `${url}/branches/${a1}`,
      {
        body: { expectedVersion: version, amount: 1790 },
      },
    );
    expect(managerPrice.status, JSON.stringify(managerPrice.body)).toBe(200);
    version = managerPrice.body.version;
    expect(
      code(
        await call("aManager", "PUT", `${url}/branches/${a2}`, {
          body: { expectedVersion: version, amount: 1890 },
        }),
      ),
    ).toBe("PERMISSION_DENIED");
    expect(
      code(
        await call("aOperator", "PUT", `${url}/branches/${a1}`, {
          body: { expectedVersion: version, amount: 1890 },
        }),
      ),
    ).toBe("PERMISSION_DENIED");
    // A profile that grants prices needs strong authentication.
    expect(
      code(
        await call("aPricer", "PUT", `${url}/branches/${a1}`, {
          body: { expectedVersion: version, amount: 1690 },
        }),
      ),
    ).toBe("STRONG_AUTHENTICATION_REQUIRED");
    const pricer = await call("aPricer", "PUT", `${url}/branches/${a1}`, {
      strong: true,
      body: { expectedVersion: version, amount: 1690 },
    });
    expect(pricer.status, JSON.stringify(pricer.body)).toBe(200);
    version = pricer.body.version;
    const a2Price = await call("aAdmin", "PUT", `${url}/branches/${a2}`, {
      body: { expectedVersion: version, amount: 1890 },
    });
    expect(a2Price.status).toBe(200);
    version = a2Price.body.version;
    expect(
      code(
        await call("aAdmin", "PUT", `${url}/branches/${a2}`, {
          body: { expectedVersion: 1, amount: 1 },
        }),
      ),
    ).toBe("RESOURCE_VERSION_CONFLICT");
    // Viewers see the branch prices they may view.
    const managerView = await call(
      "aManager",
      "GET",
      `${base}/${products.id}/records/${burger.body.id}`,
    );
    expect(managerView.body.overrides).toEqual([
      { fieldId: price.id, branch: { id: a1, name: "Centro" }, amount: 1690 },
    ]);
    const adminView = await call(
      "aAdmin",
      "GET",
      `${base}/${products.id}/records/${burger.body.id}`,
    );
    expect(adminView.body.overrides).toHaveLength(2);
    // Promotions: scope-wide needs company authority; overlaps conflict.
    const promotions = `${url}/promotions`;
    const weekend = await call("aAdmin", "POST", promotions, {
      body: {
        branchId: null,
        amount: 1490,
        startsAt: "2026-11-07T00:00",
        endsAt: "2026-11-09T00:00",
      },
    });
    expect(weekend.status, JSON.stringify(weekend.body)).toBe(201);
    expect(
      code(
        await call("aManager", "POST", promotions, {
          body: {
            branchId: a1,
            amount: 1290,
            startsAt: "2026-11-08T18:00",
            endsAt: "2026-11-08T22:00",
          },
        }),
      ),
    ).toBe("CATALOG_PROMOTION_CONFLICT");
    const evening = await call("aManager", "POST", promotions, {
      body: {
        branchId: a1,
        amount: 1290,
        startsAt: "2026-11-10T18:00",
        endsAt: "2026-11-10T22:00",
      },
    });
    expect(evening.status, JSON.stringify(evening.body)).toBe(201);
    expect(evening.body.branch).toEqual({ id: a1, name: "Centro" });
    expect(
      code(
        await call("aManager", "POST", promotions, {
          body: {
            branchId: null,
            amount: 1290,
            startsAt: "2026-12-01T00:00",
            endsAt: "2026-12-02T00:00",
          },
        }),
      ),
    ).toBe("PERMISSION_DENIED");
    expect(
      code(
        await call("aAdmin", "POST", promotions, {
          body: {
            branchId: null,
            amount: 1,
            startsAt: "2026-12-02T00:00",
            endsAt: "2026-12-01T00:00",
          },
        }),
      ),
    ).toBe("VALIDATION_FAILED");
    // Effective prices: promotion, then branch price, then base.
    const at = (minute: string) =>
      call(
        "aAdmin",
        "GET",
        `${base}/${products.id}/records/${burger.body.id}/effective-prices?at=${minute}`,
      );
    const saturday = await at("2026-11-07T12:00");
    expect(saturday.body.fields).toEqual([
      {
        fieldId: price.id,
        currency: "BRL",
        scope: {
          amount: 1490,
          source: "promotion",
          promotionId: weekend.body.id,
        },
        branches: expect.arrayContaining([
          {
            branch: { id: a1, name: "Centro" },
            amount: 1490,
            source: "promotion",
            promotionId: weekend.body.id,
          },
          {
            branch: { id: a2, name: "Bairro" },
            amount: 1490,
            source: "promotion",
            promotionId: weekend.body.id,
          },
        ]) as unknown,
      },
    ]);
    const tuesday = (await at("2026-11-10T19:00")).body.fields as {
      scope: { amount: number; source: string };
      branches: { branch: { id: string }; amount: number; source: string }[];
    }[];
    expect(tuesday[0].scope).toMatchObject({ amount: 1990, source: "base" });
    expect(
      tuesday[0].branches.map((entry) => [
        entry.branch.id,
        entry.amount,
        entry.source,
      ]),
    ).toEqual(
      [
        [a1, 1290, "promotion"],
        [a2, 1890, "override"],
      ].sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
    );
    // Managers see scope-wide promotions and their branch's.
    const managerPromotions = await call("aManager", "GET", promotions);
    expect(
      (managerPromotions.body.items as Body[]).map((entry) => entry.amount),
    ).toEqual([1490, 1290]);
    expect(
      code(
        await call("aManager", "DELETE", `${promotions}/${weekend.body.id}`),
      ),
    ).toBe("PERMISSION_DENIED");
    expect(
      (await call("aManager", "DELETE", `${promotions}/${evening.body.id}`))
        .status,
    ).toBe(204);
    // Clearing a branch price returns the branch to the base price.
    const cleared = await call("aAdmin", "PUT", `${url}/branches/${a2}`, {
      body: { expectedVersion: version, amount: null },
    });
    expect(cleared.status).toBe(200);
    expect(
      (
        (await at("2026-11-10T19:00")).body.fields as { branches: unknown[] }[]
      )[0].branches,
    ).toEqual([
      {
        branch: { id: a1, name: "Centro" },
        amount: 1690,
        source: "override",
        promotionId: null,
      },
    ]);
    const events = (await audit(products.id)).filter(
      (event) => event.record_id === burger.body.id,
    );
    expect(events.map((event) => event.action)).toEqual([
      "catalog.record_created",
      "catalog.price_changed",
      "catalog.price_changed",
      "catalog.price_changed",
      "catalog.price_override_changed",
      "catalog.price_override_changed",
      "catalog.price_override_changed",
      "catalog.promotion_changed",
      "catalog.promotion_changed",
      "catalog.promotion_changed",
      "catalog.price_override_changed",
    ]);
    expect(events[3].details).toMatchObject({
      fieldId: price.id,
      currency: "BRL",
      from: null,
      to: 1990,
    });
    expect(events[5]).toMatchObject({
      branch_ids: [a1],
      details: { branchId: a1, from: 1790, to: 1690 },
    });
    expect(events.at(-1)?.details).toMatchObject({ from: 1890, to: null });
  });

  it("keeps each value's JSON type as sent", async () => {
    const created = await call("aAdmin", "POST", base, {
      body: {
        name: "Tipos",
        branchId: null,
        fields: [
          { label: "Texto", type: "text" },
          { label: "Sim", type: "boolean" },
          { label: "Peso", type: "number", decimals: 2 },
          { label: "Dias", type: "weekdays" },
        ],
      },
    });
    const [text, flag, weight, days] = created.body.fields as Field[];
    const saved = await item("aAdmin", created.body.id, {
      [text.id]: "true",
      [flag.id]: false,
      [weight.id]: "12.5",
      [days.id]: [3, 1],
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(201);
    expect(saved.body.values).toEqual({
      [text.id]: "true",
      [flag.id]: false,
      [weight.id]: "12.50",
      [days.id]: [1, 3],
    });
    expect(
      issues(
        await item("aAdmin", created.body.id, {
          [flag.id]: "true",
          [weight.id]: 12.5,
        }),
      ),
    ).toEqual([
      `/values/${flag.id} INVALID_TYPE`,
      `/values/${weight.id} INVALID_TYPE`,
    ]);
  });

  it("archives, restores and deletes catalogs", async () => {
    const created = await call("aAdmin", "POST", base, {
      body: {
        name: "Temporário",
        branchId: null,
        fields: [{ label: "Nome", type: "text" }],
      },
    });
    const id = created.body.id;
    const archived = await call("aAdmin", "PATCH", `${base}/${id}`, {
      body: { expectedVersion: 1, archived: true, name: "Arquivado" },
    });
    expect(archived.body).toMatchObject({
      status: "ARCHIVED",
      name: "Arquivado",
    });
    expect(code(await item("aAdmin", id, {}))).toBe("CATALOG_ARCHIVED");
    expect(
      code(
        await call("aAdmin", "PATCH", `${base}/${id}`, {
          body: { expectedVersion: 2, name: "Outro" },
        }),
      ),
    ).toBe("CATALOG_ARCHIVED");
    const archivedList = await call("aAdmin", "GET", `${base}?status=ARCHIVED`);
    expect(
      (archivedList.body.items as Body[]).map((entry) => entry.id),
    ).toEqual([id]);
    const restored = await call("aAdmin", "PATCH", `${base}/${id}`, {
      body: { expectedVersion: 2, archived: false },
    });
    expect(restored.body).toMatchObject({ status: "ACTIVE", version: 3 });
    // A catalog targeted by another catalog's reference field stays.
    const referrer = await call("aAdmin", "POST", base, {
      body: {
        name: "Referência",
        branchId: null,
        fields: [{ label: "Ref", type: "reference", targetCatalogId: id }],
      },
    });
    expect(
      code(
        await call("aAdmin", "DELETE", `${base}/${id}`, {
          body: { expectedVersion: 3 },
        }),
      ),
    ).toBe("CATALOG_IN_USE");
    expect(
      (
        await call("aAdmin", "DELETE", `${base}/${referrer.body.id}`, {
          body: { expectedVersion: 1 },
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await call("aAdmin", "DELETE", `${base}/${id}`, {
          body: { expectedVersion: 3 },
        })
      ).status,
    ).toBe(204);
    expect(code(await call("aAdmin", "GET", `${base}/${id}`))).toBe(
      "RESOURCE_NOT_FOUND",
    );
    // The rename and the archive share one transaction and its instant.
    expect((await audit(id)).map((event) => event.action).sort()).toEqual([
      "catalog.archived",
      "catalog.created",
      "catalog.deleted",
      "catalog.renamed",
      "catalog.restored",
    ]);
  });

  it("holds the catalog limit under concurrent creation", async () => {
    const companyC = await createCompany("bAdmin", "Limite C");
    for (let index = 0; index < 199; index++)
      await sql.query(
        "INSERT INTO catalogs (id, company_id, name) VALUES ($1, $2, $3)",
        [randomUUID(), companyC, `Catálogo ${index}`],
      );
    const results = await Promise.all(
      [1, 2, 3].map((index) =>
        call("bAdmin", "POST", `/companies/${companyC}/catalogs`, {
          body: { name: `Novo ${index}`, branchId: null },
        }),
      ),
    );
    expect(results.map((result) => result.status).sort()).toEqual([
      201, 409, 409,
    ]);
    expect(
      results.filter((result) => code(result) === "CATALOG_LIMIT_REACHED"),
    ).toHaveLength(2);
  });
});
