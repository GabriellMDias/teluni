import { createHash, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createDatabase, type Database } from "../../src/database.js";
import { createDevicesModule } from "../../src/features/devices/module.js";
import type { HumanSessionPort } from "../../src/features/identity/public.js";
import { createOrganizationsModule } from "../../src/features/organizations/module.js";
import { activateModules, type ApiModule } from "../../src/module.js";
import { withMigratedDatabase } from "../../scripts/migrated-database.js";

// Two-company suite of the device enrollment and lifecycle design. A
// synthetic session port stands in for the identity module so tests choose
// the verified principal and assurance; simulated players use the real
// device routes with their own credentials.
type App = ReturnType<typeof createApp>["app"];
let app: App;
let sql: pg.Client;
let database: Database;
let release: () => void;
let stopped: Promise<void>;

const people = {
  aAdmin: randomUUID(),
  aManager: randomUUID(),
  aOperator: randomUUID(),
  bAdmin: randomUUID(),
  guesser: randomUUID(),
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
    const devices = createDevicesModule({
      sessions,
      companies: organizations.companies,
      limits: {
        requests: { max: 10_000, timeWindow: 60_000 },
        enrollmentStarts: { max: 10_000, timeWindow: 60_000 },
      },
    });
    const modules = activateModules(
      [identityStub, organizations.module, devices],
      {
        database,
        deviceEnrollment: {
          codeKeys: [
            { id: "current", key: randomBytes(32) },
            { id: "previous", key: randomBytes(32) },
          ],
        },
      },
      "test",
    );
    expect(modules.map((module) => module.name)).toContain("devices");
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

type Result = {
  status: number;
  headers: Record<string, unknown>;
  // Tests read `id` only from successful device and enrollment answers.
  body: Record<string, unknown> & { id: string; error?: { code: string } };
};

async function call(
  person: Person | null,
  method: "GET" | "POST" | "PATCH" | "PUT",
  url: string,
  options: {
    body?: unknown;
    strong?: boolean;
    credential?: string;
  } = {},
): Promise<Result> {
  const response = await app.inject({
    method,
    url,
    headers: {
      ...(person
        ? {
            "x-test-principal": people[person],
            "x-test-strong": String(options.strong ?? false),
          }
        : {}),
      ...(options.credential
        ? { authorization: `Bearer ${options.credential}` }
        : {}),
    },
    ...(options.body === undefined ? {} : { payload: options.body as object }),
  });
  return {
    status: response.statusCode,
    headers: response.headers,
    body:
      response.statusCode === 204
        ? ({} as Result["body"])
        : response.json<Result["body"]>(),
  };
}

const code = (result: Result) => result.body.error?.code;

const report = (rotations: number[] = [0, 90, 180, 270]) => ({
  appVersion: "1.0.0",
  protocolVersion: 1,
  manufacturer: "Test",
  model: "TV 1",
  osVersion: "12",
  display: { width: 1920, height: 1080 },
  rotations,
});

/** A simulated player: its own credential and the hash it registers. */
function player() {
  const bytes = randomBytes(32);
  return {
    credential: bytes.toString("base64url"),
    hash: createHash("sha256").update(bytes).digest("base64url"),
  };
}

async function enroll(rotations?: number[]) {
  const screen = player();
  const started = await call(null, "POST", "/device-enrollments", {
    body: { credentialHash: screen.hash, report: report(rotations) },
  });
  expect(started.status).toBe(201);
  return {
    ...screen,
    enrollmentId: started.body.enrollmentId as string,
    userCode: started.body.userCode as string,
  };
}

async function pair(
  person: Person,
  companyId: string,
  branchId: string,
  userCode: string,
  overrides: Record<string, unknown> = {},
) {
  return call(person, "POST", `/companies/${companyId}/devices`, {
    strong: true,
    body: { userCode, name: "Caixa 1", branchId, rotation: 0, ...overrides },
  });
}

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

/** Lets the next poll through without waiting for the polling interval. */
async function allowPoll(enrollmentId: string) {
  await sql.query(
    "UPDATE device_enrollments SET last_polled_at = now() - interval '1 minute' WHERE id = $1",
    [enrollmentId],
  );
}

describe("devices: enrollment, scope and lifecycle", () => {
  let companyA: string;
  let companyB: string;
  let a1: { id: string; version: number };
  let a2: { id: string; version: number };
  let b1: { id: string; version: number };

  beforeAll(async () => {
    companyA = await createCompany("aAdmin", "Lanchonete A");
    companyB = await createCompany("bAdmin", "Clínica B");
    a1 = await createBranch("aAdmin", companyA, "Centro");
    a2 = await createBranch("aAdmin", companyA, "Bairro");
    b1 = await createBranch("bAdmin", companyB, "Matriz");
    await grantBranches("aManager", companyA, "BRANCH_MANAGER", [a1.id]);
    await grantBranches("aOperator", companyA, "OPERATOR", [a1.id]);
  }, 60_000);

  it("starts an enrollment with a displayable code and never reuses a credential", async () => {
    const screen = player();
    const started = await call(null, "POST", "/device-enrollments", {
      body: { credentialHash: screen.hash, report: report() },
    });
    expect(started.status).toBe(201);
    expect(started.body.userCode).toMatch(
      /^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/,
    );
    expect(started.body.pollIntervalSeconds).toBe(5);
    const expiresIn =
      new Date(started.body.expiresAt as string).getTime() - Date.now();
    expect(expiresIn).toBeGreaterThan(9 * 60_000);
    expect(expiresIn).toBeLessThanOrEqual(10 * 60_000 + 5_000);
    const again = await call(null, "POST", "/device-enrollments", {
      body: { credentialHash: screen.hash, report: report() },
    });
    expect(code(again)).toBe("ENROLLMENT_REJECTED");
    const invalid = await call(null, "POST", "/device-enrollments", {
      body: { credentialHash: player().hash, report: report([0, 0]) },
    });
    expect(code(invalid)).toBe("VALIDATION_FAILED");
    const { rows } = await sql.query<{ code_hmac: Buffer }>(
      "SELECT code_hmac FROM device_enrollments WHERE id = $1",
      [started.body.enrollmentId],
    );
    // Only the keyed HMAC is stored, never the code.
    expect(rows[0].code_hmac).toHaveLength(32);
    expect(rows[0].code_hmac.toString("utf8")).not.toContain(
      (started.body.userCode as string).replace("-", ""),
    );
  });

  it("pairs a screen once and lets the player learn its identity by polling", async () => {
    const screen = await enroll();
    const wrong = await call(
      null,
      "POST",
      `/device-enrollments/${screen.enrollmentId}/status`,
      { credential: player().credential },
    );
    expect(code(wrong)).toBe("DEVICE_UNAUTHORIZED");
    const pending = await call(
      null,
      "POST",
      `/device-enrollments/${screen.enrollmentId}/status`,
      { credential: screen.credential },
    );
    expect(pending.body).toMatchObject({ status: "pending", deviceId: null });
    const tooFast = await call(
      null,
      "POST",
      `/device-enrollments/${screen.enrollmentId}/status`,
      { credential: screen.credential },
    );
    expect(code(tooFast)).toBe("RATE_LIMITED");
    expect(tooFast.headers["retry-after"]).toBe("5");

    // Entry ignores case, spaces and hyphens.
    const typed = ` ${screen.userCode.toLowerCase().replace("-", " ")} `;
    const paired = await pair("aAdmin", companyA, a1.id, typed, {
      name: "  Caixa 1  ",
      rotation: 90,
    });
    expect(paired.status).toBe(201);
    expect(paired.body).toMatchObject({
      name: "Caixa 1",
      branch: { id: a1.id, name: "Centro" },
      rotation: 90,
      status: "ACTIVE",
      erasure: "NONE",
      version: 1,
      report: { model: "TV 1", rotations: [0, 90, 180, 270] },
    });
    await allowPoll(screen.enrollmentId);
    const learned = await call(
      null,
      "POST",
      `/device-enrollments/${screen.enrollmentId}/status`,
      { credential: screen.credential },
    );
    expect(learned.body).toMatchObject({
      status: "paired",
      deviceId: paired.body.id,
    });
    const replay = await pair("aAdmin", companyA, a1.id, screen.userCode);
    expect(code(replay)).toBe("PAIRING_CODE_INVALID");
    const { rows } = await sql.query<{ action: string; details: object }>(
      "SELECT action, details FROM device_audit_events WHERE device_id = $1",
      [paired.body.id],
    );
    expect(rows).toEqual([
      { action: "device.paired", details: { branchId: a1.id, rotation: 90 } },
    ]);
  });

  it("answers expired, unknown and malformed codes alike and limits failed claims", async () => {
    const expired = await enroll();
    await sql.query(
      "UPDATE device_enrollments SET created_at = now() - interval '1 hour', expires_at = now() - interval '1 second' WHERE id = $1",
      [expired.enrollmentId],
    );
    for (const userCode of [expired.userCode, "BBBB-BBBB", "not a code"]) {
      const result = await pair("guesser", companyA, a1.id, userCode).catch(
        () => undefined,
      );
      // The guesser is not a member: no claim reaches the code at all.
      expect(code(result!)).toBe("RESOURCE_NOT_FOUND");
    }
    for (const userCode of [expired.userCode, "BBBB-BBBB", "not a code"])
      expect(code(await pair("aAdmin", companyA, a1.id, userCode))).toBe(
        "PAIRING_CODE_INVALID",
      );
    await allowPoll(expired.enrollmentId);
    const polled = await call(
      null,
      "POST",
      `/device-enrollments/${expired.enrollmentId}/status`,
      { credential: expired.credential },
    );
    expect(polled.body.status).toBe("expired");

    // Ten failures per person in 15 minutes, then RATE_LIMITED.
    const companyC = await createCompany("guesser", "Guesser C");
    const c1 = await createBranch("guesser", companyC, "Única");
    for (let attempt = 0; attempt < 10; attempt += 1)
      expect(code(await pair("guesser", companyC, c1.id, "BBBB-BBBB"))).toBe(
        "PAIRING_CODE_INVALID",
      );
    const valid = await enroll();
    const limited = await pair("guesser", companyC, c1.id, valid.userCode);
    expect(code(limited)).toBe("RATE_LIMITED");
    const { rows } = await sql.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM device_claim_failures WHERE principal_id = $1",
      [people.guesser],
    );
    expect(rows[0].count).toBe(10);
  });

  it("lets exactly one of two concurrent claims of a code succeed", async () => {
    const screen = await enroll();
    const results = await Promise.all([
      pair("aAdmin", companyA, a1.id, screen.userCode, { name: "Um" }),
      pair("aAdmin", companyA, a2.id, screen.userCode, { name: "Dois" }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(results.map(code).filter(Boolean)).toEqual(["PAIRING_CODE_INVALID"]);
    const { rows } = await sql.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM devices WHERE enrollment_id = $1",
      [screen.enrollmentId],
    );
    expect(rows[0].count).toBe(1);
  });

  it("enforces scope, assurance and destination checks when pairing", async () => {
    const screen = await enroll([0, 180]);
    expect(
      code(
        await call("aManager", "POST", `/companies/${companyA}/devices`, {
          strong: false,
          body: {
            userCode: screen.userCode,
            name: "X",
            branchId: a1.id,
            rotation: 0,
          },
        }),
      ),
    ).toBe("STRONG_AUTHENTICATION_REQUIRED");
    expect(code(await pair("aManager", companyA, a2.id, screen.userCode))).toBe(
      "PERMISSION_DENIED",
    );
    expect(
      code(await pair("aOperator", companyA, a1.id, screen.userCode)),
    ).toBe("PERMISSION_DENIED");
    expect(code(await pair("bAdmin", companyA, a1.id, screen.userCode))).toBe(
      "RESOURCE_NOT_FOUND",
    );
    // Another company's branch is rejected like an unknown one.
    expect(code(await pair("aAdmin", companyA, b1.id, screen.userCode))).toBe(
      "VALIDATION_FAILED",
    );
    expect(
      code(
        await pair("aManager", companyA, a1.id, screen.userCode, {
          rotation: 90,
        }),
      ),
    ).toBe("ROTATION_UNSUPPORTED");
    const paired = await pair("aManager", companyA, a1.id, screen.userCode, {
      rotation: 180,
    });
    expect(paired.status).toBe(201);
  });

  it("shows devices only within the caller's branches and binds cursors", async () => {
    const inA2 = await enroll();
    const hidden = await pair("aAdmin", companyA, a2.id, inA2.userCode, {
      name: "Bairro TV",
    });
    expect(hidden.status).toBe(201);
    const operatorList = await call(
      "aOperator",
      "GET",
      `/companies/${companyA}/devices`,
    );
    expect(operatorList.status).toBe(200);
    const operatorItems = operatorList.body.items as {
      branch: { id: string };
    }[];
    expect(operatorItems.length).toBeGreaterThan(0);
    expect(operatorItems.every((item) => item.branch.id === a1.id)).toBe(true);
    expect(
      code(
        await call(
          "aOperator",
          "GET",
          `/companies/${companyA}/devices/${hidden.body.id}`,
        ),
      ),
    ).toBe("RESOURCE_NOT_FOUND");
    expect(
      code(
        await call(
          "bAdmin",
          "GET",
          `/companies/${companyB}/devices/${hidden.body.id}`,
          { strong: true },
        ),
      ),
    ).toBe("RESOURCE_NOT_FOUND");
    expect(
      code(
        await call("bAdmin", "GET", `/companies/${companyA}/devices`, {
          strong: true,
        }),
      ),
    ).toBe("RESOURCE_NOT_FOUND");

    const first = await call(
      "aAdmin",
      "GET",
      `/companies/${companyA}/devices?limit=1`,
      { strong: true },
    );
    expect(first.body.items).toHaveLength(1);
    const cursor = first.body.nextCursor as string;
    expect(cursor).toBeTruthy();
    const second = await call(
      "aAdmin",
      "GET",
      `/companies/${companyA}/devices?limit=1&cursor=${cursor}`,
      { strong: true },
    );
    expect(second.status).toBe(200);
    expect((second.body.items as { id: string }[])[0].id).not.toBe(
      (first.body.items as { id: string }[])[0].id,
    );
    const foreign = await call(
      "aOperator",
      "GET",
      `/companies/${companyA}/devices?limit=1&cursor=${cursor}`,
    );
    expect(code(foreign)).toBe("VALIDATION_FAILED");
    const filtered = await call(
      "aAdmin",
      "GET",
      `/companies/${companyA}/devices?branchId=${a2.id}`,
      { strong: true },
    );
    expect(
      (filtered.body.items as { branch: { id: string } }[]).every(
        (item) => item.branch.id === a2.id,
      ),
    ).toBe(true);
  });

  it("configures and moves devices with versions and scope on both branches", async () => {
    const screen = await enroll([0, 90]);
    const paired = await pair("aManager", companyA, a1.id, screen.userCode);
    const id = paired.body.id;
    const url = `/companies/${companyA}/devices/${id}`;
    const renamed = await call("aManager", "PATCH", url, {
      strong: true,
      body: { expectedVersion: 1, name: "Vitrine", rotation: 90 },
    });
    expect(renamed.body).toMatchObject({
      name: "Vitrine",
      rotation: 90,
      version: 2,
    });
    expect(
      code(
        await call("aManager", "PATCH", url, {
          strong: true,
          body: { expectedVersion: 1, name: "Outro" },
        }),
      ),
    ).toBe("RESOURCE_VERSION_CONFLICT");
    expect(
      code(
        await call("aManager", "PATCH", url, {
          strong: true,
          body: { expectedVersion: 2, rotation: 270 },
        }),
      ),
    ).toBe("ROTATION_UNSUPPORTED");
    expect(
      code(
        await call("aOperator", "PATCH", url, {
          body: { expectedVersion: 2, name: "Operador" },
        }),
      ),
    ).toBe("PERMISSION_DENIED");
    expect(
      code(
        await call("aManager", "POST", `${url}/move`, {
          strong: true,
          body: { expectedVersion: 2, branchId: a2.id },
        }),
      ),
    ).toBe("PERMISSION_DENIED");
    const moved = await call("aAdmin", "POST", `${url}/move`, {
      strong: true,
      body: { expectedVersion: 2, branchId: a2.id },
    });
    expect(moved.body).toMatchObject({
      branch: { id: a2.id, name: "Bairro" },
      version: 3,
    });
    // The device left the manager's branches, so it is hidden from them now.
    expect(
      code(
        await call("aManager", "PATCH", url, {
          strong: true,
          body: { expectedVersion: 3, name: "Volta" },
        }),
      ),
    ).toBe("RESOURCE_NOT_FOUND");
    const { rows } = await sql.query<{ action: string }>(
      "SELECT action FROM device_audit_events WHERE device_id = $1 ORDER BY occurred_at, action",
      [id],
    );
    expect(rows.map((row) => row.action).sort()).toEqual([
      "device.moved",
      "device.paired",
      "device.renamed",
      "device.rotation_changed",
    ]);
  });

  it("checks in, reports and rotates credentials with overlap", async () => {
    const screen = await enroll();
    const paired = await pair("aAdmin", companyA, a1.id, screen.userCode);
    const self = await call(null, "GET", "/device/self", {
      credential: screen.credential,
    });
    expect(self.body).toMatchObject({
      id: paired.body.id,
      status: "active",
      clearRequired: false,
      name: "Caixa 1",
      branch: { id: a1.id, name: "Centro", timeZone: "America/Sao_Paulo" },
      rotation: 0,
    });
    const lease =
      new Date(self.body.authorizedUntil as string).getTime() -
      new Date(self.body.serverTime as string).getTime();
    expect(lease).toBe(7 * 24 * 60 * 60 * 1000);
    expect(self.headers["cache-control"]).toBe("no-store");
    const { rows: seen } = await sql.query<{ last_seen_at: Date | null }>(
      "SELECT last_seen_at FROM devices WHERE id = $1",
      [paired.body.id],
    );
    expect(seen[0].last_seen_at).not.toBeNull();

    expect(
      (
        await call(null, "PUT", "/device/self/report", {
          credential: screen.credential,
          body: { ...report([0]), appVersion: "1.1.0" },
        })
      ).status,
    ).toBe(204);
    expect(
      code(await call(null, "GET", "/device/self", { credential: "x" })),
    ).toBe("DEVICE_UNAUTHORIZED");
    expect(code(await call("aAdmin", "GET", "/device/self"))).toBe(
      "DEVICE_UNAUTHORIZED",
    );

    const next = player();
    const rotate = () =>
      call(null, "POST", "/device/self/credential", {
        credential: screen.credential,
        body: { credentialHash: next.hash },
      });
    expect((await rotate()).status).toBe(204);
    expect((await rotate()).status).toBe(204);
    // Both credentials work until the new one is used.
    expect(
      (
        await call(null, "GET", "/device/self", {
          credential: screen.credential,
        })
      ).status,
    ).toBe(200);
    expect(
      (await call(null, "GET", "/device/self", { credential: next.credential }))
        .status,
    ).toBe(200);
    expect(
      code(
        await call(null, "GET", "/device/self", {
          credential: screen.credential,
        }),
      ),
    ).toBe("DEVICE_UNAUTHORIZED");
    const taken = await call(null, "POST", "/device/self/credential", {
      credential: next.credential,
      body: { credentialHash: (await enroll()).hash },
    });
    expect(code(taken)).toBe("ENROLLMENT_REJECTED");
  });

  it("unlinks irreversibly, keeps erasure pending and confirms it from the device", async () => {
    const screen = await enroll();
    const paired = await pair("aAdmin", companyA, a1.id, screen.userCode);
    const url = `/companies/${companyA}/devices/${paired.body.id}`;
    expect(
      code(
        await call("aAdmin", "POST", `${url}/reset-record`, {
          strong: true,
          body: { expectedVersion: 1 },
        }),
      ),
    ).toBe("DEVICE_ERASURE_NOT_PENDING");
    const unlinked = await call("aAdmin", "POST", `${url}/unlink`, {
      strong: true,
      body: { expectedVersion: 1 },
    });
    expect(unlinked.body).toMatchObject({
      status: "REVOKED",
      erasure: "PENDING",
      version: 2,
    });
    expect(
      code(
        await call("aAdmin", "PATCH", url, {
          strong: true,
          body: { expectedVersion: 2, name: "Depois" },
        }),
      ),
    ).toBe("DEVICE_UNLINKED");
    const self = await call(null, "GET", "/device/self", {
      credential: screen.credential,
    });
    expect(self.body).toMatchObject({
      status: "unlinked",
      clearRequired: true,
      name: null,
      branch: null,
      authorizedUntil: null,
    });
    expect(
      code(
        await call(null, "PUT", "/device/self/report", {
          credential: screen.credential,
          body: report(),
        }),
      ),
    ).toBe("DEVICE_UNAUTHORIZED");
    expect(
      code(
        await call(null, "POST", "/device/self/credential", {
          credential: screen.credential,
          body: { credentialHash: player().hash },
        }),
      ),
    ).toBe("DEVICE_UNAUTHORIZED");
    expect(
      (
        await call(null, "POST", "/device/self/erasure", {
          credential: screen.credential,
        })
      ).status,
    ).toBe(204);
    expect(
      code(
        await call(null, "POST", "/device/self/erasure", {
          credential: screen.credential,
        }),
      ),
    ).toBe("DEVICE_UNAUTHORIZED");
    const after = await call("aAdmin", "GET", url, { strong: true });
    expect(after.body).toMatchObject({ erasure: "CONFIRMED" });
    const { rows } = await sql.query<{
      credential_hash: Buffer | null;
      actions: string[];
    }>(
      `SELECT d.credential_hash, array_agg(e.action ORDER BY e.occurred_at) AS actions
       FROM devices d JOIN device_audit_events e ON e.device_id = d.id
       WHERE d.id = $1 GROUP BY d.credential_hash`,
      [paired.body.id],
    );
    expect(rows[0].credential_hash).toBeNull();
    expect(rows[0].actions).toEqual([
      "device.paired",
      "device.unlinked",
      "device.erasure_confirmed",
    ]);
  });

  it("records a controlled reset distinctly and still accepts a later confirmation", async () => {
    const screen = await enroll();
    const paired = await pair("aAdmin", companyA, a1.id, screen.userCode);
    const url = `/companies/${companyA}/devices/${paired.body.id}`;
    await call("aAdmin", "POST", `${url}/unlink`, {
      strong: true,
      body: { expectedVersion: 1 },
    });
    const reset = await call("aAdmin", "POST", `${url}/reset-record`, {
      strong: true,
      body: { expectedVersion: 2 },
    });
    expect(reset.body).toMatchObject({ erasure: "RESET_RECORDED", version: 3 });
    expect(reset.body.erasureRecordedAt).toBeTruthy();
    expect(
      (
        await call(null, "POST", "/device/self/erasure", {
          credential: screen.credential,
        })
      ).status,
    ).toBe(204);
  });

  it("refuses to archive a branch while it has active screens", async () => {
    const branch = await createBranch("aAdmin", companyA, "Temporária");
    const screen = await enroll();
    const paired = await pair("aAdmin", companyA, branch.id, screen.userCode);
    const archive = (version: number) =>
      call(
        "aAdmin",
        "POST",
        `/companies/${companyA}/branches/${branch.id}/archive`,
        {
          strong: true,
          body: { expectedVersion: version },
        },
      );
    expect(code(await archive(branch.version))).toBe("BRANCH_IN_USE");
    await call(
      "aAdmin",
      "POST",
      `/companies/${companyA}/devices/${paired.body.id}/unlink`,
      { strong: true, body: { expectedVersion: 1 } },
    );
    expect((await archive(branch.version)).status).toBe(200);
    const late = await enroll();
    expect(code(await pair("aAdmin", companyA, branch.id, late.userCode))).toBe(
      "VALIDATION_FAILED",
    );
  });

  it("stops renewing authorization for a suspended company", async () => {
    const screen = await enroll();
    await pair("bAdmin", companyB, b1.id, screen.userCode);
    await sql.query("UPDATE companies SET status = 'SUSPENDED' WHERE id = $1", [
      companyB,
    ]);
    try {
      const self = await call(null, "GET", "/device/self", {
        credential: screen.credential,
      });
      expect(self.body).toMatchObject({
        status: "suspended",
        authorizedUntil: null,
      });
      const another = await enroll();
      expect(
        code(await pair("bAdmin", companyB, b1.id, another.userCode)),
      ).toBe("COMPANY_SUSPENDED");
    } finally {
      await sql.query("UPDATE companies SET status = 'ACTIVE' WHERE id = $1", [
        companyB,
      ]);
    }
  });

  it("keeps codes, hashes and addresses out of audit details", async () => {
    const { rows } = await sql.query<{ details: string }>(
      "SELECT details::text AS details FROM device_audit_events",
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const { details } of rows)
      expect(details).not.toMatch(
        /credential|code|hash|address|[A-Za-z0-9_-]{43}/i,
      );
  });
});
