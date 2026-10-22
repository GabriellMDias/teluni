import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../../src/database.js";
import { PrismaIdentityRepository } from "../../src/features/identity/prisma-repository.js";
import { withMigratedDatabase } from "../../scripts/migrated-database.js";

// Data handling policies: sessions and login attempts are deleted 30 days
// after they end, by the restricted runtime role.
let release: () => void;
let stopped: Promise<void>;
let admin: pg.Client;
let database: Database;

beforeAll(async () => {
  let ready!: () => void;
  const started = new Promise<void>((resolve) => (ready = resolve));
  stopped = withMigratedDatabase(async (runtimeUrl, migrationUrl) => {
    admin = new pg.Client({ connectionString: migrationUrl });
    await admin.connect();
    database = createDatabase(runtimeUrl);
    ready();
    await new Promise<void>((resolve) => (release = resolve));
    await database.$disconnect();
    await admin.end();
  });
  await Promise.race([started, stopped]);
}, 180_000);

afterAll(async () => {
  release?.();
  await stopped;
});

async function principal(): Promise<string> {
  const id = randomUUID();
  await admin.query(
    "INSERT INTO principals (id, issuer, subject) VALUES ($1::uuid, 'https://provider.example.test/realms/teluni', $2)",
    [id, id],
  );
  return id;
}

/** A session created `ageDays` ago that ended as the options say. */
async function session(
  principalId: string,
  ageDays: number,
  options: { revokedAfterHours?: number; idleSeconds?: number } = {},
): Promise<string> {
  const id = randomUUID();
  const revoked = options.revokedAfterHours !== undefined;
  await admin.query(
    `INSERT INTO human_sessions (id, principal_id, token_hash, state, assurance_level,
       authenticated_at, idle_timeout_seconds, created_at, last_activity_at,
       absolute_expires_at, provider_tokens, access_token_expires_at,
       revoked_at, revocation_reason)
     SELECT $1, $2, $3, $4, 'teluni-aal1', t, $5, t, t, t + interval '12 hours',
       '\\x00', t + interval '5 minutes',
       CASE WHEN $6::double precision IS NULL THEN NULL
         ELSE t + $6::double precision * interval '1 hour' END,
       CASE WHEN $6::double precision IS NULL THEN NULL ELSE 'LOGOUT' END
     FROM (SELECT now() - $7::double precision * interval '1 day' AS t) AS created`,
    [
      id,
      principalId,
      randomBytes(32),
      revoked ? "REVOKED" : "ACTIVE",
      options.idleSeconds ?? 7200,
      options.revokedAfterHours ?? null,
      ageDays,
    ],
  );
  return id;
}

async function attempt(ageDays: number): Promise<string> {
  const id = randomUUID();
  await admin.query(
    `INSERT INTO oidc_login_attempts (id, handle_hash, state, secrets, return_to,
       created_at, expires_at)
     SELECT $1, $2, 'state', '\\x00', '/', t, t + interval '10 minutes'
     FROM (SELECT now() - $3::double precision * interval '1 day' AS t) AS created`,
    [id, randomBytes(32), ageDays],
  );
  return id;
}

async function remaining(table: string, ids: string[]): Promise<string[]> {
  const result = await admin.query<{ id: string }>(
    `SELECT id FROM ${table} WHERE id = ANY($1::uuid[]) ORDER BY id`,
    [ids],
  );
  return result.rows.map((row) => row.id);
}

describe("identity retention", () => {
  it("deletes sessions and attempts 30 days after they end, and keeps the rest", async () => {
    const owner = await principal();
    const oldIdle = await session(owner, 40);
    const oldRevoked = await session(owner, 31, { revokedAfterHours: 1 });
    const recentRevoked = await session(owner, 29, { revokedAfterHours: 1 });
    // Created 31 days ago but idle out a minute later: ended over 30 days ago.
    const shortIdle = await session(owner, 31, { idleSeconds: 60 });
    // Created 30 days and about an hour ago, idle out two hours later: ended
    // just under 30 days ago, so it stays.
    const nearBoundary = await session(owner, 30.05);
    const current = await session(owner, 0);
    const oldAttempt = await attempt(31);
    const recentAttempt = await attempt(1);

    const purged = await new PrismaIdentityRepository(database).purgeEnded();

    expect(purged).toEqual({ attempts: 1, sessions: 3 });
    expect(
      await remaining("human_sessions", [
        oldIdle,
        oldRevoked,
        recentRevoked,
        shortIdle,
        nearBoundary,
        current,
      ]),
    ).toEqual([recentRevoked, nearBoundary, current].sort());
    expect(
      await remaining("oidc_login_attempts", [oldAttempt, recentAttempt]),
    ).toEqual([recentAttempt]);
    // The principal stays; deleting sessions never cascades to people.
    expect(await remaining("principals", [owner])).toEqual([owner]);
  });
});
