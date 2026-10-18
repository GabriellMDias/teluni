import { randomUUID } from "node:crypto";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createDatabase, type Database } from "../../src/database.js";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import { OrganizationFailure } from "../../src/features/organizations/domain.js";
import { PrismaOrganizationRepository } from "../../src/features/organizations/prisma-repository.js";
import type { HumanSessionPort } from "../../src/features/identity/public.js";
import { createOrganizationsModule } from "../../src/features/organizations/module.js";
import { activateModules, type ApiModule } from "../../src/module.js";
import { withMigratedDatabase } from "../../scripts/migrated-database.js";

// Two-company adversarial suite from the tenant data design. A synthetic
// session port stands in for the identity module so tests can choose the
// verified principal and assurance; production composes the real boundary.
type App = ReturnType<typeof createApp>["app"];
let app: App;
let sql: pg.Client;
let runtime: pg.Client;
let database: Database;
let restrictedDatabaseUrl: string;
let release: () => void;
let stopped: Promise<void>;

const people = {
  aAdmin: randomUUID(),
  aManager: randomUUID(),
  aOperator: randomUUID(),
  bAdmin: randomUUID(),
  multi: randomUUID(),
  outsider: randomUUID(),
};
type Person = keyof typeof people;

const sessions: HumanSessionPort = {
  authenticate: ({ headers }) => {
    const principalId = headers["x-test-principal"] as string;
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
  let ready!: () => void;
  const started = new Promise<void>((resolve) => (ready = resolve));
  stopped = withMigratedDatabase(async (runtimeUrl, migrationUrl) => {
    restrictedDatabaseUrl = runtimeUrl;
    sql = new pg.Client({ connectionString: migrationUrl });
    runtime = new pg.Client({ connectionString: runtimeUrl });
    await sql.connect();
    await runtime.connect();
    for (const [name, id] of Object.entries(people))
      await sql.query(
        "INSERT INTO principals (id, issuer, subject) VALUES ($1, 'https://issuer.example.test/realms/teluni', $2)",
        [id, name],
      );
    database = createDatabase(runtimeUrl);
    const organizations = createOrganizationsModule({
      sessions,
      rateLimit: { max: 10_000, timeWindow: 60_000 },
    });
    const modules = activateModules(
      [identityStub, organizations.module],
      { database },
      "test",
    );
    ({ app } = createApp(pino({ level: "silent" }), undefined, { modules }));
    await app.ready();
    ready();
    await new Promise<void>((resolve) => (release = resolve));
    await app.close();
    await database.$disconnect();
    await runtime.end();
    await sql.end();
  });
  await Promise.race([started, stopped]);
}, 180_000);

afterAll(async () => {
  release?.();
  await stopped;
}, 60_000);

async function call(
  person: Person,
  method: "GET" | "POST" | "PATCH",
  url: string,
  options: {
    body?: unknown;
    strong?: boolean;
    headers?: Record<string, string>;
  } = {},
) {
  const response = await app.inject({
    method,
    url,
    headers: {
      "x-test-principal": people[person],
      "x-test-strong": String(options.strong ?? false),
      ...options.headers,
    },
    ...(options.body === undefined ? {} : { payload: options.body as object }),
  });
  return {
    status: response.statusCode,
    body: response.json<
      Record<string, unknown> & { error?: { code: string } }
    >(),
  };
}

const code = (result: { body: { error?: { code: string } } }) =>
  result.body.error?.code;

async function createCompany(person: Person, displayName: string) {
  const created = await call(person, "POST", "/companies", {
    headers: { "idempotency-key": `key-${randomUUID()}` },
    body: {
      displayName,
      defaultLocale: "pt-BR",
      timeZone: "America/Sao_Paulo",
    },
  });
  expect(created.status).toBe(201);
  return (created.body.company as { id: string }).id;
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
  return created.body as { id: string; version: number };
}

/** Arranges a membership with one branch-scoped grant directly in the database. */
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
  return { membership, grant };
}

async function auditCount(companyId: string) {
  const { rows } = await sql.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM organization_audit_events WHERE company_id = $1",
    [companyId],
  );
  return rows[0].count;
}

describe("organizations: two-company isolation", () => {
  let companyA: string;
  let companyB: string;
  let a1: { id: string; version: number };
  let a2: { id: string; version: number };
  let b1: { id: string; version: number };
  let operatorGrant: { membership: string; grant: string };

  beforeAll(async () => {
    companyA = await createCompany("aAdmin", "Lanchonete A");
    companyB = await createCompany("bAdmin", "Clínica B");
    a1 = await createBranch("aAdmin", companyA, "Centro");
    a2 = await createBranch("aAdmin", companyA, "Bairro");
    b1 = await createBranch("bAdmin", companyB, "Matriz");
    await grantBranches("aManager", companyA, "BRANCH_MANAGER", [a1.id]);
    operatorGrant = await grantBranches("aOperator", companyA, "OPERATOR", [
      a1.id,
    ]);
    await grantBranches("multi", companyA, "OPERATOR", [a2.id]);
    const membership = randomUUID();
    await sql.query(
      "INSERT INTO memberships (id, company_id, principal_id) VALUES ($1, $2, $3)",
      [membership, companyB, people.multi],
    );
    await sql.query(
      "INSERT INTO membership_grants (id, company_id, membership_id, role, scope) VALUES ($1, $2, $3, 'COMPANY_ADMINISTRATOR', 'COMPANY')",
      [randomUUID(), companyB, membership],
    );
  }, 60_000);

  it("creates a company idempotently with its creator as responsible administrator", async () => {
    const key = `key-${randomUUID()}`;
    const body = {
      displayName: "Padaria",
      defaultLocale: "en-US",
      timeZone: "UTC",
    };
    const first = await call("outsider", "POST", "/companies", {
      headers: { "idempotency-key": key },
      body,
    });
    expect(first.status).toBe(201);
    expect(first.body.access).toEqual({
      roles: ["COMPANY_ADMINISTRATOR"],
      responsible: true,
      capabilities: [],
      capabilitiesAfterStrongAuthentication: [
        "company.view",
        "company.settings.manage",
        "branches.view",
        "branches.manage",
        "audit.view",
      ],
    });
    const companyId = (first.body.company as { id: string }).id;
    const replay = await call("outsider", "POST", "/companies", {
      headers: { "idempotency-key": key },
      body,
    });
    expect(replay.status).toBe(200);
    expect((replay.body.company as { id: string }).id).toBe(companyId);
    const reused = await call("outsider", "POST", "/companies", {
      headers: { "idempotency-key": key },
      body: { ...body, displayName: "Outra" },
    });
    expect(code(reused)).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(await auditCount(companyId)).toBe(1);
    // An invalid time zone is rejected before any write.
    const invalid = await call("outsider", "POST", "/companies", {
      headers: { "idempotency-key": `key-${randomUUID()}` },
      body: { ...body, timeZone: "Mars/Olympus" },
    });
    expect(code(invalid)).toBe("VALIDATION_FAILED");
  });

  it("replays the original creation intent after company settings change", async () => {
    const key = `edited-${randomUUID()}`;
    const body = {
      displayName: "Original company",
      defaultLocale: "pt-BR",
      timeZone: "UTC",
    };
    const created = await call("outsider", "POST", "/companies", {
      headers: { "idempotency-key": key },
      body,
    });
    const id = (created.body.company as { id: string }).id;
    const changed = await call("outsider", "PATCH", `/companies/${id}`, {
      strong: true,
      body: { expectedVersion: 1, displayName: "Renamed company" },
    });
    expect(changed.status).toBe(200);
    const replay = await call("outsider", "POST", "/companies", {
      headers: { "idempotency-key": key },
      body,
    });
    expect(replay.status).toBe(200);
    expect(replay.body.company).toMatchObject({
      id,
      displayName: "Renamed company",
      version: 2,
    });
    const changedIntent = await call("outsider", "POST", "/companies", {
      headers: { "idempotency-key": key },
      body: { ...body, displayName: "Renamed company" },
    });
    expect(code(changedIntent)).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(await auditCount(id)).toBe(2);
    expect(JSON.stringify(replay.body)).not.toContain("fingerprint");
  });

  it("converges concurrent company creation to one membership and audit event", async () => {
    const key = `concurrent-${randomUUID()}`;
    const create = () =>
      call("outsider", "POST", "/companies", {
        headers: { "idempotency-key": key },
        body: {
          displayName: "Concurrent company",
          defaultLocale: "en-US",
          timeZone: "UTC",
        },
      });
    const results = await Promise.all([create(), create(), create()]);
    expect(results.map((result) => result.status).sort()).toEqual([
      200, 200, 201,
    ]);
    const ids = results.map(
      (result) => (result.body.company as { id: string }).id,
    );
    expect(new Set(ids).size).toBe(1);
    expect(await auditCount(ids[0])).toBe(1);
    const { rows } = await sql.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM memberships WHERE company_id = $1",
      [ids[0]],
    );
    expect(rows[0].count).toBe(1);
  });

  it("rolls back a branch write when its audit event cannot be committed", async () => {
    const before = await auditCount(companyA);
    await sql.query(
      "REVOKE INSERT ON organization_audit_events FROM orion_runtime",
    );
    try {
      const result = await call(
        "aAdmin",
        "POST",
        `/companies/${companyA}/branches`,
        {
          strong: true,
          body: { name: "Audit rollback proof" },
        },
      );
      expect(result.status).toBe(500);
      expect(code(result)).toBe("INTERNAL_ERROR");
      const { rows } = await sql.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM branches WHERE company_id = $1 AND name = $2",
        [companyA, "Audit rollback proof"],
      );
      expect(rows[0].count).toBe(0);
      expect(await auditCount(companyA)).toBe(before);
    } finally {
      await sql.query(
        "GRANT INSERT ON organization_audit_events TO orion_runtime",
      );
    }
  });

  it("lists only the caller's companies with effective roles", async () => {
    const multi = await call("multi", "GET", "/companies");
    const items = multi.body.items as { id: string; roles: string[] }[];
    expect(items.map((item) => item.id).sort()).toEqual(
      [companyA, companyB].sort(),
    );
    expect(items.find((item) => item.id === companyA)?.roles).toEqual([
      "OPERATOR",
    ]);
    const own = await call("bAdmin", "GET", "/companies");
    expect((own.body.items as { id: string }[]).map((item) => item.id)).toEqual(
      [companyB],
    );
  });

  it("hides other companies and their branches behind not-found answers", async () => {
    for (const url of [
      `/companies/${companyA}`,
      `/companies/${companyA}/branches`,
      `/companies/${companyA}/branches/${a1.id}`,
      `/companies/${companyA}/audit-events`,
    ])
      expect(code(await call("bAdmin", "GET", url, { strong: true }))).toBe(
        "RESOURCE_NOT_FOUND",
      );
    // Substituting another company's branch under one's own company path.
    expect(
      code(
        await call(
          "bAdmin",
          "GET",
          `/companies/${companyB}/branches/${a1.id}`,
          {
            strong: true,
          },
        ),
      ),
    ).toBe("RESOURCE_NOT_FOUND");
    expect(
      code(
        await call(
          "bAdmin",
          "PATCH",
          `/companies/${companyB}/branches/${a1.id}`,
          {
            strong: true,
            body: { expectedVersion: 1, name: "Tomada" },
          },
        ),
      ),
    ).toBe("RESOURCE_NOT_FOUND");
    const listed = await call(
      "bAdmin",
      "GET",
      `/companies/${companyB}/branches`,
      {
        strong: true,
      },
    );
    expect(
      (listed.body.items as { id: string }[]).map((item) => item.id),
    ).toEqual([b1.id]);
  });

  it("requires two-step verification for administrators and managers but not operators", async () => {
    expect(
      code(
        await call("aAdmin", "POST", `/companies/${companyA}/branches`, {
          body: { name: "X" },
        }),
      ),
    ).toBe("STRONG_AUTHENTICATION_REQUIRED");
    expect(
      code(await call("aAdmin", "GET", `/companies/${companyA}/branches`)),
    ).toBe("STRONG_AUTHENTICATION_REQUIRED");
    expect(
      code(await call("aManager", "GET", `/companies/${companyA}/branches`)),
    ).toBe("STRONG_AUTHENTICATION_REQUIRED");
    const operator = await call(
      "aOperator",
      "GET",
      `/companies/${companyA}/branches`,
    );
    expect(operator.status).toBe(200);
  });

  it("limits branch-scoped members to their branches and denies administration", async () => {
    for (const [person, strong, expected] of [
      ["aManager", true, [a1.id]],
      ["aOperator", false, [a1.id]],
      ["multi", false, [a2.id]],
      ["aAdmin", true, [a2.id, a1.id]],
    ] as const) {
      const listed = await call(
        person,
        "GET",
        `/companies/${companyA}/branches`,
        { strong },
      );
      expect(
        (listed.body.items as { id: string }[]).map((item) => item.id),
      ).toEqual(expected);
    }
    expect(
      code(
        await call(
          "aManager",
          "GET",
          `/companies/${companyA}/branches/${a2.id}`,
          { strong: true },
        ),
      ),
    ).toBe("RESOURCE_NOT_FOUND");
    expect(
      code(
        await call("aOperator", "POST", `/companies/${companyA}/branches`, {
          body: { name: "Nova" },
        }),
      ),
    ).toBe("PERMISSION_DENIED");
    expect(
      code(
        await call("aManager", "PATCH", `/companies/${companyA}`, {
          strong: true,
          body: { expectedVersion: 1, displayName: "Tomada" },
        }),
      ),
    ).toBe("PERMISSION_DENIED");
    expect(
      code(
        await call("aManager", "GET", `/companies/${companyA}/audit-events`, {
          strong: true,
        }),
      ),
    ).toBe("PERMISSION_DENIED");
  });

  it("protects versions, active names and archived branches, auditing only committed changes", async () => {
    const before = await auditCount(companyA);
    const stale = await call(
      "aAdmin",
      "PATCH",
      `/companies/${companyA}/branches/${a2.id}`,
      {
        strong: true,
        body: { expectedVersion: a2.version + 5, name: "Outro" },
      },
    );
    expect(code(stale)).toBe("RESOURCE_VERSION_CONFLICT");
    const duplicate = await call(
      "aAdmin",
      "POST",
      `/companies/${companyA}/branches`,
      {
        strong: true,
        body: { name: "  centro " },
      },
    );
    expect(code(duplicate)).toBe("BRANCH_NAME_IN_USE");
    expect(await auditCount(companyA)).toBe(before);

    const temporary = await createBranch("aAdmin", companyA, "Temporária");
    const archived = await call(
      "aAdmin",
      "POST",
      `/companies/${companyA}/branches/${temporary.id}/archive`,
      { strong: true, body: { expectedVersion: temporary.version } },
    );
    expect(archived.body).toMatchObject({ status: "ARCHIVED", version: 2 });
    const afterArchive = await call(
      "aAdmin",
      "PATCH",
      `/companies/${companyA}/branches/${temporary.id}`,
      { strong: true, body: { expectedVersion: 2, name: "De novo" } },
    );
    expect(code(afterArchive)).toBe("BRANCH_ARCHIVED");
    // The archived name can be reused by a new active branch.
    await createBranch("aAdmin", companyA, "temporária");
    expect(await auditCount(companyA)).toBe(before + 3);

    const audit = await call(
      "aAdmin",
      "GET",
      `/companies/${companyA}/audit-events?limit=2`,
      {
        strong: true,
      },
    );
    const items = audit.body.items as { action: string }[];
    expect(items.map((item) => item.action)).toEqual([
      "branch.created",
      "branch.archived",
    ]);
    // Cursors are bound to the principal that received them.
    const foreign = await call(
      "multi",
      "GET",
      `/companies/${companyB}/audit-events?cursor=${audit.body.nextCursor as string}`,
      { strong: true },
    );
    expect(code(foreign)).toBe("VALIDATION_FAILED");
  });

  it("classifies stale branch writes without acquiring another pool connection", async () => {
    const single = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: restrictedDatabaseUrl,
        max: 1,
        connectionTimeoutMillis: 3000,
        query_timeout: 5000,
      }),
    });
    try {
      const repository = new PrismaOrganizationRepository(single);
      const membership = await repository.resolveMembership(
        people.aAdmin,
        companyA,
      );
      await expect(
        repository.updateBranch(
          {
            principalId: people.aAdmin,
            membershipId: membership!.membershipId,
          },
          companyA,
          a1.id,
          9999,
          { name: "Stale change" },
        ),
      ).rejects.toThrow(new OrganizationFailure("RESOURCE_VERSION_CONFLICT"));
    } finally {
      await single.$disconnect();
    }
  });

  it("paginates branches with a bound cursor", async () => {
    const first = await call(
      "aAdmin",
      "GET",
      `/companies/${companyA}/branches?limit=2`,
      {
        strong: true,
      },
    );
    const page = first.body.items as { id: string }[];
    expect(page).toHaveLength(2);
    const second = await call(
      "aAdmin",
      "GET",
      `/companies/${companyA}/branches?limit=2&cursor=${first.body.nextCursor as string}`,
      { strong: true },
    );
    const rest = second.body.items as { id: string }[];
    expect(rest.length).toBeGreaterThan(0);
    expect(rest.some((item) => page.some((seen) => seen.id === item.id))).toBe(
      false,
    );
  });

  it("rejects malformed, cross-list and stale-scope cursors as validation failures", async () => {
    const first = await call(
      "aAdmin",
      "GET",
      `/companies/${companyA}/branches?limit=1`,
      { strong: true },
    );
    const cursor = first.body.nextCursor as string;
    const fields = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as Record<string, string>;
    const encode = (value: unknown) =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
    for (const invalid of [
      "not-base64!",
      encode(null),
      encode({}),
      encode({ ...fields, i: "not-a-uuid" }),
      encode({ ...fields, s: "UNKNOWN" }),
      encode({ ...fields, n: null }),
      encode({ ...fields, r: "changed" }),
      encode({ ...fields, c: companyB }),
      encode({ ...fields, p: people.multi }),
    ]) {
      const result = await call(
        "aAdmin",
        "GET",
        `/companies/${companyA}/branches?cursor=${encodeURIComponent(invalid)}`,
        { strong: true },
      );
      expect(result.status).toBe(400);
      expect(code(result)).toBe("VALIDATION_FAILED");
    }
    const crossList = await call(
      "aAdmin",
      "GET",
      `/companies/${companyA}/audit-events?cursor=${cursor}`,
      { strong: true },
    );
    expect(code(crossList)).toBe("VALIDATION_FAILED");
    const audit = await call(
      "aAdmin",
      "GET",
      `/companies/${companyA}/audit-events?limit=1`,
      { strong: true },
    );
    const auditFields = JSON.parse(
      Buffer.from(audit.body.nextCursor as string, "base64url").toString(
        "utf8",
      ),
    ) as Record<string, string>;
    const invalidTime = await call(
      "aAdmin",
      "GET",
      `/companies/${companyA}/audit-events?cursor=${encode({ ...auditFields, t: "not-a-date" })}`,
      { strong: true },
    );
    expect(invalidTime.status).toBe(400);
    expect(code(invalidTime)).toBe("VALIDATION_FAILED");
  });

  it("denies the next request after suspension, grant expiry or company suspension", async () => {
    await sql.query(
      "UPDATE membership_grants SET expires_at = now() WHERE id = $1",
      [operatorGrant.grant],
    );
    expect(
      code(await call("aOperator", "GET", `/companies/${companyA}/branches`)),
    ).toBe("PERMISSION_DENIED");
    await sql.query(
      "UPDATE memberships SET status = 'SUSPENDED' WHERE id = $1",
      [operatorGrant.membership],
    );
    expect(code(await call("aOperator", "GET", `/companies/${companyA}`))).toBe(
      "RESOURCE_NOT_FOUND",
    );
    await sql.query("UPDATE companies SET status = 'SUSPENDED' WHERE id = $1", [
      companyB,
    ]);
    expect(
      code(
        await call("bAdmin", "GET", `/companies/${companyB}/branches`, {
          strong: true,
        }),
      ),
    ).toBe("COMPANY_SUSPENDED");
    await sql.query("UPDATE companies SET status = 'ACTIVE' WHERE id = $1", [
      companyB,
    ]);
  });

  it("makes mixed-company references, tenant moves and audit edits impossible for the runtime role", async () => {
    const { rows } = await sql.query<{ id: string }>(
      "SELECT id FROM membership_grants WHERE company_id = $1 LIMIT 1",
      [companyA],
    );
    await expect(
      runtime.query(
        "INSERT INTO membership_grant_branches (company_id, grant_id, branch_id) VALUES ($1, $2, $3)",
        [companyA, rows[0].id, b1.id],
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      runtime.query("UPDATE branches SET company_id = $1 WHERE id = $2", [
        companyB,
        a1.id,
      ]),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      runtime.query(
        "UPDATE organization_audit_events SET action = 'company.forged'",
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      runtime.query("DELETE FROM organization_audit_events"),
    ).rejects.toMatchObject({
      code: "42501",
    });
  });
});

describe("tenant schema structure", () => {
  it("gives every tenant-owned table a tenant key and every tenant reference a composite key", async () => {
    const { rows: tables } = await sql.query<{
      table_name: string;
      has_id: boolean;
      nullable: string;
    }>(`
      SELECT c.table_name, c.is_nullable AS nullable, EXISTS (
          SELECT 1 FROM information_schema.columns i
          WHERE i.table_schema = 'public' AND i.table_name = c.table_name
            AND i.column_name = 'id') AS has_id
      FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.column_name = 'company_id'`);
    expect(tables.length).toBeGreaterThan(0);
    for (const { table_name, has_id, nullable } of tables) {
      expect(nullable, `${table_name}.company_id must not be nullable`).toBe(
        "NO",
      );
      const { rows: keys } = await sql.query(
        `SELECT 1 FROM pg_index x
         JOIN pg_class c ON c.oid = x.indrelid
         WHERE c.relname = $1 AND x.indisunique AND x.indpred IS NULL
           AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
                FROM unnest(x.indkey) k JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k)
               = ARRAY['company_id', 'id']`,
        [table_name],
      );
      // Join and one-to-one extension tables without their own id are keyed
      // otherwise; nothing can reference them, but their references are checked below.
      if (has_id)
        expect(
          keys,
          `${table_name} lacks UNIQUE (company_id, id)`,
        ).toHaveLength(1);
      const { rows: privileges } = await sql.query(
        `SELECT 1 FROM information_schema.column_privileges
         WHERE table_name = $1 AND column_name = 'company_id'
           AND grantee = 'orion_runtime' AND privilege_type = 'UPDATE'`,
        [table_name],
      );
      expect(privileges, `${table_name}.company_id is updatable`).toHaveLength(
        0,
      );
    }
    const tenantTables = new Set([
      ...tables.map((row) => row.table_name),
      "companies",
    ]);
    const { rows: references } = await sql.query<{
      name: string;
      source: string;
      target: string;
      columns: string[];
      target_columns: string[];
    }>(`
      SELECT con.conname AS name, src.relname AS source, tgt.relname AS target,
        ARRAY(SELECT a.attname::text FROM unnest(con.conkey) WITH ORDINALITY k(attnum, position)
          JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
          ORDER BY k.position) AS columns,
        ARRAY(SELECT a.attname::text FROM unnest(con.confkey) WITH ORDINALITY k(attnum, position)
          JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum
          ORDER BY k.position) AS target_columns
      FROM pg_constraint con
      JOIN pg_class src ON src.oid = con.conrelid
      JOIN pg_class tgt ON tgt.oid = con.confrelid
      WHERE con.contype = 'f'`);
    for (const reference of references) {
      if (
        !tenantTables.has(reference.target) ||
        reference.target === "companies"
      )
        continue;
      expect(
        reference.columns[0],
        `${reference.name} must carry the owning tenant`,
      ).toBe("company_id");
      expect(
        reference.target_columns,
        `${reference.name} must target the tenant key`,
      ).toEqual(["company_id", "id"]);
    }
  });
});
