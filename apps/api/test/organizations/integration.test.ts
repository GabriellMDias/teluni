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
  paged: randomUUID(),
};
type Person = keyof typeof people;

const sessions: HumanSessionPort = {
  authenticate: ({ headers }) => {
    const principalId = headers["x-test-principal"] as string;
    // A session authenticated x-test-auth-age seconds ago (default 1).
    const age = Number(headers["x-test-auth-age"] ?? 1);
    return Promise.resolve({
      principalId,
      sessionId: randomUUID(),
      assuranceLevel: "teluni-aal1",
      authenticatedAt: new Date(Date.now() - age * 1000),
      authenticationAgeSeconds: age,
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
      profiles: {
        getMany: (ids) =>
          Promise.resolve(
            ids.map((id) => ({
              principalId: id,
              displayName:
                Object.entries(people).find(
                  ([, principal]) => principal === id,
                )?.[0] ?? null,
              email: null,
            })),
          ),
      },
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
    headers?: Record<string, string>;
  } = {},
) {
  const response = await app.inject({
    method,
    url,
    headers: {
      "x-test-principal": people[person],
      ...options.headers,
    },
    ...(options.body === undefined ? {} : { payload: options.body as object }),
  });
  return {
    status: response.statusCode,
    body:
      response.statusCode === 204
        ? {}
        : response.json<
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

/** Fixture only: invitations are a separate product increment. */
async function addCompanyMember(
  person: Person,
  companyId: string,
  role: "COMPANY_ADMINISTRATOR" | "OPERATOR" = "OPERATOR",
) {
  const id = randomUUID();
  await sql.query(
    "INSERT INTO memberships (id, company_id, principal_id) VALUES ($1, $2, $3)",
    [id, companyId, people[person]],
  );
  await sql.query(
    "INSERT INTO membership_grants (id, company_id, membership_id, role, scope) VALUES ($1, $2, $3, $4, 'COMPANY')",
    [randomUUID(), companyId, id, role],
  );
  return id;
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
      profiles: [],
      responsible: true,
      capabilities: [
        "company.view",
        "company.settings.manage",
        "branches.view",
        "branches.manage",
        "members.manage",
        "invitations.manage",
        "audit.view",
        "devices.view",
        "devices.manage",
        "media.view",
        "media.upload",
        "media.archive",
        "media.delete",
        "programming.view",
        "programming.edit",
        "programming.assign",
        "publications.publish",
        "catalogs.view",
        "catalogs.edit",
        "catalogs.manage",
        "prices.edit",
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
      expect(code(await call("bAdmin", "GET", url, {}))).toBe(
        "RESOURCE_NOT_FOUND",
      );
    // Substituting another company's branch under one's own company path.
    expect(
      code(
        await call(
          "bAdmin",
          "GET",
          `/companies/${companyB}/branches/${a1.id}`,
          {},
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
            body: { expectedVersion: 1, name: "Tomada" },
          },
        ),
      ),
    ).toBe("RESOURCE_NOT_FOUND");
    const listed = await call(
      "bAdmin",
      "GET",
      `/companies/${companyB}/branches`,
      {},
    );
    expect(
      (listed.body.items as { id: string }[]).map((item) => item.id),
    ).toEqual([b1.id]);
  });

  it("does not require two-step verification for any role", async () => {
    for (const person of ["aAdmin", "aManager", "aOperator"] as const)
      expect(
        (await call(person, "GET", `/companies/${companyA}/branches`)).status,
        person,
      ).toBe(200);
  });

  it("limits branch-scoped members to their branches and denies administration", async () => {
    for (const [person, expected] of [
      ["aManager", [a1.id]],
      ["aOperator", [a1.id]],
      ["multi", [a2.id]],
      ["aAdmin", [a2.id, a1.id]],
    ] as const) {
      const listed = await call(
        person,
        "GET",
        `/companies/${companyA}/branches`,
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
          {},
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
          body: { expectedVersion: 1, displayName: "Tomada" },
        }),
      ),
    ).toBe("PERMISSION_DENIED");
    expect(
      code(
        await call("aOperator", "GET", `/companies/${companyA}/audit-events`),
      ),
    ).toBe("PERMISSION_DENIED");
  });

  it("shows branch managers only the audit of operations confined to their branches", async () => {
    const company = await createCompany("aAdmin", "Branch audit");
    const north = await createBranch("aAdmin", company, "Norte");
    const south = await createBranch("aAdmin", company, "Sul");
    await grantBranches("aManager", company, "BRANCH_MANAGER", [north.id]);
    const member = await addCompanyMember("multi", company);
    const grant = async (branchIds: string[]) => {
      const created = await call(
        "aAdmin",
        "POST",
        `/companies/${company}/members/${member}/grants`,
        {
          body: { role: "OPERATOR", scope: "BRANCHES", branchIds },
        },
      );
      expect(created.status).toBe(201);
      return created.body.id as string;
    };
    const northGrant = await grant([north.id]);
    await grant([north.id, south.id]);
    expect(
      (
        await call(
          "aAdmin",
          "POST",
          `/companies/${company}/members/${member}/grants/${northGrant}/revoke`,
          {},
        )
      ).status,
    ).toBe(204);
    expect(
      (
        await call(
          "aAdmin",
          "PATCH",
          `/companies/${company}/branches/${south.id}`,
          {
            body: { expectedVersion: south.version, name: "Sul 2" },
          },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await call("aAdmin", "PATCH", `/companies/${company}`, {
          body: { expectedVersion: 1, displayName: "Branch audit 2" },
        })
      ).status,
    ).toBe(200);

    const events = (body: Record<string, unknown>) =>
      (body.items as { action: string; targetId: string }[]).map(
        (item) => `${item.action}:${item.targetId}`,
      );
    const full = await call(
      "aAdmin",
      "GET",
      `/companies/${company}/audit-events`,
      {},
    );
    expect(full.status).toBe(200);
    expect(events(full.body)).toHaveLength(8);

    const managed = await call(
      "aManager",
      "GET",
      `/companies/${company}/audit-events`,
      {},
    );
    expect(managed.status).toBe(200);
    expect(events(managed.body)).toEqual([
      `grant.revoked:${member}`,
      `grant.created:${member}`,
      `branch.created:${north.id}`,
    ]);

    // Pages keep the branch predicate and their cursors are bound to it.
    const first = await call(
      "aManager",
      "GET",
      `/companies/${company}/audit-events?limit=2`,
      {},
    );
    expect(events(first.body)).toEqual(events(managed.body).slice(0, 2));
    const second = await call(
      "aManager",
      "GET",
      `/companies/${company}/audit-events?limit=2&cursor=${first.body.nextCursor as string}`,
      {},
    );
    expect(events(second.body)).toEqual(events(managed.body).slice(2));
    expect(second.body.nextCursor).toBeNull();
    const adminPage = await call(
      "aAdmin",
      "GET",
      `/companies/${company}/audit-events?limit=1`,
      {},
    );
    expect(
      code(
        await call(
          "aManager",
          "GET",
          `/companies/${company}/audit-events?cursor=${adminPage.body.nextCursor as string}`,
          {},
        ),
      ),
    ).toBe("VALIDATION_FAILED");

    expect(
      code(await call("multi", "GET", `/companies/${company}/audit-events`)),
    ).toBe("PERMISSION_DENIED");
    expect(
      code(
        await call(
          "aManager",
          "GET",
          `/companies/${companyB}/audit-events`,
          {},
        ),
      ),
    ).toBe("RESOURCE_NOT_FOUND");

    // The branch rows are tenant-bound and append-only for the runtime role.
    const { rows } = await sql.query<{ id: string }>(
      "SELECT id FROM organization_audit_events WHERE company_id = $1 LIMIT 1",
      [company],
    );
    await expect(
      runtime.query(
        "INSERT INTO organization_audit_event_branches (company_id, event_id, branch_id) VALUES ($1, $2, $3)",
        [company, rows[0].id, b1.id],
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      runtime.query("DELETE FROM organization_audit_event_branches"),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      runtime.query(
        "UPDATE organization_audit_event_branches SET branch_id = $1",
        [south.id],
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("protects versions, active names and archived branches, auditing only committed changes", async () => {
    const before = await auditCount(companyA);
    const stale = await call(
      "aAdmin",
      "PATCH",
      `/companies/${companyA}/branches/${a2.id}`,
      {
        body: { expectedVersion: a2.version + 5, name: "Outro" },
      },
    );
    expect(code(stale)).toBe("RESOURCE_VERSION_CONFLICT");
    const duplicate = await call(
      "aAdmin",
      "POST",
      `/companies/${companyA}/branches`,
      {
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
      { body: { expectedVersion: temporary.version } },
    );
    expect(archived.body).toMatchObject({ status: "ARCHIVED", version: 2 });
    const afterArchive = await call(
      "aAdmin",
      "PATCH",
      `/companies/${companyA}/branches/${temporary.id}`,
      { body: { expectedVersion: 2, name: "De novo" } },
    );
    expect(code(afterArchive)).toBe("BRANCH_ARCHIVED");
    // The archived name can be reused by a new active branch.
    await createBranch("aAdmin", companyA, "temporária");
    expect(await auditCount(companyA)).toBe(before + 3);

    const audit = await call(
      "aAdmin",
      "GET",
      `/companies/${companyA}/audit-events?limit=2`,
      {},
    );
    const items = audit.body.items as {
      action: string;
      details: { branchName: string };
    }[];
    expect(items.map((item) => item.action)).toEqual([
      "branch.created",
      "branch.archived",
    ]);
    expect(items.map((item) => item.details.branchName)).toEqual([
      "temporária",
      "Temporária",
    ]);
    // Cursors are bound to the principal that received them.
    const foreign = await call(
      "multi",
      "GET",
      `/companies/${companyB}/audit-events?cursor=${audit.body.nextCursor as string}`,
      {},
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

  it("lists only authorized company members with caller- and collection-bound pagination", async () => {
    const first = await call(
      "aAdmin",
      "GET",
      `/companies/${companyA}/members?limit=2`,
      {},
    );
    expect(first.status).toBe(200);
    const ids = (first.body.items as { principalId: string }[]).map(
      (member) => member.principalId,
    );
    expect(ids).not.toContain(people.bAdmin);
    expect(ids).not.toContain(people.outsider);
    expect(first.body.items).toHaveLength(2);
    const next = await call(
      "aAdmin",
      "GET",
      `/companies/${companyA}/members?limit=100&cursor=${first.body.nextCursor as string}`,
      {},
    );
    expect(next.status).toBe(200);
    const all = [
      ...(first.body.items as { id: string; displayName: string }[]),
      ...(next.body.items as { id: string; displayName: string }[]),
    ];
    expect(all.length).toBeGreaterThan(2);
    expect(new Set(all.map((member) => member.id)).size).toBe(all.length);
    expect(all.every((member) => member.displayName !== null)).toBe(true);
    const wrong = await call(
      "bAdmin",
      "GET",
      `/companies/${companyB}/members?cursor=${first.body.nextCursor as string}`,
      {},
    );
    expect(code(wrong)).toBe("VALIDATION_FAILED");
    const crossList = await call(
      "aAdmin",
      "GET",
      `/companies/${companyA}/audit-events?cursor=${first.body.nextCursor as string}`,
      {},
    );
    expect(code(crossList)).toBe("VALIDATION_FAILED");
    for (const [person, expected] of [
      ["aOperator", "PERMISSION_DENIED"],
      ["aManager", "PERMISSION_DENIED"],
      ["outsider", "RESOURCE_NOT_FOUND"],
    ] as const) {
      expect(
        code(await call(person, "GET", `/companies/${companyA}/members`)),
      ).toBe(expected);
    }
  });

  it("changes only local membership access, preserves responsibility and keeps removal terminal", async () => {
    const company = await createCompany("aAdmin", "Member lifecycle");
    const member = await addCompanyMember("multi", company);
    const list = await call(
      "aAdmin",
      "GET",
      `/companies/${company}/members`,
      {},
    );
    const responsible = (
      list.body.items as { id: string; responsible: boolean }[]
    ).find((item) => item.responsible)!;
    const change = (id: string, version: number, status: string) =>
      call("aAdmin", "PATCH", `/companies/${company}/members/${id}`, {
        body: { expectedVersion: version, status },
      });
    for (const status of ["SUSPENDED", "REMOVED"])
      expect(code(await change(responsible.id, 1, status))).toBe(
        "RESPONSIBLE_ADMINISTRATOR_PROTECTED",
      );
    expect((await change(member, 1, "SUSPENDED")).status).toBe(204);
    expect(code(await call("multi", "GET", `/companies/${company}`))).toBe(
      "RESOURCE_NOT_FOUND",
    );
    expect(
      (await call("multi", "GET", `/companies/${companyB}`, {})).status,
    ).toBe(200);
    expect(code(await change(member, 1, "ACTIVE"))).toBe(
      "RESOURCE_VERSION_CONFLICT",
    );
    expect((await change(member, 2, "ACTIVE")).status).toBe(204);
    expect((await call("multi", "GET", `/companies/${company}`)).status).toBe(
      200,
    );
    const beforeNoop = await auditCount(company);
    expect((await change(member, 3, "ACTIVE")).status).toBe(204);
    expect(await auditCount(company)).toBe(beforeNoop);
    expect((await change(member, 3, "REMOVED")).status).toBe(204);
    expect(code(await change(member, 4, "ACTIVE"))).toBe("MEMBERSHIP_REMOVED");
    const foreignMember = await sql.query<{ id: string }>(
      "SELECT id FROM memberships WHERE company_id = $1 LIMIT 1",
      [companyB],
    );
    expect(code(await change(foreignMember.rows[0].id, 1, "SUSPENDED"))).toBe(
      "RESOURCE_NOT_FOUND",
    );
    const audit = await call(
      "aAdmin",
      "GET",
      `/companies/${company}/audit-events`,
      {},
    );
    expect(
      (audit.body.items as { action: string; details: object }[])
        .filter((item) => item.action === "membership.status_changed")
        .map((item) => item.details),
    ).toEqual([
      { previousStatus: "ACTIVE", status: "REMOVED" },
      { previousStatus: "SUSPENDED", status: "ACTIVE" },
      { previousStatus: "ACTIVE", status: "SUSPENDED" },
    ]);
  });

  it("requires responsible approval and recent assurance to restore an administrator, including a future grant", async () => {
    const company = await createCompany("aAdmin", "Administrator restoration");
    const admin = await addCompanyMember(
      "multi",
      company,
      "COMPANY_ADMINISTRATOR",
    );
    await addCompanyMember("bAdmin", company, "COMPANY_ADMINISTRATOR");
    const update = (person: Person, version: number, status: string, age = 1) =>
      call(person, "PATCH", `/companies/${company}/members/${admin}`, {
        headers: { "x-test-auth-age": String(age) },
        body: { expectedVersion: version, status },
      });
    expect((await update("aAdmin", 1, "SUSPENDED")).status).toBe(204);
    expect(code(await update("bAdmin", 2, "ACTIVE"))).toBe(
      "RESPONSIBLE_APPROVAL_REQUIRED",
    );
    expect(code(await update("aAdmin", 2, "ACTIVE", 301))).toBe(
      "RECENT_AUTHENTICATION_REQUIRED",
    );
    expect((await update("aAdmin", 2, "ACTIVE")).status).toBe(204);
    expect((await update("aAdmin", 3, "SUSPENDED")).status).toBe(204);
    await sql.query(
      "UPDATE membership_grants SET starts_at = now() + interval '1 hour' WHERE membership_id = $1",
      [admin],
    );
    expect(code(await update("bAdmin", 4, "ACTIVE"))).toBe(
      "RESPONSIBLE_APPROVAL_REQUIRED",
    );
    expect((await update("aAdmin", 4, "ACTIVE")).status).toBe(204);
  });

  it("retains the last effective administrator even when the responsible grant is unavailable", async () => {
    const company = await createCompany("aAdmin", "Last administrator");
    const admin = await addCompanyMember(
      "multi",
      company,
      "COMPANY_ADMINISTRATOR",
    );
    await sql.query(
      "UPDATE membership_grants SET revoked_at = now() WHERE company_id = $1 AND membership_id <> $2",
      [company, admin],
    );
    const before = await auditCount(company);
    const result = await call(
      "multi",
      "PATCH",
      `/companies/${company}/members/${admin}`,
      { body: { expectedVersion: 1, status: "REMOVED" } },
    );
    expect(code(result)).toBe("LAST_ADMINISTRATOR_REQUIRED");
    expect(await auditCount(company)).toBe(before);
  });

  it("serializes competing member changes and rolls back when the audit insert fails", async () => {
    const company = await createCompany(
      "aAdmin",
      "Concurrent membership changes",
    );
    const member = await addCompanyMember("multi", company);
    const update = (version: number, status: string) =>
      call("aAdmin", "PATCH", `/companies/${company}/members/${member}`, {
        body: { expectedVersion: version, status },
      });
    const before = await auditCount(company);
    const results = await Promise.all([
      update(1, "SUSPENDED"),
      update(1, "REMOVED"),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([204, 409]);
    expect(await auditCount(company)).toBe(before + 1);
    const rollbackTarget = await addCompanyMember("outsider", company);
    await sql.query(
      "REVOKE INSERT ON organization_audit_events FROM orion_runtime",
    );
    try {
      const result = await call(
        "aAdmin",
        "PATCH",
        `/companies/${company}/members/${rollbackTarget}`,
        { body: { expectedVersion: 1, status: "REMOVED" } },
      );
      expect(result.status).toBe(500);
    } finally {
      await sql.query(
        "GRANT INSERT ON organization_audit_events TO orion_runtime",
      );
    }
    expect(
      (
        await sql.query(
          "SELECT status, version FROM memberships WHERE id = $1",
          [rollbackTarget],
        )
      ).rows,
    ).toEqual([{ status: "ACTIVE", version: 1 }]);
    expect(await auditCount(company)).toBe(before + 1);
  });

  it("rechecks an actor removed while the transaction waits for the company lock", async () => {
    const company = await createCompany("aAdmin", "Revocation race");
    const actor = await addCompanyMember(
      "multi",
      company,
      "COMPANY_ADMINISTRATOR",
    );
    const target = await addCompanyMember("outsider", company);
    const before = await auditCount(company);
    await sql.query("BEGIN");
    let pending: ReturnType<typeof call> | undefined;
    try {
      const { rows } = await sql.query<{ pid: number }>(
        "SELECT pg_backend_pid() AS pid FROM companies WHERE id = $1 FOR UPDATE",
        [company],
      );
      pending = call(
        "multi",
        "PATCH",
        `/companies/${company}/members/${target}`,
        { body: { expectedVersion: 1, status: "REMOVED" } },
      );
      const deadline = Date.now() + 5000;
      for (;;) {
        const blocked = await sql.query<{ waiting: boolean }>(
          "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))) AS waiting",
          [rows[0].pid],
        );
        if (blocked.rows[0].waiting) break;
        if (Date.now() > deadline)
          throw new Error(
            "The membership writer did not wait for the company lock",
          );
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      await sql.query(
        "UPDATE memberships SET status = 'REMOVED' WHERE id = $1",
        [actor],
      );
      await sql.query("COMMIT");
      expect(code(await pending)).toBe("RESOURCE_NOT_FOUND");
    } finally {
      await sql.query("ROLLBACK");
      await pending;
    }
    expect(
      (
        await sql.query(
          "SELECT status, version FROM memberships WHERE id = $1",
          [target],
        )
      ).rows,
    ).toEqual([{ status: "ACTIVE", version: 1 }]);
    expect(await auditCount(company)).toBe(before);
  });

  it("grants standard roles over the company or active branches without duplicating an identical grant", async () => {
    const company = await createCompany("aAdmin", "Role grants");
    const north = await createBranch("aAdmin", company, "Norte");
    const south = await createBranch("aAdmin", company, "Sul");
    const retired = await createBranch("aAdmin", company, "Antiga");
    await call(
      "aAdmin",
      "POST",
      `/companies/${company}/branches/${retired.id}/archive`,
      { body: { expectedVersion: retired.version } },
    );
    const member = await addCompanyMember("multi", company);
    const grant = (body: object, person: Person = "aAdmin") =>
      call(person, "POST", `/companies/${company}/members/${member}/grants`, {
        body,
      });
    const before = await auditCount(company);
    const manager = await grant({
      role: "BRANCH_MANAGER",
      scope: "BRANCHES",
      branchIds: [south.id, north.id],
    });
    expect(manager.status).toBe(201);
    expect(manager.body).toMatchObject({
      role: "BRANCH_MANAGER",
      scope: "BRANCHES",
      branches: [
        { id: north.id, name: "Norte" },
        { id: south.id, name: "Sul" },
      ],
      expiresAt: null,
    });
    const repeated = await grant({
      role: "BRANCH_MANAGER",
      scope: "BRANCHES",
      branchIds: [north.id, south.id],
    });
    expect(repeated.status).toBe(200);
    expect(repeated.body.id).toBe(manager.body.id);
    expect(await auditCount(company)).toBe(before + 1);

    const later = new Date(Date.now() + 3_600_000).toISOString();
    const temporary = await grant({
      role: "OPERATOR",
      scope: "BRANCHES",
      branchIds: [south.id],
      expiresAt: later,
    });
    expect(temporary.status).toBe(201);
    expect(temporary.body.expiresAt).toBe(later);
    for (const body of [
      {
        role: "COMPANY_ADMINISTRATOR",
        scope: "BRANCHES",
        branchIds: [north.id],
      },
      { role: "OPERATOR", scope: "COMPANY", branchIds: [north.id] },
      { role: "OPERATOR", scope: "BRANCHES" },
      { role: "OPERATOR", scope: "BRANCHES", branchIds: [north.id, north.id] },
      { role: "OPERATOR", scope: "BRANCHES", branchIds: [b1.id] },
      { role: "OPERATOR", scope: "BRANCHES", branchIds: [retired.id] },
      { role: "OPERATOR", scope: "BRANCHES", branchIds: [randomUUID()] },
      {
        role: "OPERATOR",
        scope: "COMPANY",
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      },
      {
        role: "OPERATOR",
        scope: "COMPANY",
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
      },
    ])
      expect(code(await grant(body)), JSON.stringify(body)).toBe(
        "VALIDATION_FAILED",
      );
    expect(await auditCount(company)).toBe(before + 2);

    const members = await call(
      "aAdmin",
      "GET",
      `/companies/${company}/members`,
      {},
    );
    const listed = (
      members.body.items as {
        id: string;
        roles: string[];
        grants: { id: string; role: string; scope: string }[];
      }[]
    ).find((item) => item.id === member)!;
    expect(listed.roles).toEqual(["BRANCH_MANAGER", "OPERATOR"]);
    expect(listed.grants.map((item) => [item.role, item.scope])).toEqual([
      ["OPERATOR", "COMPANY"],
      ["BRANCH_MANAGER", "BRANCHES"],
      ["OPERATOR", "BRANCHES"],
    ]);
    const companyView = await call("multi", "GET", `/companies/${company}`, {});
    expect(companyView.body.access).toMatchObject({
      roles: ["BRANCH_MANAGER", "OPERATOR"],
      responsible: false,
    });
    expect(companyView.body.responsibilityTransfer).toBeNull();

    const audit = await call(
      "aAdmin",
      "GET",
      `/companies/${company}/audit-events`,
      {},
    );
    expect(
      (audit.body.items as { action: string; details: object }[])
        .filter((item) => item.action === "grant.created")
        .map((item) => item.details),
    ).toEqual([
      {
        grantId: temporary.body.id,
        role: "OPERATOR",
        scope: "BRANCHES",
        branchCount: 1,
        expiresAt: later,
      },
      {
        grantId: manager.body.id,
        role: "BRANCH_MANAGER",
        scope: "BRANCHES",
        branchCount: 2,
        expiresAt: null,
      },
    ]);

    const operatorBody = { role: "OPERATOR", scope: "COMPANY" };
    expect(code(await grant(operatorBody, "multi"))).toBe("PERMISSION_DENIED");
    expect(code(await grant(operatorBody, "outsider"))).toBe(
      "RESOURCE_NOT_FOUND",
    );
    const foreignMember = await sql.query<{ id: string }>(
      "SELECT id FROM memberships WHERE company_id = $1 LIMIT 1",
      [companyB],
    );
    expect(
      code(
        await call(
          "aAdmin",
          "POST",
          `/companies/${company}/members/${foreignMember.rows[0].id}/grants`,
          { body: operatorBody },
        ),
      ),
    ).toBe("RESOURCE_NOT_FOUND");
    const removed = await addCompanyMember("outsider", company);
    expect(
      (
        await call(
          "aAdmin",
          "PATCH",
          `/companies/${company}/members/${removed}`,
          {
            body: { expectedVersion: 1, status: "REMOVED" },
          },
        )
      ).status,
    ).toBe(204);
    expect(
      code(
        await call(
          "aAdmin",
          "POST",
          `/companies/${company}/members/${removed}/grants`,
          { body: operatorBody },
        ),
      ),
    ).toBe("MEMBERSHIP_REMOVED");
  });

  it("lets only the recently verified responsible administrator grant administration and keeps administrators on revocation", async () => {
    const company = await createCompany("aAdmin", "Administrator grants");
    await addCompanyMember("bAdmin", company, "COMPANY_ADMINISTRATOR");
    const member = await addCompanyMember("multi", company);
    const grant = (person: Person, body: object, age = 1) =>
      call(person, "POST", `/companies/${company}/members/${member}/grants`, {
        headers: { "x-test-auth-age": String(age) },
        body,
      });
    const administration = { role: "COMPANY_ADMINISTRATOR", scope: "COMPANY" };
    expect(code(await grant("bAdmin", administration))).toBe(
      "RESPONSIBLE_APPROVAL_REQUIRED",
    );
    expect(code(await grant("aAdmin", administration, 301))).toBe(
      "RECENT_AUTHENTICATION_REQUIRED",
    );
    const admin = await grant("aAdmin", administration);
    expect(admin.status).toBe(201);
    // Any administrator may grant the other standard roles.
    const existingOperator = await grant("bAdmin", {
      role: "OPERATOR",
      scope: "COMPANY",
    });
    expect(existingOperator.status).toBe(200);
    expect(
      (await call("multi", "GET", `/companies/${company}/members`, {})).status,
    ).toBe(200);

    const list = await call(
      "aAdmin",
      "GET",
      `/companies/${company}/members`,
      {},
    );
    const items = list.body.items as {
      id: string;
      principalId: string;
      responsible: boolean;
      grants: { id: string; role: string }[];
    }[];
    const responsible = items.find((item) => item.responsible)!;
    const revoke = (person: Person, memberId: string, grantId: string) =>
      call(
        person,
        "POST",
        `/companies/${company}/members/${memberId}/grants/${grantId}/revoke`,
        {},
      );
    expect(
      code(await revoke("bAdmin", responsible.id, responsible.grants[0].id)),
    ).toBe("RESPONSIBLE_ADMINISTRATOR_PROTECTED");
    // A second administrator grant keeps administration when one is revoked.
    const extra = await call(
      "aAdmin",
      "POST",
      `/companies/${company}/members/${responsible.id}/grants`,
      {
        body: {
          ...administration,
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        },
      },
    );
    expect(extra.status).toBe(201);
    expect(
      (await revoke("bAdmin", responsible.id, responsible.grants[0].id)).status,
    ).toBe(204);
    expect(
      code(await revoke("bAdmin", responsible.id, extra.body.id as string)),
    ).toBe("RESPONSIBLE_ADMINISTRATOR_PROTECTED");

    const before = await auditCount(company);
    expect(
      (await revoke("bAdmin", member, admin.body.id as string)).status,
    ).toBe(204);
    expect(
      (await revoke("bAdmin", member, admin.body.id as string)).status,
    ).toBe(204);
    expect(await auditCount(company)).toBe(before + 1);
    expect(
      code(await call("multi", "GET", `/companies/${company}/members`, {})),
    ).toBe("PERMISSION_DENIED");
    expect(code(await revoke("bAdmin", member, randomUUID()))).toBe(
      "RESOURCE_NOT_FOUND",
    );
    expect(code(await revoke("bAdmin", member, extra.body.id as string))).toBe(
      "RESOURCE_NOT_FOUND",
    );
    const audit = await call(
      "aAdmin",
      "GET",
      `/companies/${company}/audit-events?limit=1`,
      {},
    );
    expect(audit.body.items).toMatchObject([
      {
        action: "grant.revoked",
        targetId: member,
        details: {
          grantId: admin.body.id,
          role: "COMPANY_ADMINISTRATOR",
          scope: "COMPANY",
        },
      },
    ]);

    const lastCompany = await createCompany(
      "aAdmin",
      "Last administrator grant",
    );
    const last = await addCompanyMember(
      "multi",
      lastCompany,
      "COMPANY_ADMINISTRATOR",
    );
    await sql.query(
      "UPDATE membership_grants SET revoked_at = now() WHERE company_id = $1 AND membership_id <> $2",
      [lastCompany, last],
    );
    const { rows } = await sql.query<{ id: string }>(
      "SELECT id FROM membership_grants WHERE membership_id = $1",
      [last],
    );
    expect(
      code(
        await call(
          "multi",
          "POST",
          `/companies/${lastCompany}/members/${last}/grants/${rows[0].id}/revoke`,
          {},
        ),
      ),
    ).toBe("LAST_ADMINISTRATOR_REQUIRED");
  });

  it("moves responsibility only when an eligible successor accepts the proposal", async () => {
    const company = await createCompany("aAdmin", "Responsibility transfer");
    const successor = await addCompanyMember(
      "multi",
      company,
      "COMPANY_ADMINISTRATOR",
    );
    const operator = await addCompanyMember("outsider", company);
    const otherAdmin = await addCompanyMember(
      "bAdmin",
      company,
      "COMPANY_ADMINISTRATOR",
    );
    const { rows: responsibility } = await sql.query<{ membership_id: string }>(
      "SELECT membership_id FROM company_responsibilities WHERE company_id = $1",
      [company],
    );
    const original = responsibility[0].membership_id;
    const propose = (person: Person, successorMembershipId: string, age = 1) =>
      call(person, "POST", `/companies/${company}/responsibility-transfers`, {
        headers: { "x-test-auth-age": String(age) },
        body: { successorMembershipId },
      });
    expect(code(await propose("bAdmin", successor))).toBe(
      "RESPONSIBLE_APPROVAL_REQUIRED",
    );
    expect(code(await propose("aAdmin", successor, 301))).toBe(
      "RECENT_AUTHENTICATION_REQUIRED",
    );
    expect(code(await propose("aAdmin", operator))).toBe(
      "SUCCESSOR_NOT_ELIGIBLE",
    );
    expect(code(await propose("aAdmin", original))).toBe("VALIDATION_FAILED");
    const foreignMember = await sql.query<{ id: string }>(
      "SELECT id FROM memberships WHERE company_id = $1 LIMIT 1",
      [companyB],
    );
    expect(code(await propose("aAdmin", foreignMember.rows[0].id))).toBe(
      "RESOURCE_NOT_FOUND",
    );
    const proposed = await propose("aAdmin", successor);
    expect(proposed.status).toBe(201);
    expect(proposed.body).toMatchObject({
      direction: "outgoing",
      fromMembershipId: original,
      toMembershipId: successor,
      counterpartName: "multi",
    });
    expect(
      Date.parse(proposed.body.expiresAt as string) -
        Date.parse(proposed.body.createdAt as string),
    ).toBe(7 * 24 * 3_600_000);
    const transfer = proposed.body.id as string;
    expect(code(await propose("aAdmin", otherAdmin))).toBe(
      "RESPONSIBILITY_TRANSFER_PENDING",
    );
    const view = async (person: Person) =>
      (await call(person, "GET", `/companies/${company}`, {})).body
        .responsibilityTransfer as { direction: string } | null;
    expect(await view("multi")).toMatchObject({
      id: transfer,
      direction: "incoming",
      counterpartName: "aAdmin",
    });
    expect(await view("aAdmin")).toMatchObject({ direction: "outgoing" });
    expect(await view("bAdmin")).toBeNull();
    expect(await view("outsider")).toBeNull();

    const accept = (person: Person, options: { age?: number } = {}) =>
      call(
        person,
        "POST",
        `/companies/${company}/responsibility-transfers/${transfer}/accept`,
        {
          headers: { "x-test-auth-age": String(options.age ?? 1) },
        },
      );
    for (const person of ["bAdmin", "outsider", "aAdmin", "aOperator"] as const)
      expect(code(await accept(person)), person).toBe("RESOURCE_NOT_FOUND");
    expect(code(await accept("multi", { age: 301 }))).toBe(
      "RECENT_AUTHENTICATION_REQUIRED",
    );
    // The successor must still administer the company when accepting.
    const members = await call(
      "aAdmin",
      "GET",
      `/companies/${company}/members`,
      {},
    );
    const successorGrant = (
      members.body.items as { id: string; grants: { id: string }[] }[]
    ).find((item) => item.id === successor)!.grants[0].id;
    expect(
      (
        await call(
          "bAdmin",
          "POST",
          `/companies/${company}/members/${successor}/grants/${successorGrant}/revoke`,
          {},
        )
      ).status,
    ).toBe(204);
    expect(code(await accept("multi"))).toBe("SUCCESSOR_NOT_ELIGIBLE");
    expect(
      (
        await call(
          "aAdmin",
          "POST",
          `/companies/${company}/members/${successor}/grants`,
          {
            body: { role: "COMPANY_ADMINISTRATOR", scope: "COMPANY" },
          },
        )
      ).status,
    ).toBe(201);

    const before = await auditCount(company);
    expect((await accept("multi")).status).toBe(204);
    expect(await auditCount(company)).toBe(before + 1);
    expect(
      (
        await sql.query(
          "SELECT membership_id FROM company_responsibilities WHERE company_id = $1",
          [company],
        )
      ).rows,
    ).toEqual([{ membership_id: successor }]);
    expect(code(await accept("multi"))).toBe(
      "RESPONSIBILITY_TRANSFER_NOT_PENDING",
    );
    expect(await view("multi")).toBeNull();
    expect(
      (await call("multi", "GET", `/companies/${company}`, {})).body.access,
    ).toMatchObject({ responsible: true });
    expect(code(await propose("aAdmin", otherAdmin))).toBe(
      "RESPONSIBLE_APPROVAL_REQUIRED",
    );
    const audit = await call(
      "multi",
      "GET",
      `/companies/${company}/audit-events?limit=1`,
      {},
    );
    expect(audit.body.items).toMatchObject([
      {
        action: "responsibility.transferred",
        targetId: successor,
        details: { transferId: transfer, previousMembershipId: original },
      },
    ]);
    // The previous responsible administrator is an ordinary administrator now.
    expect(
      (
        await call(
          "multi",
          "PATCH",
          `/companies/${company}/members/${original}`,
          {
            body: { expectedVersion: 1, status: "SUSPENDED" },
          },
        )
      ).status,
    ).toBe(204);
    expect(
      code(
        await call(
          "multi",
          "PATCH",
          `/companies/${company}/members/${successor}`,
          {
            body: { expectedVersion: 1, status: "SUSPENDED" },
          },
        ),
      ),
    ).toBe("RESPONSIBLE_ADMINISTRATOR_PROTECTED");
  });

  it("closes declined, cancelled and expired transfers without moving responsibility", async () => {
    const company = await createCompany("aAdmin", "Closed transfers");
    const successor = await addCompanyMember(
      "multi",
      company,
      "COMPANY_ADMINISTRATOR",
    );
    const otherAdmin = await addCompanyMember(
      "bAdmin",
      company,
      "COMPANY_ADMINISTRATOR",
    );
    const propose = (successorMembershipId = successor) =>
      call("aAdmin", "POST", `/companies/${company}/responsibility-transfers`, {
        body: { successorMembershipId },
      });
    const close = (person: Person, transferId: string) =>
      call(
        person,
        "POST",
        `/companies/${company}/responsibility-transfers/${transferId}/cancel`,
      );
    const status = async (transferId: string) =>
      (
        await sql.query<{ status: string }>(
          "SELECT status::text AS status FROM responsibility_transfers WHERE id = $1",
          [transferId],
        )
      ).rows[0].status;

    const declined = (await propose()).body.id as string;
    expect(code(await close("bAdmin", declined))).toBe("RESOURCE_NOT_FOUND");
    expect((await close("multi", declined)).status).toBe(204);
    expect(await status(declined)).toBe("DECLINED");
    expect(code(await close("multi", declined))).toBe(
      "RESPONSIBILITY_TRANSFER_NOT_PENDING",
    );

    const cancelled = (await propose()).body.id as string;
    expect((await close("aAdmin", cancelled)).status).toBe(204);
    expect(await status(cancelled)).toBe("CANCELLED");

    const expired = (await propose()).body.id as string;
    await sql.query(
      "UPDATE responsibility_transfers SET created_at = now() - interval '8 days', expires_at = now() - interval '1 day' WHERE id = $1",
      [expired],
    );
    expect(
      (await call("multi", "GET", `/companies/${company}`, {})).body
        .responsibilityTransfer,
    ).toBeNull();
    expect(
      code(
        await call(
          "multi",
          "POST",
          `/companies/${company}/responsibility-transfers/${expired}/accept`,
          {},
        ),
      ),
    ).toBe("RESPONSIBILITY_TRANSFER_NOT_PENDING");
    const results = await Promise.all([propose(), propose(otherAdmin)]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(await status(expired)).toBe("EXPIRED");

    const { rows } = await sql.query<{ membership_id: string }>(
      "SELECT r.membership_id FROM company_responsibilities r JOIN memberships m ON m.id = r.membership_id WHERE r.company_id = $1 AND m.principal_id = $2",
      [company, people.aAdmin],
    );
    expect(rows).toHaveLength(1);
    const audit = await call(
      "aAdmin",
      "GET",
      `/companies/${company}/audit-events`,
      {},
    );
    expect(
      (audit.body.items as { action: string }[])
        .map((item) => item.action)
        .filter((action) => action.startsWith("responsibility.")),
    ).toEqual([
      "responsibility.transfer_requested",
      "responsibility.transfer_requested",
      "responsibility.transfer_cancelled",
      "responsibility.transfer_requested",
      "responsibility.transfer_declined",
      "responsibility.transfer_requested",
    ]);
  });

  it("keeps transfer parties tenant-bound, immutable and one pending per company for the runtime role", async () => {
    const company = await createCompany("aAdmin", "Transfer constraints");
    const successor = await addCompanyMember(
      "multi",
      company,
      "COMPANY_ADMINISTRATOR",
    );
    const transfer = (
      await call(
        "aAdmin",
        "POST",
        `/companies/${company}/responsibility-transfers`,
        {
          body: { successorMembershipId: successor },
        },
      )
    ).body.id as string;
    const { rows } = await sql.query<{ membership_id: string }>(
      "SELECT membership_id FROM company_responsibilities WHERE company_id = $1",
      [company],
    );
    const foreign = await sql.query<{ id: string }>(
      "SELECT id FROM memberships WHERE company_id = $1 LIMIT 1",
      [companyB],
    );
    // A closed row avoids the one-pending index, so the reference is what fails.
    const insert = (to: string, status = "PENDING") =>
      runtime.query(
        "INSERT INTO responsibility_transfers (id, company_id, from_membership_id, to_membership_id, status, expires_at, decided_at) VALUES ($1, $2, $3, $4, $5, now() + interval '1 day', $6)",
        [
          randomUUID(),
          company,
          rows[0].membership_id,
          to,
          status,
          status === "PENDING" ? null : new Date(),
        ],
      );
    await expect(insert(successor)).rejects.toMatchObject({ code: "23505" });
    await expect(insert(foreign.rows[0].id, "CANCELLED")).rejects.toMatchObject(
      {
        code: "23503",
      },
    );
    await expect(
      runtime.query(
        "UPDATE responsibility_transfers SET to_membership_id = from_membership_id WHERE id = $1",
        [transfer],
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      runtime.query(
        "UPDATE responsibility_transfers SET status = 'ACCEPTED' WHERE id = $1",
        [transfer],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      runtime.query("DELETE FROM responsibility_transfers WHERE id = $1", [
        transfer,
      ]),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      runtime.query(
        "UPDATE membership_grants SET role = 'COMPANY_ADMINISTRATOR' WHERE company_id = $1",
        [company],
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("paginates more than 200 companies with stable boundaries and current membership predicates", async () => {
    const { rows } = await sql.query<{ company_id: string }>(
      `
      WITH created AS (
        INSERT INTO companies (id, display_name, default_locale, time_zone,
          created_by_principal_id, creation_key, creation_fingerprint, created_at)
        SELECT gen_random_uuid(), 'Page company ' || n, 'pt-BR', 'UTC', $1,
          'page-' || n, repeat('0', 64), '2026-10-18 00:00:00+00'
        FROM generate_series(1, 205) n RETURNING id
      ), members AS (
        INSERT INTO memberships (id, company_id, principal_id)
        SELECT gen_random_uuid(), id, $1 FROM created RETURNING id, company_id
      )
      INSERT INTO membership_grants (id, company_id, membership_id, role, scope)
      SELECT gen_random_uuid(), company_id, id, 'OPERATOR', 'COMPANY' FROM members
      RETURNING company_id`,
      [people.paged],
    );
    const expected = rows
      .map((row) => row.company_id)
      .sort()
      .reverse();
    const first = await call("paged", "GET", "/companies?limit=100");
    expect(first.status).toBe(200);
    const firstItems = first.body.items as { id: string }[];
    expect(firstItems.map((item) => item.id)).toEqual(expected.slice(0, 100));
    const cursor = first.body.nextCursor as string;
    expect(typeof cursor).toBe("string");
    const foreign = await call("aAdmin", "GET", `/companies?cursor=${cursor}`);
    expect(foreign.status).toBe(400);
    expect(code(foreign)).toBe("VALIDATION_FAILED");

    // Renames cannot move the page boundary, and current access still applies.
    await sql.query(
      "UPDATE companies SET display_name = 'Renamed boundary' WHERE id = $1",
      [expected[99]],
    );
    await sql.query(
      "UPDATE memberships SET status = 'REMOVED' WHERE company_id = $1 AND principal_id = $2",
      [expected[110], people.paged],
    );
    await sql.query(
      "UPDATE memberships SET status = 'SUSPENDED' WHERE company_id = $1 AND principal_id = $2",
      [expected[111], people.paged],
    );
    await sql.query(
      "UPDATE membership_grants SET starts_at = now() - interval '1 hour', expires_at = now() - interval '1 second' WHERE company_id = $1",
      [expected[112]],
    );
    await sql.query("UPDATE companies SET status = 'SUSPENDED' WHERE id = $1", [
      expected[113],
    ]);
    const all = [...firstItems];
    let next: string | null = cursor;
    while (next) {
      const page = await call(
        "paged",
        "GET",
        `/companies?limit=100&cursor=${next}`,
      );
      expect(page.status).toBe(200);
      const items = page.body.items as {
        id: string;
        roles: string[];
        status: string;
      }[];
      const expired = items.find((item) => item.id === expected[112]);
      if (expired) expect(expired.roles).toEqual([]);
      const suspended = items.find((item) => item.id === expected[113]);
      if (suspended) expect(suspended.status).toBe("SUSPENDED");
      all.push(...items);
      next = page.body.nextCursor as string | null;
    }
    expect(all.map((item) => item.id)).toEqual(
      expected.filter((_, index) => index !== 110 && index !== 111),
    );
    expect(new Set(all.map((item) => item.id)).size).toBe(203);
    const defaultPage = await call("paged", "GET", "/companies");
    expect(defaultPage.body.items).toHaveLength(50);

    const fields = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as Record<string, string>;
    for (const invalid of [
      "bad-json",
      Buffer.from("[]").toString("base64url"),
      ...[
        { ...fields, t: "invalid" },
        { ...fields, i: "invalid" },
        { ...fields, k: "audit" },
        { ...fields, c: companyA },
      ].map((value) =>
        Buffer.from(JSON.stringify(value)).toString("base64url"),
      ),
    ]) {
      const rejected = await call(
        "paged",
        "GET",
        `/companies?cursor=${invalid}`,
      );
      expect(rejected.status).toBe(400);
      expect(code(rejected)).toBe("VALIDATION_FAILED");
    }
    for (const limit of [0, 101, -1]) {
      const rejected = await call("paged", "GET", `/companies?limit=${limit}`);
      expect(rejected.status).toBe(400);
    }
  });

  it("paginates branches with a bound cursor", async () => {
    const first = await call(
      "aAdmin",
      "GET",
      `/companies/${companyA}/branches?limit=2`,
      {},
    );
    const page = first.body.items as { id: string }[];
    expect(page).toHaveLength(2);
    const second = await call(
      "aAdmin",
      "GET",
      `/companies/${companyA}/branches?limit=2&cursor=${first.body.nextCursor as string}`,
      {},
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
      {},
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
        {},
      );
      expect(result.status).toBe(400);
      expect(code(result)).toBe("VALIDATION_FAILED");
    }
    const crossList = await call(
      "aAdmin",
      "GET",
      `/companies/${companyA}/audit-events?cursor=${cursor}`,
      {},
    );
    expect(code(crossList)).toBe("VALIDATION_FAILED");
    const audit = await call(
      "aAdmin",
      "GET",
      `/companies/${companyA}/audit-events?limit=1`,
      {},
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
      {},
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
      code(await call("bAdmin", "GET", `/companies/${companyB}/branches`, {})),
    ).toBe("COMPANY_SUSPENDED");
    await sql.query("UPDATE companies SET status = 'ACTIVE' WHERE id = $1", [
      companyB,
    ]);
  });

  it("lets administrators define access profiles whose current capabilities and assurance bind every holder", async () => {
    const company = await createCompany("aAdmin", "Profiles");
    const north = await createBranch("aAdmin", company, "Norte");
    await createBranch("aAdmin", company, "Sul");
    // A membership without grants, which only the profile will empower.
    const member = randomUUID();
    await sql.query(
      "INSERT INTO memberships (id, company_id, principal_id) VALUES ($1, $2, $3)",
      [member, company, people.multi],
    );
    await grantBranches("aManager", company, "BRANCH_MANAGER", [north.id]);
    const profiles = `/companies/${company}/access-profiles`;
    const create = (body: object, person: Person = "aAdmin") =>
      call(person, "POST", profiles, { body });

    const created = await create({
      name: "Supervisão",
      capabilities: ["audit.view", "branches.view"],
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      name: "Supervisão",
      capabilities: ["branches.view", "audit.view"],
      status: "ACTIVE",
      version: 1,
      memberCount: 0,
      grantCount: 0,
    });
    const profileId = created.body.id as string;
    for (const [body, expected] of [
      [
        { name: "Admin", capabilities: ["members.manage"] },
        "VALIDATION_FAILED",
      ],
      [{ name: "Vazio", capabilities: [] }, "VALIDATION_FAILED"],
      [
        { name: "Dup", capabilities: ["audit.view", "audit.view"] },
        "VALIDATION_FAILED",
      ],
      [
        { name: " supervisão ", capabilities: ["branches.view"] },
        "PROFILE_NAME_IN_USE",
      ],
    ] as const)
      expect(code(await create(body)), JSON.stringify(body)).toBe(expected);
    expect(
      code(
        await create(
          { name: "X", capabilities: ["branches.view"] },
          "aManager",
        ),
      ),
    ).toBe("PERMISSION_DENIED");
    expect(code(await call("bAdmin", "GET", profiles, {}))).toBe(
      "RESOURCE_NOT_FOUND",
    );

    // A grant carries exactly one role or one active profile of this company.
    const grant = (body: object) =>
      call("aAdmin", "POST", `/companies/${company}/members/${member}/grants`, {
        body,
      });
    const otherProfile = await call(
      "bAdmin",
      "POST",
      `/companies/${companyB}/access-profiles`,
      { body: { name: "B", capabilities: ["branches.view"] } },
    );
    expect(otherProfile.status).toBe(201);
    for (const body of [
      { scope: "COMPANY" },
      { role: "OPERATOR", profileId, scope: "COMPANY" },
      { profileId: otherProfile.body.id, scope: "COMPANY" },
      { profileId: randomUUID(), scope: "COMPANY" },
      { profileId, scope: "BRANCHES" },
    ])
      expect(code(await grant(body)), JSON.stringify(body)).toBe(
        "VALIDATION_FAILED",
      );
    const granted = await grant({
      profileId,
      scope: "BRANCHES",
      branchIds: [north.id],
    });
    expect(granted.status).toBe(201);
    expect(granted.body).toMatchObject({
      role: null,
      profile: { id: profileId, name: "Supervisão" },
      scope: "BRANCHES",
      branches: [{ id: north.id, name: "Norte" }],
    });
    expect(
      (await grant({ profileId, scope: "BRANCHES", branchIds: [north.id] }))
        .status,
    ).toBe(200);

    // The profile reaches only its branches, and audit.view needs two-step verification.
    const branches = await call(
      "multi",
      "GET",
      `/companies/${company}/branches`,
    );
    expect(
      (branches.body.items as { id: string }[]).map((item) => item.id),
    ).toEqual([north.id]);
    const summary = await call("multi", "GET", `/companies/${company}`);
    expect(summary.body.access).toMatchObject({
      roles: [],
      profiles: ["Supervisão"],
      capabilities: ["company.view", "branches.view", "audit.view"],
    });
    const audit = await call(
      "multi",
      "GET",
      `/companies/${company}/audit-events`,
      {},
    );
    expect(audit.status).toBe(200);
    expect(
      (audit.body.items as { action: string }[]).map((item) => item.action),
    ).toEqual(["grant.created", "branch.created"]);

    // The detail shows who an edit would affect.
    const detail = await call("aAdmin", "GET", `${profiles}/${profileId}`, {});
    expect(detail.body).toMatchObject({
      profile: { memberCount: 1, grantCount: 1 },
      holders: [
        {
          membershipId: member,
          displayName: "multi",
          membershipStatus: "ACTIVE",
          scope: "BRANCHES",
          branches: [{ id: north.id, name: "Norte" }],
        },
      ],
      holdersTruncated: false,
    });
    expect(
      code(
        await call(
          "bAdmin",
          "GET",
          `/companies/${companyB}/access-profiles/${profileId}`,
          {},
        ),
      ),
    ).toBe("RESOURCE_NOT_FOUND");

    // Edits apply to the next request of every holder and are audited.
    const update = (body: object) =>
      call("aAdmin", "PATCH", `${profiles}/${profileId}`, {
        body,
      });
    expect(
      code(
        await update({ expectedVersion: 7, capabilities: ["branches.view"] }),
      ),
    ).toBe("RESOURCE_VERSION_CONFLICT");
    const before = await auditCount(company);
    const unchanged = await update({
      expectedVersion: 1,
      capabilities: ["branches.view", "audit.view"],
    });
    expect(unchanged.body.version).toBe(1);
    expect(await auditCount(company)).toBe(before);
    const narrowed = await update({
      expectedVersion: 1,
      name: "Leitura",
      capabilities: ["branches.view"],
    });
    expect(narrowed.status).toBe(200);
    expect(narrowed.body).toMatchObject({
      name: "Leitura",
      capabilities: ["branches.view"],
      version: 2,
    });
    expect(
      code(
        await call("multi", "GET", `/companies/${company}/audit-events`, {}),
      ),
    ).toBe("PERMISSION_DENIED");
    const history = await call(
      "aAdmin",
      "GET",
      `/companies/${company}/audit-events?limit=1`,
      {},
    );
    expect(history.body.items).toMatchObject([
      {
        action: "profile.updated",
        targetType: "access_profile",
        targetId: profileId,
        details: {
          profileName: "Leitura",
          fields: ["name", "capabilities"],
          addedCapabilities: [],
          removedCapabilities: ["audit.view"],
          affectedGrants: 1,
        },
      },
    ]);

    // Archival waits until nobody holds the profile; archived profiles are frozen.
    const archive = (expectedVersion: number) =>
      call("aAdmin", "POST", `${profiles}/${profileId}/archive`, {
        body: { expectedVersion },
      });
    expect(code(await archive(2))).toBe("PROFILE_IN_USE");
    const members = await call(
      "aAdmin",
      "GET",
      `/companies/${company}/members`,
      {},
    );
    const held = (
      members.body.items as {
        id: string;
        grants: { id: string; profile: { id: string } | null }[];
      }[]
    )
      .find((item) => item.id === member)!
      .grants.find((item) => item.profile?.id === profileId)!;
    expect(
      (
        await call(
          "aAdmin",
          "POST",
          `/companies/${company}/members/${member}/grants/${held.id}/revoke`,
          {},
        )
      ).status,
    ).toBe(204);
    const archived = await archive(2);
    expect(archived.body).toMatchObject({ status: "ARCHIVED", version: 3 });
    expect(code(await archive(3))).toBe("PROFILE_ARCHIVED");
    expect(
      code(await update({ expectedVersion: 3, capabilities: ["audit.view"] })),
    ).toBe("PROFILE_ARCHIVED");
    expect(code(await grant({ profileId, scope: "COMPANY" }))).toBe(
      "VALIDATION_FAILED",
    );
    const active = await call("aAdmin", "GET", profiles, {});
    expect(active.body.items).toEqual([]);
    const all = await call(
      "aAdmin",
      "GET",
      `${profiles}?includeArchived=true`,
      {},
    );
    expect(all.body.items).toMatchObject([
      { id: profileId, status: "ARCHIVED" },
    ]);
    expect(
      (await create({ name: "Leitura", capabilities: ["branches.view"] }))
        .status,
    ).toBe(201);

    // The schema itself keeps profiles delegable, tenant-bound and exclusive of roles.
    await expect(
      runtime.query(
        "INSERT INTO access_profiles (id, company_id, name, capabilities) VALUES ($1, $2, 'Bad', ARRAY['members.manage'])",
        [randomUUID(), company],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      runtime.query(
        "INSERT INTO membership_grants (id, company_id, membership_id, role, profile_id, scope) VALUES ($1, $2, $3, 'OPERATOR', $4, 'COMPANY')",
        [randomUUID(), company, member, profileId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      runtime.query(
        "INSERT INTO membership_grants (id, company_id, membership_id, profile_id, scope) VALUES ($1, $2, $3, $4, 'COMPANY')",
        [randomUUID(), company, member, otherProfile.body.id],
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      runtime.query("UPDATE access_profiles SET company_id = $1", [companyB]),
    ).rejects.toMatchObject({ code: "42501" });
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
      // Media objects are content-addressed: their tenant key is the hash.
      expect(
        reference.target_columns,
        `${reference.name} must target the tenant key`,
      ).toEqual(
        reference.target === "media_objects"
          ? ["company_id", "sha256"]
          : ["company_id", "id"],
      );
    }
  });
});
