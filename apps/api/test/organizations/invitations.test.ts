import { randomUUID } from "node:crypto";
import pg from "pg";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createDatabase, type Database } from "../../src/database.js";
import type { HumanSessionPort } from "../../src/features/identity/public.js";
import { createMailModule } from "../../src/features/mail/module.js";
import type {
  MailTransport,
  OutgoingEmail,
} from "../../src/features/mail/smtp.js";
import { createInvitationsModule } from "../../src/features/organizations/invitations-module.js";
import { createOrganizationsModule } from "../../src/features/organizations/module.js";
import { activateModules, type ApiModule } from "../../src/module.js";
import { withMigratedDatabase } from "../../scripts/migrated-database.js";

// Company invitations (D-13) over a synthetic session port and a capturing
// mail transport; delivery itself is covered by the mail suite.
type App = ReturnType<typeof createApp>["app"];
let app: App;
let sql: pg.Client;
let database: Database;
let release: () => void;
let stopped: Promise<void>;
const sent: OutgoingEmail[] = [];
let mail: ReturnType<typeof createMailModule>;

const people = {
  owner: randomUUID(),
  admin: randomUUID(),
  manager: randomUUID(),
  operator: randomUUID(),
  invitee: randomUUID(),
  other: randomUUID(),
  outsider: randomUUID(),
};
type Person = keyof typeof people;
const emails: Partial<Record<Person, string | null>> = {};
const emailOf = (person: Person) =>
  emails[person] === undefined ? `${person}@example.test` : emails[person];

const sessions: HumanSessionPort = {
  authenticate: ({ headers }) => {
    const strong = headers["x-test-strong"] === "true";
    const age = Number(headers["x-test-strong-age"] ?? 1);
    return Promise.resolve({
      principalId: headers["x-test-principal"] as string,
      sessionId: randomUUID(),
      assuranceLevel: strong ? "teluni-aal2" : "teluni-aal1",
      authenticatedAt: new Date(),
      strongAuthenticatedAt: strong ? new Date(Date.now() - age * 1000) : null,
      strongAuthenticationAgeSeconds: strong ? age : null,
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
const profiles = {
  getMany: (ids: readonly string[]) =>
    Promise.resolve(
      ids.map((id) => {
        const person = (Object.entries(people).find(
          ([, principal]) => principal === id,
        )?.[0] ?? "outsider") as Person;
        return {
          principalId: id,
          displayName: `Person ${person}`,
          email: emailOf(person),
        };
      }),
    ),
};
const capture: MailTransport = {
  send(message) {
    sent.push(message);
    return Promise.resolve({ kind: "sent" });
  },
  close: () => undefined,
};

beforeAll(async () => {
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
    mail = createMailModule({
      transport: capture,
      manual: true,
      maintenanceMs: 0,
    });
    const organizations = createOrganizationsModule({
      sessions,
      profiles,
      rateLimit: { max: 10_000, timeWindow: 60_000 },
    });
    const invitations = createInvitationsModule({
      sessions,
      profiles,
      companies: organizations.companies,
      mail,
      rateLimit: { max: 10_000, timeWindow: 60_000 },
    });
    const modules = activateModules(
      [identityStub, mail.module, organizations.module, invitations],
      {
        database,
        mail: {
          environment: "test",
          publicOrigin: "http://127.0.0.1:5173",
          smtp: { host: "127.0.0.1", port: 1025, security: "none" },
          from: "no-reply@teluni.test",
          keys: [{ id: "m1", key: Buffer.alloc(32, 3) }],
        },
      },
      "test",
    );
    ({ app } = createApp(pino({ level: "silent" }), undefined, { modules }));
    await app.ready();
    ready();
    await new Promise<void>((resolve) => (release = resolve));
    await app.close();
    await database.$disconnect();
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
  options: { body?: unknown; strong?: boolean; age?: number } = {},
) {
  const response = await app.inject({
    method,
    url,
    headers: {
      "x-test-principal": people[person],
      "x-test-strong": String(options.strong ?? true),
      "x-test-strong-age": String(options.age ?? 1),
      ...(method === "POST" && url.endsWith("/companies")
        ? { "idempotency-key": `key-${randomUUID()}` }
        : {}),
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

async function createCompany(displayName: string) {
  const created = await call("owner", "POST", "/companies", {
    body: {
      displayName,
      defaultLocale: "pt-BR",
      timeZone: "America/Sao_Paulo",
    },
  });
  expect(created.status).toBe(201);
  return (created.body.company as { id: string }).id;
}

async function createBranch(companyId: string, branchName: string) {
  const created = await call(
    "owner",
    "POST",
    `/companies/${companyId}/branches`,
    {
      body: { name: branchName },
    },
  );
  expect(created.status).toBe(201);
  return (created.body as { id: string }).id;
}

/** Fixture only: arranges a membership with one grant in the database. */
async function member(
  person: Person,
  companyId: string,
  role: "COMPANY_ADMINISTRATOR" | "BRANCH_MANAGER" | "OPERATOR",
  branchIds: string[] = [],
  status = "ACTIVE",
) {
  const membership = randomUUID();
  const grant = randomUUID();
  await sql.query(
    "INSERT INTO memberships (id, company_id, principal_id, status) VALUES ($1, $2, $3, $4)",
    [membership, companyId, people[person], status],
  );
  await sql.query(
    "INSERT INTO membership_grants (id, company_id, membership_id, role, scope) VALUES ($1, $2, $3, $4, $5)",
    [
      grant,
      companyId,
      membership,
      role,
      branchIds.length ? "BRANCHES" : "COMPANY",
    ],
  );
  for (const branchId of branchIds)
    await sql.query(
      "INSERT INTO membership_grant_branches (company_id, grant_id, branch_id) VALUES ($1, $2, $3)",
      [companyId, grant, branchId],
    );
  return membership;
}

const invite = (
  person: Person,
  companyId: string,
  body: Record<string, unknown>,
  options: { strong?: boolean; age?: number } = {},
) =>
  call(person, "POST", `/companies/${companyId}/invitations`, {
    ...options,
    body,
  });

async function deliver(): Promise<void> {
  while ((await mail.runOnce()) > 0);
}

/** The credential from the latest email to `recipient`. */
async function credentialFor(recipient: string): Promise<string> {
  await deliver();
  const message = sent.filter((item) => item.to === recipient).at(-1);
  const match = message?.text.match(
    /\/invitations\/accept#([A-Za-z0-9_-]{43})/,
  );
  if (!match) throw new Error(`No invitation email to ${recipient}`);
  return match[1];
}

const preview = (person: Person, credential: string) =>
  call(person, "POST", "/invitations/preview", {
    strong: false,
    body: { credential },
  });
const accept = (person: Person, credential: string) =>
  call(person, "POST", "/invitations/accept", {
    strong: false,
    body: { credential },
  });

async function auditActions(companyId: string) {
  const { rows } = await sql.query<{ action: string }>(
    "SELECT action FROM organization_audit_events WHERE company_id = $1 ORDER BY occurred_at, id",
    [companyId],
  );
  return rows.map((row) => row.action);
}

describe("company invitations", () => {
  it("invites by email, delivers the link and admits only the verified recipient once", async () => {
    const company = await createCompany("Invite Café");
    const created = await invite("owner", company, {
      email: "  INVITEE@Example.test ",
      role: "OPERATOR",
      scope: "COMPANY",
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      recipientEmail: "invitee@example.test",
      role: "OPERATOR",
      scope: "COMPANY",
      status: "PENDING",
      delivery: "PENDING",
      invitedByName: "Person owner",
    });
    const credential = await credentialFor("invitee@example.test");
    const email = sent
      .filter((item) => item.to === "invitee@example.test")
      .at(-1)!;
    expect(email.subject).toBe(
      "Convite para participar de “Invite Café” no Teluni",
    );
    expect(email.text).toContain("Person owner convidou você");
    expect(email.text).toContain("como operador");
    expect(email.text).toContain(
      `http://127.0.0.1:5173/invitations/accept#${credential}`,
    );
    expect(email.html).not.toContain("<script");
    const list = await call(
      "owner",
      "GET",
      `/companies/${company}/invitations`,
    );
    expect(list.body.items).toMatchObject([{ delivery: "SENT" }]);

    expect(code(await preview("other", credential))).toBe(
      "INVITATION_RECIPIENT_MISMATCH",
    );
    expect(code(await accept("other", credential))).toBe(
      "INVITATION_RECIPIENT_MISMATCH",
    );
    expect(await preview("invitee", credential)).toMatchObject({
      status: 200,
      body: {
        companyId: company,
        companyName: "Invite Café",
        role: "OPERATOR",
        status: "PENDING",
        invitedByName: "Person owner",
      },
    });
    const accepted = await accept("invitee", credential);
    expect(accepted.status).toBe(201);
    const replay = await accept("invitee", credential);
    expect(replay).toMatchObject({ status: 200, body: accepted.body });
    expect((await preview("invitee", credential)).body.status).toBe("ACCEPTED");
    expect(code(await accept("other", credential))).toBe(
      "INVITATION_NO_LONGER_VALID",
    );
    const view = await call("invitee", "GET", `/companies/${company}`, {
      strong: false,
    });
    expect(view.body.access).toMatchObject({ roles: ["OPERATOR"] });
    expect(code(await accept("invitee", "A".repeat(43)))).toBe(
      "RESOURCE_NOT_FOUND",
    );
    expect(await auditActions(company)).toEqual([
      "company.created",
      "invitation.created",
      "invitation.accepted",
    ]);
    const { rows } = await sql.query<{ hash: number; plaintext: boolean }>(
      "SELECT octet_length(credential_hash) AS hash, position($2 in encode(credential_hash, 'escape')) > 0 AS plaintext FROM company_invitations WHERE company_id = $1",
      [company, credential],
    );
    expect(rows).toEqual([{ hash: 32, plaintext: false }]);
  });

  it("limits who may invite whom and validates the grant request", async () => {
    const company = await createCompany("Invite scopes");
    const north = await createBranch(company, "Norte");
    const south = await createBranch(company, "Sul");
    const retired = await createBranch(company, "Antiga");
    await call(
      "owner",
      "POST",
      `/companies/${company}/branches/${retired}/archive`,
      {
        body: { expectedVersion: 1 },
      },
    );
    await member("admin", company, "COMPANY_ADMINISTRATOR");
    await member("manager", company, "BRANCH_MANAGER", [north]);
    await member("operator", company, "OPERATOR");
    const operatorIn = (branchIds: string[]) => ({
      email: `${randomUUID()}@example.test`,
      role: "OPERATOR",
      scope: "BRANCHES",
      branchIds,
    });
    expect((await invite("manager", company, operatorIn([north]))).status).toBe(
      201,
    );
    for (const [person, body, expected, options] of [
      ["manager", operatorIn([south]), "PERMISSION_DENIED", {}],
      [
        "manager",
        { ...operatorIn([north]), role: "BRANCH_MANAGER" },
        "PERMISSION_DENIED",
        {},
      ],
      [
        "manager",
        { email: "x@example.test", role: "OPERATOR", scope: "COMPANY" },
        "PERMISSION_DENIED",
        {},
      ],
      [
        "manager",
        operatorIn([north]),
        "STRONG_AUTHENTICATION_REQUIRED",
        { strong: false },
      ],
      ["operator", operatorIn([north]), "PERMISSION_DENIED", {}],
      ["outsider", operatorIn([north]), "RESOURCE_NOT_FOUND", {}],
      [
        "admin",
        {
          email: "a@example.test",
          role: "COMPANY_ADMINISTRATOR",
          scope: "COMPANY",
        },
        "RESPONSIBLE_APPROVAL_REQUIRED",
        {},
      ],
      [
        "owner",
        {
          email: "a@example.test",
          role: "COMPANY_ADMINISTRATOR",
          scope: "COMPANY",
        },
        "RECENT_AUTHENTICATION_REQUIRED",
        { age: 301 },
      ],
      [
        "owner",
        { email: "not-an-address", role: "OPERATOR", scope: "COMPANY" },
        "VALIDATION_FAILED",
        {},
      ],
      ["owner", operatorIn([retired]), "VALIDATION_FAILED", {}],
      ["owner", operatorIn([randomUUID()]), "VALIDATION_FAILED", {}],
      [
        "owner",
        {
          email: "b@example.test",
          role: "COMPANY_ADMINISTRATOR",
          scope: "BRANCHES",
          branchIds: [north],
        },
        "VALIDATION_FAILED",
        {},
      ],
      [
        "owner",
        {
          email: "c@example.test",
          role: "OPERATOR",
          scope: "COMPANY",
          grantExpiresAt: new Date(Date.now() - 1000).toISOString(),
        },
        "VALIDATION_FAILED",
        {},
      ],
    ] as const)
      expect(
        code(await invite(person, company, body, options)),
        JSON.stringify(body),
      ).toBe(expected);
    expect(
      (
        await invite("owner", company, {
          email: "new-admin@example.test",
          role: "COMPANY_ADMINISTRATOR",
          scope: "COMPANY",
        })
      ).status,
    ).toBe(201);
    expect(
      code(
        await invite("admin", company, {
          email: "NEW-ADMIN@example.test",
          role: "OPERATOR",
          scope: "COMPANY",
        }),
      ),
    ).toBe("INVITATION_PENDING");
    // Managers see only operator invitations within their branches.
    const managerList = await call(
      "manager",
      "GET",
      `/companies/${company}/invitations`,
    );
    expect(managerList.body.items).toHaveLength(1);
    // Their audit history likewise holds only the operations on their branch.
    const managerAudit = await call(
      "manager",
      "GET",
      `/companies/${company}/audit-events`,
    );
    expect(
      (managerAudit.body.items as { action: string; targetId: string }[]).map(
        (item) => [item.action, item.targetId],
      ),
    ).toEqual([
      [
        "invitation.created",
        (managerList.body.items as { id: string }[])[0].id,
      ],
      ["branch.created", north],
    ]);
    const ownerList = await call(
      "owner",
      "GET",
      `/companies/${company}/invitations?limit=1`,
    );
    expect(ownerList.body.items).toHaveLength(1);
    const next = await call(
      "owner",
      "GET",
      `/companies/${company}/invitations?limit=100&cursor=${ownerList.body.nextCursor as string}`,
    );
    expect(next.body.items).toHaveLength(1);
    expect(
      code(
        await call(
          "manager",
          "GET",
          `/companies/${company}/invitations?cursor=${ownerList.body.nextCursor as string}`,
        ),
      ),
    ).toBe("VALIDATION_FAILED");
    const adminInvitation = (ownerList.body.items as { id: string }[])[0].id;
    expect(
      code(
        await call(
          "manager",
          "POST",
          `/companies/${company}/invitations/${adminInvitation}/revoke`,
        ),
      ),
    ).toBe("RESOURCE_NOT_FOUND");
    expect(
      code(await call("operator", "GET", `/companies/${company}/invitations`)),
    ).toBe("PERMISSION_DENIED");
  });

  it("replaces on resend, cancels unsent mail and makes revoked or old links useless", async () => {
    const company = await createCompany("Invite lifecycle");
    const created = await invite("owner", company, {
      email: "lifecycle@example.test",
      role: "OPERATOR",
      scope: "COMPANY",
    });
    const firstId = created.body.id as string;
    const resent = await call(
      "owner",
      "POST",
      `/companies/${company}/invitations/${firstId}/resend`,
    );
    expect(resent.status).toBe(201);
    const { rows: messages } = await sql.query<{ status: string }>(
      "SELECT o.status::text AS status FROM outbound_emails o JOIN company_invitations i ON i.message_id = o.id WHERE i.id = $1",
      [firstId],
    );
    expect(messages).toEqual([{ status: "CANCELLED" }]);
    await deliver();
    const toRecipient = sent.filter(
      (item) => item.to === "lifecycle@example.test",
    );
    expect(toRecipient).toHaveLength(1);
    const credential = await credentialFor("lifecycle@example.test");
    expect(
      code(
        await call(
          "owner",
          "POST",
          `/companies/${company}/invitations/${firstId}/resend`,
        ),
      ),
    ).toBe("INVITATION_NO_LONGER_VALID");
    const secondId = resent.body.id as string;
    expect(
      (
        await call(
          "owner",
          "POST",
          `/companies/${company}/invitations/${secondId}/revoke`,
        )
      ).status,
    ).toBe(204);
    expect(
      (
        await call(
          "owner",
          "POST",
          `/companies/${company}/invitations/${secondId}/revoke`,
        )
      ).status,
    ).toBe(204);
    emails.invitee = "lifecycle@example.test";
    try {
      expect(code(await preview("invitee", credential))).toBe(
        "INVITATION_NO_LONGER_VALID",
      );
    } finally {
      delete emails.invitee;
    }
    const list = await call(
      "owner",
      "GET",
      `/companies/${company}/invitations`,
    );
    expect(
      (list.body.items as { status: string }[]).map((item) => item.status),
    ).toEqual(["REVOKED", "REPLACED"]);
    expect(await auditActions(company)).toEqual([
      "company.created",
      "invitation.created",
      "invitation.resent",
      "invitation.revoked",
    ]);
  });

  it("revalidates the inviter, branches and expiry at acceptance without narrowing", async () => {
    const company = await createCompany("Invite revalidation");
    const north = await createBranch(company, "Norte");
    const managerMembership = await member(
      "manager",
      company,
      "BRANCH_MANAGER",
      [north],
    );
    emails.invitee = "revalidate@example.test";
    try {
      await invite("manager", company, {
        email: "revalidate@example.test",
        role: "OPERATOR",
        scope: "BRANCHES",
        branchIds: [north],
      });
      const credential = await credentialFor("revalidate@example.test");
      await sql.query(
        "UPDATE memberships SET status = 'SUSPENDED' WHERE id = $1",
        [managerMembership],
      );
      expect(code(await accept("invitee", credential))).toBe(
        "INVITATION_NO_LONGER_VALID",
      );
      await sql.query(
        "UPDATE memberships SET status = 'ACTIVE' WHERE id = $1",
        [managerMembership],
      );
      await call(
        "owner",
        "POST",
        `/companies/${company}/branches/${north}/archive`,
        {
          body: { expectedVersion: 1 },
        },
      );
      expect(code(await accept("invitee", credential))).toBe(
        "INVITATION_NO_LONGER_VALID",
      );
      const { rows } = await sql.query(
        "SELECT 1 FROM memberships WHERE company_id = $1 AND principal_id = $2",
        [company, people.invitee],
      );
      expect(rows).toHaveLength(0);

      const fresh = await invite("owner", company, {
        email: "expiring@example.test",
        role: "OPERATOR",
        scope: "COMPANY",
      });
      await sql.query(
        "UPDATE company_invitations SET created_at = now() - interval '8 days', expires_at = now() - interval '1 day' WHERE id = $1",
        [fresh.body.id],
      );
      emails.invitee = "expiring@example.test";
      const expiredCredential = await credentialFor("expiring@example.test");
      expect(code(await accept("invitee", expiredCredential))).toBe(
        "INVITATION_NO_LONGER_VALID",
      );
      expect(
        (
          await invite("owner", company, {
            email: "expiring@example.test",
            role: "OPERATOR",
            scope: "COMPANY",
          })
        ).status,
      ).toBe(201);
      const { rows: statuses } = await sql.query<{ status: string }>(
        "SELECT status::text AS status FROM company_invitations WHERE id = $1",
        [fresh.body.id],
      );
      expect(statuses).toEqual([{ status: "EXPIRED" }]);
    } finally {
      delete emails.invitee;
    }
  });

  it("extends active members, refuses suspended ones and readmits removed people", async () => {
    const company = await createCompany("Invite memberships");
    const north = await createBranch(company, "Norte");
    await member("operator", company, "OPERATOR");
    await invite("owner", company, {
      email: "operator@example.test",
      role: "BRANCH_MANAGER",
      scope: "BRANCHES",
      branchIds: [north],
    });
    const extend = await accept(
      "operator",
      await credentialFor("operator@example.test"),
    );
    expect(extend.status).toBe(201);
    const roles = await call("operator", "GET", `/companies/${company}`, {
      strong: true,
    });
    expect(roles.body.access).toMatchObject({
      roles: ["BRANCH_MANAGER", "OPERATOR"],
    });

    const suspended = await member(
      "other",
      company,
      "OPERATOR",
      [],
      "SUSPENDED",
    );
    await invite("owner", company, {
      email: "other@example.test",
      role: "OPERATOR",
      scope: "COMPANY",
    });
    expect(
      code(await accept("other", await credentialFor("other@example.test"))),
    ).toBe("MEMBERSHIP_SUSPENDED");

    await sql.query("UPDATE memberships SET status = 'REMOVED' WHERE id = $1", [
      suspended,
    ]);
    const readmitted = await accept(
      "other",
      await credentialFor("other@example.test"),
    );
    expect(readmitted.status).toBe(201);
    expect(readmitted.body.membershipId).not.toBe(suspended);
    const { rows } = await sql.query<{ status: string }>(
      "SELECT status::text AS status FROM memberships WHERE company_id = $1 AND principal_id = $2 ORDER BY created_at",
      [company, people.other],
    );
    expect(rows.map((row) => row.status).sort()).toEqual(["ACTIVE", "REMOVED"]);
  });

  it("enforces abuse limits and keeps invitation and email atomic", async () => {
    const companies = await Promise.all(
      ["Limit A", "Limit B", "Limit C", "Limit D"].map(createCompany),
    );
    const target = `limited-${randomUUID()}@example.test`;
    for (const company of companies.slice(0, 3))
      expect(
        (
          await invite("owner", company, {
            email: target,
            role: "OPERATOR",
            scope: "COMPANY",
          })
        ).status,
      ).toBe(201);
    expect(
      code(
        await invite("owner", companies[3], {
          email: target,
          role: "OPERATOR",
          scope: "COMPANY",
        }),
      ),
    ).toBe("RATE_LIMITED");

    const busy = companies[3];
    const { rows } = await sql.query<{ id: string }>(
      "SELECT id FROM memberships WHERE company_id = $1",
      [busy],
    );
    await sql.query(
      `INSERT INTO company_invitations (id, company_id, recipient_email, credential_hash, role, scope,
         invited_by_membership_id, status, expires_at, decided_at)
       SELECT gen_random_uuid(), $1, 'bulk-' || n || '@example.test', sha256(convert_to(gen_random_uuid()::text, 'UTF8')),
         'OPERATOR', 'COMPANY', $2, 'REVOKED', now() + interval '7 days', now()
       FROM generate_series(1, 50) AS n`,
      [busy, rows[0].id],
    );
    expect(
      code(
        await invite("owner", busy, {
          email: "one-more@example.test",
          role: "OPERATOR",
          scope: "COMPANY",
        }),
      ),
    ).toBe("RATE_LIMITED");

    const atomic = await createCompany("Invite atomicity");
    await sql.query(
      "REVOKE INSERT ON organization_audit_events FROM orion_runtime",
    );
    try {
      const failed = await invite("owner", atomic, {
        email: "atomic@example.test",
        role: "OPERATOR",
        scope: "COMPANY",
      });
      expect(failed.status).toBe(500);
    } finally {
      await sql.query(
        "GRANT INSERT ON organization_audit_events TO orion_runtime",
      );
    }
    const { rows: leftovers } = await sql.query(
      "SELECT 1 FROM outbound_emails WHERE recipient = 'atomic@example.test' UNION ALL SELECT 1 FROM company_invitations WHERE recipient_email = 'atomic@example.test'",
    );
    expect(leftovers).toHaveLength(0);
  });

  it("erases final addresses after retention and keeps credentials immutable for the runtime role", async () => {
    const company = await createCompany("Invite retention");
    const created = await invite("owner", company, {
      email: "retained@example.test",
      role: "OPERATOR",
      scope: "COMPANY",
    });
    await call(
      "owner",
      "POST",
      `/companies/${company}/invitations/${created.body.id as string}/revoke`,
    );
    await sql.query(
      "UPDATE company_invitations SET decided_at = now() - interval '91 days', created_at = now() - interval '92 days', expires_at = now() - interval '85 days' WHERE id = $1",
      [created.body.id],
    );
    await mail.runOnce();
    const { rows } = await sql.query<{ recipient_email: string | null }>(
      "SELECT recipient_email FROM company_invitations WHERE id = $1",
      [created.body.id],
    );
    expect(rows).toEqual([{ recipient_email: null }]);
    await expect(
      database.$executeRaw`UPDATE company_invitations SET role = 'COMPANY_ADMINISTRATOR' WHERE company_id = ${company}::uuid`,
    ).rejects.toThrow(/permission denied/i);
    await expect(
      database.$executeRaw`UPDATE company_invitations SET credential_hash = '\\x00' WHERE company_id = ${company}::uuid`,
    ).rejects.toThrow(/permission denied/i);
  });
});
