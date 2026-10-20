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
import { createProgrammingModule } from "../../src/features/programming/module.js";
import { activateModules, type ApiModule } from "../../src/module.js";
import { withMigratedDatabase } from "../../scripts/migrated-database.js";
import { createFixtures, type Fixtures } from "../media/fixtures.js";

// Two-company suite of layouts (D-11 increment 2) against PostgreSQL as the
// runtime role, with the real organizations, media and catalogs modules. A
// synthetic session port stands in for the identity module.
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
  root = await mkdtemp(join(tmpdir(), "teluni-layouts-"));
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

type Issue = { path: string; reason: string; fieldId?: string; count?: number };
type Body = Record<string, unknown> & {
  id: string;
  version: number;
  error?: { code: string; issues?: Issue[] };
};
type Result = { status: number; body: Body };
type Field = { id: string; label: string; type: string };

async function call(
  person: Person | null,
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  url: string,
  options: { body?: unknown; bytes?: Buffer; strong?: boolean } = {},
): Promise<Result> {
  const response = await app.inject({
    method,
    url,
    headers: {
      ...(person
        ? {
            "x-test-principal": people[person],
            "x-test-strong": String(options.strong ?? person !== "aOperator"),
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
    {
      strong: true,
      body: { name },
    },
  );
  expect(created.status).toBe(201);
  return created.body.id;
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

async function audit(layoutId: string) {
  const { rows } = await sql.query<{ action: string }>(
    "SELECT action FROM programming_audit_events WHERE subject_type = 'layout' AND subject_id = $1 ORDER BY occurred_at, id",
    [layoutId],
  );
  return rows.map((row) => row.action);
}

describe("layouts: areas, catalog views, pages and their guards", () => {
  let companyA: string;
  let companyB: string;
  let a1: string;
  let a2: string;
  let base: string;
  let menu: Body & { fields: Field[] };
  let title: Field;
  let price: Field;

  const videoArea = {
    key: "video",
    name: "Vídeo",
    x: 0,
    y: 0,
    width: 1280,
    height: 1080,
    z: 0,
    kind: "media",
  };
  const menuArea = (
    catalogId: string,
    overrides: Record<string, unknown> = {},
  ) => ({
    key: "menu",
    name: "Cardápio",
    x: 1280,
    y: 0,
    width: 640,
    height: 1080,
    z: 1,
    kind: "catalog",
    view: {
      catalogId,
      fields: [
        { fieldId: title.id, role: "title" },
        { fieldId: price.id, role: "price" },
      ],
      presentation: "menu",
      textSize: 40,
    },
    ...overrides,
  });
  const definition = (catalogId: string) => ({
    orientation: "landscape",
    areas: [videoArea, menuArea(catalogId)],
  });

  beforeAll(async () => {
    companyA = await createCompany("aAdmin", "Lanchonete A");
    companyB = await createCompany("bAdmin", "Clínica B");
    a1 = await createBranch("aAdmin", companyA, "Centro");
    a2 = await createBranch("aAdmin", companyA, "Bairro");
    await grantBranches("aManager", companyA, "BRANCH_MANAGER", [a1]);
    await grantBranches("aOperator", companyA, "OPERATOR", [a1]);
    base = `/companies/${companyA}/programming/layouts`;
    const created = await call(
      "aAdmin",
      "POST",
      `/companies/${companyA}/catalogs`,
      {
        body: {
          name: "Cardápio",
          branchId: null,
          fields: [
            { label: "Nome", type: "text", required: true },
            { label: "Preço", type: "money", currency: "BRL" },
            { label: "Descrição", type: "longText" },
          ],
        },
      },
    );
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    menu = created.body as typeof menu;
    [title, price] = menu.fields;
    for (const [name, amount] of [
      ["Café", 500],
      ["Pão de queijo", 750],
      [
        "Hambúrguer artesanal duplo com queijo, bacon e cebola caramelizada",
        3990,
      ],
    ] as const) {
      const record = await call(
        "aAdmin",
        "POST",
        `/companies/${companyA}/catalogs/${menu.id}/records`,
        { body: { values: { [title.id]: name } } },
      );
      const priced = await call(
        "aAdmin",
        "PUT",
        `/companies/${companyA}/catalogs/${menu.id}/records/${record.body.id}/prices/${price.id}`,
        { body: { expectedVersion: record.body.version, amount } },
      );
      expect(priced.status, JSON.stringify(priced.body)).toBe(200);
    }
  });

  it("creates layouts in scope and reports each catalog view's fit", async () => {
    const created = await call("aAdmin", "POST", base, {
      body: {
        name: "Vitrine",
        branchId: null,
        definition: definition(menu.id),
      },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({
      name: "Vitrine",
      branch: null,
      orientation: "landscape",
      canvas: { width: 1920, height: 1080 },
      audioMixConfirmed: false,
      version: 1,
    });
    const areas = created.body.areas as Record<string, unknown>[];
    expect(areas[0]).toMatchObject({ key: "video", muted: true, view: null });
    expect(areas[1]).toMatchObject({
      key: "menu",
      view: {
        catalog: { id: menu.id, name: "Cardápio" },
        fields: [
          { fieldId: title.id, role: "title", label: "Nome", type: "text" },
          { fieldId: price.id, role: "price", label: "Preço", type: "money" },
        ],
        unavailable: "hide",
        pageSeconds: 10,
      },
    });
    expect(created.body.fit).toEqual([
      {
        areaKey: "menu",
        pages: 1,
        records: 3,
        rowsPerPage: 20,
        overflow: [
          {
            recordId: expect.any(String) as string,
            title:
              "Hambúrguer artesanal duplo com queijo, bacon e cebola caramelizada",
            reason: "TITLE_OVERFLOW",
          },
        ],
      },
    ]);
    // Managers author layouts for their branch with company catalogs.
    const branchLayout = await call("aManager", "POST", base, {
      body: { name: "Centro", branchId: a1, definition: definition(menu.id) },
    });
    expect(branchLayout.status, JSON.stringify(branchLayout.body)).toBe(201);
    expect(
      code(
        await call("aManager", "POST", base, {
          body: {
            name: "Empresa",
            branchId: null,
            definition: definition(menu.id),
          },
        }),
      ),
    ).toBe("PERMISSION_DENIED");
    // Operators author drafts for their branch; their fit has no titles.
    const operatorLayout = await call("aOperator", "POST", base, {
      body: { name: "Operador", branchId: a1, definition: definition(menu.id) },
    });
    expect(operatorLayout.status, JSON.stringify(operatorLayout.body)).toBe(
      201,
    );
    // A branch catalog fits only its own branch's layouts.
    const bairro = await call(
      "aAdmin",
      "POST",
      `/companies/${companyA}/catalogs`,
      {
        body: {
          name: "Bairro",
          branchId: a2,
          fields: [{ label: "Nome", type: "text" }],
        },
      },
    );
    const bairroField = (bairro.body.fields as Field[])[0];
    expect(
      issues(
        await call("aAdmin", "POST", base, {
          body: {
            name: "Errado",
            branchId: a1,
            definition: {
              orientation: "landscape",
              areas: [
                {
                  ...menuArea(bairro.body.id),
                  view: {
                    catalogId: bairro.body.id,
                    fields: [{ fieldId: bairroField.id, role: "title" }],
                    presentation: "list",
                    textSize: 40,
                  },
                },
              ],
            },
          },
        }),
      ),
    ).toEqual(["/areas/0/view/catalogId CATALOG_SCOPE"]);
    expect(
      issues(
        await call("aAdmin", "POST", base, {
          body: {
            name: "Papéis",
            branchId: null,
            definition: {
              orientation: "landscape",
              areas: [
                menuArea(menu.id, {
                  view: {
                    catalogId: menu.id,
                    fields: [
                      { fieldId: title.id, role: "title" },
                      {
                        fieldId: title.id === price.id ? "" : menu.fields[2].id,
                        role: "price",
                      },
                    ],
                    presentation: "menu",
                    textSize: 40,
                  },
                }),
              ],
            },
          },
        }),
      ),
    ).toEqual(["/areas/0/view/fields/1/role ROLE_TYPE_MISMATCH"]);
    // Another company sees and uses nothing of company A.
    expect(
      code(await call("bAdmin", "GET", `${base}/${created.body.id}`)),
    ).toBe("RESOURCE_NOT_FOUND");
    expect(
      issues(
        await call(
          "bAdmin",
          "POST",
          `/companies/${companyB}/programming/layouts`,
          {
            body: {
              name: "Cross",
              branchId: null,
              definition: definition(menu.id),
            },
          },
        ),
      ),
    ).toEqual(["/areas/1/view/catalogId CATALOG_UNAVAILABLE"]);
    // Structure problems come back as issues too.
    expect(
      issues(
        await call("aAdmin", "POST", base, {
          body: {
            name: "Torto",
            branchId: null,
            definition: {
              orientation: "portrait",
              areas: [
                videoArea,
                { ...videoArea, key: "music", z: 1, muted: false },
              ],
            },
          },
        }),
      ),
    ).toEqual(["/areas/0 GEOMETRY_INVALID", "/areas/1 GEOMETRY_INVALID"]);
    // The list shows company layouts and those of granted branches.
    const managerList = await call("aManager", "GET", base);
    expect(
      (managerList.body.items as Body[]).map((item) => item.name).sort(),
    ).toEqual(["Centro", "Operador", "Vitrine"]);
  });

  it("protects the catalogs, fields and media a layout names", async () => {
    const image = await ready(companyA, fixtures.pngAlpha, null);
    const video = await ready(companyA, fixtures.videoCompliant, null);
    const paged = {
      orientation: "landscape",
      areas: [
        { ...videoArea, pageControlled: true },
        menuArea(menu.id, { pageControlled: true }),
      ],
      pages: [
        {
          durationSeconds: 10,
          contents: [
            { areaKey: "video", mediaAssetId: image },
            { areaKey: "menu", viewPage: 1 },
          ],
        },
        {
          durationSeconds: 1,
          contents: [
            { areaKey: "video", mediaAssetId: video },
            { areaKey: "menu", viewPage: 1 },
          ],
        },
      ],
    };
    expect(
      issues(
        await call("aAdmin", "POST", base, {
          body: { name: "Páginas", branchId: null, definition: paged },
        }),
      ),
    ).toEqual(["/pages/1/durationSeconds PAGE_SHORTER_THAN_VIDEO"]);
    paged.pages[1].durationSeconds = 30;
    const created = await call("aAdmin", "POST", base, {
      body: { name: "Páginas", branchId: null, definition: paged },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const pages = created.body.pages as {
      suggestedSeconds: number | null;
      contents: { media: { kind: string } | null }[];
    }[];
    expect(pages[0].suggestedSeconds).toBeNull();
    expect(pages[1].suggestedSeconds).toBeGreaterThanOrEqual(2);
    expect(pages[1].contents[0].media).toMatchObject({ kind: "VIDEO" });
    // Media a layout page names cannot be deleted.
    const archived = await call(
      "aAdmin",
      "POST",
      `/companies/${companyA}/media/${image}/archive`,
      { strong: true, body: { expectedVersion: 3 } },
    );
    expect(
      code(
        await call(
          "aAdmin",
          "POST",
          `/companies/${companyA}/media/${image}/delete`,
          {
            strong: true,
            body: { expectedVersion: archived.body.version },
          },
        ),
      ),
    ).toBe("MEDIA_IN_USE");
    // Bound catalogs and fields stay.
    expect(
      code(
        await call(
          "aAdmin",
          "DELETE",
          `/companies/${companyA}/catalogs/${menu.id}`,
          {
            body: { expectedVersion: menu.version },
          },
        ),
      ),
    ).toBe("CATALOG_NOT_EMPTY");
    const fields = menu.fields.map((field) => ({ ...field }));
    const archiveTitle = await call(
      "aAdmin",
      "PUT",
      `/companies/${companyA}/catalogs/${menu.id}/schema`,
      {
        body: {
          expectedVersion: menu.version,
          fields: fields.map((field) =>
            field.id === price.id ? { ...field, archived: true } : field,
          ),
        },
      },
    );
    expect(issues(archiveTitle)).toEqual(["/fields/1/archived FIELD_BOUND 4"]);
    const removePrice = await call(
      "aAdmin",
      "PUT",
      `/companies/${companyA}/catalogs/${menu.id}/schema`,
      {
        body: {
          expectedVersion: menu.version,
          fields: fields.filter((field) => field.id !== price.id),
        },
      },
    );
    expect(removePrice.body.error?.issues).toContainEqual({
      path: "/fields",
      reason: "FIELD_BOUND",
      fieldId: price.id,
      count: 4,
    });
    const emptyCatalog = await call(
      "aAdmin",
      "POST",
      `/companies/${companyA}/catalogs`,
      {
        body: {
          name: "Vazio",
          branchId: null,
          fields: [{ label: "Nome", type: "text" }],
        },
      },
    );
    const emptyField = (emptyCatalog.body.fields as Field[])[0];
    await call("aAdmin", "POST", base, {
      body: {
        name: "Vazio",
        branchId: null,
        definition: {
          orientation: "landscape",
          areas: [
            menuArea(emptyCatalog.body.id, {
              view: {
                catalogId: emptyCatalog.body.id,
                fields: [{ fieldId: emptyField.id, role: "title" }],
                presentation: "list",
                textSize: 40,
              },
            }),
          ],
        },
      },
    });
    expect(
      code(
        await call(
          "aAdmin",
          "DELETE",
          `/companies/${companyA}/catalogs/${emptyCatalog.body.id}`,
          { body: { expectedVersion: 1 } },
        ),
      ),
    ).toBe("CATALOG_IN_USE");
  });

  it("saves, exports, imports and deletes layouts with versions and audit", async () => {
    const created = await call("aAdmin", "POST", base, {
      body: {
        name: "Rascunho",
        branchId: null,
        definition: definition(menu.id),
      },
    });
    const id = created.body.id;
    const saved = await call("aAdmin", "PATCH", `${base}/${id}`, {
      body: {
        expectedVersion: 1,
        name: "Final",
        definition: {
          orientation: "landscape",
          audioMixConfirmed: true,
          areas: [
            { ...videoArea, muted: false, volume: 80 },
            {
              ...videoArea,
              key: "logo",
              name: "Logo",
              width: 200,
              height: 200,
              z: 5,
              muted: false,
            },
            menuArea(menu.id),
          ],
        },
      },
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body).toMatchObject({
      name: "Final",
      version: 2,
      audioMixConfirmed: true,
    });
    expect((saved.body.areas as Body[]).map((area) => area.key)).toEqual([
      "video",
      "menu",
      "logo",
    ]);
    expect(
      code(
        await call("aAdmin", "PATCH", `${base}/${id}`, {
          body: { expectedVersion: 1, name: "Velho" },
        }),
      ),
    ).toBe("RESOURCE_VERSION_CONFLICT");
    const exported = await call("aAdmin", "GET", `${base}/${id}/export`);
    expect(exported.body).toMatchObject({
      format: "teluni.layout",
      schema: 1,
      name: "Final",
      orientation: "landscape",
      audioMixConfirmed: true,
    });
    // Importing elsewhere reports what must be remapped instead of keeping it.
    expect(
      issues(
        await call(
          "bAdmin",
          "POST",
          `/companies/${companyB}/programming/layouts/import`,
          {
            body: { branchId: null, document: exported.body },
          },
        ),
      ),
    ).toEqual(["/document/areas/1/view/catalogId CATALOG_UNAVAILABLE"]);
    expect(
      issues(
        await call("aAdmin", "POST", `${base}/import`, {
          body: { branchId: null, document: { ...exported.body, schema: 2 } },
        }),
      ),
    ).toEqual(["/document/schema FORMAT_UNSUPPORTED"]);
    const imported = await call("aAdmin", "POST", `${base}/import`, {
      body: { branchId: a1, document: exported.body },
    });
    expect(imported.status, JSON.stringify(imported.body)).toBe(201);
    expect(imported.body).toMatchObject({
      name: "Final",
      branch: { id: a1, name: "Centro" },
      version: 1,
    });
    expect(
      (
        await call("aAdmin", "DELETE", `${base}/${id}`, {
          body: { expectedVersion: 2 },
        })
      ).status,
    ).toBe(204);
    expect(code(await call("aAdmin", "GET", `${base}/${id}`))).toBe(
      "RESOURCE_NOT_FOUND",
    );
    expect(await audit(id)).toEqual([
      "layout.created",
      "layout.saved",
      "layout.deleted",
    ]);
    expect(await audit(imported.body.id)).toEqual(["layout.imported"]);
  });

  it("pages name an agenda's weekday or a selection choice as the group", async () => {
    const classes = await call(
      "aAdmin",
      "POST",
      `/companies/${companyA}/catalogs`,
      {
        body: {
          name: "Aulas",
          branchId: null,
          fields: [
            { label: "Aula", type: "text", required: true },
            { label: "Dias", type: "weekdays" },
            {
              label: "Sala",
              type: "selection",
              choices: [{ label: "Sala 1" }, { label: "Sala 2" }],
            },
          ],
        },
      },
    );
    expect(classes.status, JSON.stringify(classes.body)).toBe(201);
    const [name, days, room] = (
      classes.body as Body & {
        fields: (Field & { choices: { id: string }[] })[];
      }
    ).fields;
    const grouped = (
      presentation: string,
      group: Field,
      choices: string[],
    ) => ({
      orientation: "landscape",
      areas: [
        menuArea(classes.body.id, {
          pageControlled: true,
          view: {
            catalogId: classes.body.id,
            fields: [
              { fieldId: name.id, role: "title" },
              { fieldId: group.id, role: "group" },
            ],
            presentation,
            textSize: 40,
          },
        }),
      ],
      pages: choices.map((groupChoiceId) => ({
        durationSeconds: 10,
        contents: [{ areaKey: "menu", groupChoiceId }],
      })),
    });
    expect(
      issues(
        await call("aAdmin", "POST", base, {
          body: {
            name: "Agenda",
            branchId: null,
            definition: grouped("agenda", days, ["1", "8"]),
          },
        }),
      ),
    ).toEqual(["/pages/1/contents/0/groupChoiceId GROUP_UNKNOWN"]);
    const agenda = await call("aAdmin", "POST", base, {
      body: {
        name: "Agenda",
        branchId: null,
        definition: grouped("agenda", days, ["1", "7"]),
      },
    });
    expect(agenda.status, JSON.stringify(agenda.body)).toBe(201);
    const rooms = await call("aAdmin", "POST", base, {
      body: {
        name: "Salas",
        branchId: null,
        definition: grouped(
          "list",
          room,
          room.choices.map((choice) => choice.id),
        ),
      },
    });
    expect(rooms.status, JSON.stringify(rooms.body)).toBe(201);
    expect(
      issues(
        await call("aAdmin", "POST", base, {
          body: {
            name: "Salas",
            branchId: null,
            definition: grouped("list", room, ["1", "2"]),
          },
        }),
      ),
    ).toEqual([
      "/pages/0/contents/0/groupChoiceId GROUP_UNKNOWN",
      "/pages/1/contents/0/groupChoiceId GROUP_UNKNOWN",
    ]);
  });

  it("holds the layout limit under concurrent creation", async () => {
    const companyC = await createCompany("bAdmin", "Limite C");
    for (let index = 0; index < 499; index++)
      await sql.query(
        "INSERT INTO layouts (id, company_id, name, orientation) VALUES ($1, $2, $3, 'LANDSCAPE')",
        [randomUUID(), companyC, `Layout ${index}`],
      );
    const results = await Promise.all(
      [1, 2, 3].map((index) =>
        call("bAdmin", "POST", `/companies/${companyC}/programming/layouts`, {
          body: {
            name: `Novo ${index}`,
            branchId: null,
            definition: { orientation: "landscape", areas: [videoArea] },
          },
        }),
      ),
    );
    expect(results.map((result) => result.status).sort()).toEqual([
      201, 409, 409,
    ]);
    expect(
      results.filter((result) => code(result) === "PROGRAMMING_LIMIT_REACHED"),
    ).toHaveLength(2);
  });
});
