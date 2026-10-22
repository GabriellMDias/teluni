import type { Database } from "../../database.js";
import { Prisma } from "../../generated/prisma/client.js";
import type { HumanProfile } from "./public.js";
import {
  sessionPolicy,
  type RevocationReason,
  type SessionState,
} from "./domain.js";

export type StoredLoginAttempt = Readonly<{
  id: string;
  state: string;
  secrets: Uint8Array;
  returnTo: string;
  requestedAssurance: string | null;
  maxAgeSeconds: number | null;
}>;

export type StoredSession = Readonly<{
  id: string;
  principalId: string;
  principalActive: boolean;
  subject: string;
  issuer: string;
  state: SessionState;
  providerSessionId: string | null;
  assuranceLevel: string;
  authenticatedAt: Date;
  strongAuthenticatedAt: Date | null;
  strongAuthenticationAgeSeconds: number | null;
  providerTokens: Uint8Array;
  createdAt: Date;
  lastActivityAt: Date;
  expiresAt: Date;
  /** Evaluated with the database clock. */
  expired: boolean;
  refreshDue: boolean;
  recheckDue: boolean;
  activityDue: boolean;
}>;

export type NewSession = Readonly<{
  id: string;
  principalId: string;
  tokenHash: Buffer;
  providerSessionId: string | null;
  assuranceLevel: string;
  authenticatedAt: Date;
  strongAuthenticatedAt: Date | null;
  idleTimeoutSeconds: number;
  providerTokens: Buffer;
  accessTokenLifetimeSeconds: number;
  profile: { displayName: string | null; email: string | null };
}>;

type SessionRow = {
  id: string;
  principal_id: string;
  principal_status: string;
  subject: string;
  issuer: string;
  state: SessionState;
  provider_session_id: string | null;
  assurance_level: string;
  authenticated_at: Date;
  strong_authenticated_at: Date | null;
  strong_age_seconds: number | null;
  provider_tokens: Uint8Array;
  created_at: Date;
  last_activity_at: Date;
  expires_at: Date;
  expired: boolean;
  refresh_due: boolean;
  recheck_due: boolean;
  activity_due: boolean;
};

function session(row: SessionRow): StoredSession {
  return {
    id: row.id,
    principalId: row.principal_id,
    principalActive: row.principal_status === "ACTIVE",
    subject: row.subject,
    issuer: row.issuer,
    state: row.state,
    providerSessionId: row.provider_session_id,
    assuranceLevel: row.assurance_level,
    authenticatedAt: row.authenticated_at,
    strongAuthenticatedAt: row.strong_authenticated_at,
    strongAuthenticationAgeSeconds:
      row.strong_age_seconds === null ? null : Number(row.strong_age_seconds),
    providerTokens: row.provider_tokens,
    createdAt: row.created_at,
    lastActivityAt: row.last_activity_at,
    expiresAt: row.expires_at,
    expired: row.expired,
    refreshDue: row.refresh_due,
    recheckDue: row.recheck_due,
    activityDue: row.activity_due,
  };
}

/** PostgreSQL persistence for principals, sessions and login attempts. */
export class PrismaIdentityRepository {
  readonly #db: Database;

  constructor(database: Database) {
    this.#db = database;
  }

  async createLoginAttempt(input: {
    id: string;
    handleHash: Buffer;
    state: string;
    secrets: Buffer;
    returnTo: string;
    requestedAssurance: string | null;
    maxAgeSeconds: number | null;
  }): Promise<void> {
    await this.#db.$executeRaw`
      INSERT INTO oidc_login_attempts (id, handle_hash, state, secrets, return_to,
        requested_assurance, max_age_seconds, expires_at)
      VALUES (${input.id}::uuid, ${input.handleHash}, ${input.state}, ${input.secrets},
        ${input.returnTo}, ${input.requestedAssurance}, ${input.maxAgeSeconds}::integer,
        now() + make_interval(secs => ${sessionPolicy.loginAttemptSeconds}::double precision))`;
  }

  /**
   * Deletes a bounded batch of login attempts and sessions that ended more
   * than the retention period ago. A session ends at revocation, its
   * absolute expiry or its idle timeout, whichever comes first.
   */
  async purgeEnded(): Promise<{ attempts: number; sessions: number }> {
    const { endedRetentionDays: days, purgeBatchSize: batch } = sessionPolicy;
    const attempts = await this.#db.$executeRaw`
      DELETE FROM oidc_login_attempts WHERE id IN (
        SELECT id FROM oidc_login_attempts
        WHERE expires_at <= now() - make_interval(days => ${days}::integer)
        LIMIT ${batch}::integer)`;
    const sessions = await this.#db.$executeRaw`
      DELETE FROM human_sessions WHERE id IN (
        SELECT id FROM human_sessions
        WHERE LEAST(COALESCE(revoked_at, 'infinity'::timestamptz), absolute_expires_at,
            last_activity_at + make_interval(secs => idle_timeout_seconds))
          <= now() - make_interval(days => ${days}::integer)
        LIMIT ${batch}::integer)`;
    return { attempts, sessions };
  }

  /** Consumes an unexpired attempt exactly once; a replay returns null. */
  async consumeLoginAttempt(
    handleHash: Buffer,
    state: string,
  ): Promise<StoredLoginAttempt | null> {
    const rows = await this.#db.$queryRaw<
      {
        id: string;
        state: string;
        secrets: Uint8Array;
        return_to: string;
        requested_assurance: string | null;
        max_age_seconds: number | null;
      }[]
    >`
      UPDATE oidc_login_attempts SET consumed_at = now()
      WHERE handle_hash = ${handleHash} AND state = ${state}
        AND consumed_at IS NULL AND expires_at > now()
      RETURNING id, state, secrets, return_to, requested_assurance, max_age_seconds`;
    const row = rows[0];
    return row
      ? {
          id: row.id,
          state: row.state,
          secrets: row.secrets,
          returnTo: row.return_to,
          requestedAssurance: row.requested_assurance,
          maxAgeSeconds: row.max_age_seconds,
        }
      : null;
  }

  /** Returns the principal for a provider identity, creating it with `candidateId` once. */
  async findOrCreatePrincipal(
    issuer: string,
    subject: string,
    candidateId: string,
  ): Promise<{ id: string; active: boolean }> {
    await this.#db.$executeRaw`
      INSERT INTO principals (id, issuer, subject) VALUES (${candidateId}::uuid, ${issuer}, ${subject})
      ON CONFLICT (issuer, subject) DO NOTHING`;
    const rows = await this.#db.$queryRaw<{ id: string; status: string }[]>`
      SELECT id, status::text FROM principals WHERE issuer = ${issuer} AND subject = ${subject}`;
    const row = rows[0];
    if (!row) throw new Error("Principal provisioning did not converge");
    return { id: row.id, active: row.status === "ACTIVE" };
  }

  /**
   * Creates a session, ACTIVE unless the principal already has the maximum
   * number of active sessions. The principal row lock serializes concurrent logins.
   */
  async createSession(input: NewSession): Promise<SessionState> {
    return this.#db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM principals WHERE id = ${input.principalId}::uuid FOR UPDATE`;
      await tx.$executeRaw`UPDATE principals
        SET display_name = ${input.profile.displayName}, verified_email = ${input.profile.email}
        WHERE id = ${input.principalId}::uuid`;
      const [{ count }] = await tx.$queryRaw<{ count: number }[]>`
        SELECT count(*)::int AS count FROM human_sessions
        WHERE principal_id = ${input.principalId}::uuid AND state = 'ACTIVE'
          AND absolute_expires_at > now()
          AND last_activity_at + make_interval(secs => idle_timeout_seconds) > now()`;
      const state: SessionState =
        count >= sessionPolicy.maxActiveSessions ? "PENDING_LIMIT" : "ACTIVE";
      await tx.$executeRaw`
        INSERT INTO human_sessions (id, principal_id, token_hash, state, provider_session_id,
          assurance_level, authenticated_at, strong_authenticated_at, idle_timeout_seconds,
          absolute_expires_at, provider_tokens, access_token_expires_at)
        VALUES (${input.id}::uuid, ${input.principalId}::uuid, ${input.tokenHash},
          ${state}::"HumanSessionState", ${input.providerSessionId}, ${input.assuranceLevel},
          ${input.authenticatedAt}, ${input.strongAuthenticatedAt}, ${input.idleTimeoutSeconds},
          now() + make_interval(secs => ${sessionPolicy.absoluteLifetimeSeconds}::double precision),
          ${input.providerTokens},
          now() + make_interval(secs => ${Math.max(input.accessTokenLifetimeSeconds - 5, 0)}::double precision))`;
      return state;
    });
  }

  async readProfiles(
    principalIds: readonly string[],
  ): Promise<readonly HumanProfile[]> {
    const ids = [...new Set(principalIds)];
    if (ids.length > 100)
      throw new Error("Profile lookup exceeds the authorized page size");
    if (ids.length === 0) return [];
    const rows = await this.#db.$queryRaw<
      {
        id: string;
        display_name: string | null;
        verified_email: string | null;
      }[]
    >`
      SELECT id, display_name, verified_email FROM principals
      WHERE id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})`;
    return rows.map((row) => ({
      principalId: row.id,
      displayName: row.display_name,
      email: row.verified_email,
    }));
  }

  async #select(where: Prisma.Sql): Promise<StoredSession[]> {
    const recheck = sessionPolicy.providerRecheckSeconds;
    const margin = sessionPolicy.refreshMarginSeconds;
    const activity = sessionPolicy.activityWriteIntervalSeconds;
    const rows = await this.#db.$queryRaw<SessionRow[]>`
      SELECT s.id, s.principal_id, p.status::text AS principal_status, p.subject, p.issuer,
        s.state::text AS state, s.provider_session_id, s.assurance_level, s.authenticated_at,
        s.strong_authenticated_at,
        EXTRACT(EPOCH FROM now() - s.strong_authenticated_at)::double precision AS strong_age_seconds,
        s.provider_tokens, s.created_at, s.last_activity_at,
        LEAST(s.absolute_expires_at,
          s.last_activity_at + make_interval(secs => s.idle_timeout_seconds)) AS expires_at,
        (s.absolute_expires_at <= now()
          OR s.last_activity_at + make_interval(secs => s.idle_timeout_seconds) <= now()) AS expired,
        (s.access_token_expires_at <= now() + make_interval(secs => ${margin}::double precision)) AS refresh_due,
        (s.provider_checked_at <= now() - make_interval(secs => ${recheck}::double precision)) AS recheck_due,
        (s.last_activity_at <= now() - make_interval(secs => ${activity}::double precision)) AS activity_due
      FROM human_sessions s JOIN principals p ON p.id = s.principal_id
      WHERE ${where}
      ORDER BY s.created_at DESC, s.id DESC`;
    return rows.map(session);
  }

  async findSession(
    by: { tokenHash: Buffer } | { id: string },
  ): Promise<StoredSession | null> {
    const [found] = await this.#select(
      "tokenHash" in by
        ? Prisma.sql`s.token_hash = ${by.tokenHash}`
        : Prisma.sql`s.id = ${by.id}::uuid`,
    );
    return found ?? null;
  }

  /** The principal's unrevoked, unexpired sessions, newest first. */
  async listSessions(principalId: string): Promise<StoredSession[]> {
    return this.#select(Prisma.sql`s.principal_id = ${principalId}::uuid
      AND s.state <> 'REVOKED' AND s.absolute_expires_at > now()
      AND s.last_activity_at + make_interval(secs => s.idle_timeout_seconds) > now()`);
  }

  /** Revokes one session if it is not already revoked; returns whether it changed. */
  async revoke(id: string, reason: RevocationReason): Promise<boolean> {
    const changed = await this.#db.$executeRaw`
      UPDATE human_sessions SET state = 'REVOKED', revoked_at = now(), revocation_reason = ${reason},
        refresh_lease_until = NULL
      WHERE id = ${id}::uuid AND state <> 'REVOKED'`;
    return changed > 0;
  }

  /** Revokes a principal's own session; another principal's ID changes nothing. */
  async revokeOwned(
    principalId: string,
    id: string,
    reason: RevocationReason,
  ): Promise<Uint8Array | null> {
    const rows = await this.#db.$queryRaw<{ provider_tokens: Uint8Array }[]>`
      UPDATE human_sessions SET state = 'REVOKED', revoked_at = now(), revocation_reason = ${reason},
        refresh_lease_until = NULL
      WHERE id = ${id}::uuid AND principal_id = ${principalId}::uuid AND state <> 'REVOKED'
      RETURNING provider_tokens`;
    return rows[0]?.provider_tokens ?? null;
  }

  async revokePrincipal(
    principalId: string,
    reason: RevocationReason,
  ): Promise<number> {
    return this.#db.$executeRaw`
      UPDATE human_sessions SET state = 'REVOKED', revoked_at = now(), revocation_reason = ${reason},
        refresh_lease_until = NULL
      WHERE principal_id = ${principalId}::uuid AND state <> 'REVOKED'`;
  }

  async revokeProviderSession(
    issuer: string,
    providerSessionId: string,
  ): Promise<number> {
    return this.#db.$executeRaw`
      UPDATE human_sessions s SET state = 'REVOKED', revoked_at = now(),
        revocation_reason = 'PROVIDER_LOGOUT', refresh_lease_until = NULL
      FROM principals p
      WHERE p.id = s.principal_id AND p.issuer = ${issuer}
        AND s.provider_session_id = ${providerSessionId} AND s.state <> 'REVOKED'`;
  }

  async revokeProviderSubject(
    issuer: string,
    subject: string,
  ): Promise<number> {
    return this.#db.$executeRaw`
      UPDATE human_sessions s SET state = 'REVOKED', revoked_at = now(),
        revocation_reason = 'PROVIDER_LOGOUT', refresh_lease_until = NULL
      FROM principals p
      WHERE p.id = s.principal_id AND p.issuer = ${issuer} AND p.subject = ${subject}
        AND s.state <> 'REVOKED'`;
  }

  async recordActivity(id: string): Promise<void> {
    await this.#db.$executeRaw`
      UPDATE human_sessions SET last_activity_at = now()
      WHERE id = ${id}::uuid AND state <> 'REVOKED'`;
  }

  async markProviderChecked(id: string): Promise<void> {
    await this.#db.$executeRaw`
      UPDATE human_sessions SET provider_checked_at = now()
      WHERE id = ${id}::uuid AND state <> 'REVOKED'`;
  }

  /** Takes the single-flight refresh lease; false when another request holds it. */
  async acquireRefreshLease(id: string): Promise<boolean> {
    const changed = await this.#db.$executeRaw`
      UPDATE human_sessions
      SET refresh_lease_until = now() + make_interval(secs => ${sessionPolicy.refreshLeaseSeconds}::double precision)
      WHERE id = ${id}::uuid AND state <> 'REVOKED'
        AND (refresh_lease_until IS NULL OR refresh_lease_until <= now())`;
    return changed > 0;
  }

  async releaseRefreshLease(id: string): Promise<void> {
    await this.#db.$executeRaw`
      UPDATE human_sessions SET refresh_lease_until = NULL WHERE id = ${id}::uuid`;
  }

  async storeRefreshedTokens(
    id: string,
    providerTokens: Buffer,
    accessTokenLifetimeSeconds: number,
  ): Promise<boolean> {
    const changed = await this.#db.$executeRaw`
      UPDATE human_sessions SET provider_tokens = ${providerTokens},
        access_token_expires_at = now() + make_interval(secs => ${Math.max(accessTokenLifetimeSeconds - 5, 0)}::double precision),
        provider_checked_at = now(), refresh_lease_until = NULL
      WHERE id = ${id}::uuid AND state <> 'REVOKED'`;
    return changed > 0;
  }

  /** Activates a pending session once the principal is below the session limit. */
  async activatePending(id: string, principalId: string): Promise<boolean> {
    return this.#db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM principals WHERE id = ${principalId}::uuid FOR UPDATE`;
      const [{ count }] = await tx.$queryRaw<{ count: number }[]>`
        SELECT count(*)::int AS count FROM human_sessions
        WHERE principal_id = ${principalId}::uuid AND state = 'ACTIVE'
          AND absolute_expires_at > now()
          AND last_activity_at + make_interval(secs => idle_timeout_seconds) > now()`;
      if (count >= sessionPolicy.maxActiveSessions) return false;
      const changed = await tx.$executeRaw`
        UPDATE human_sessions SET state = 'ACTIVE'
        WHERE id = ${id}::uuid AND state = 'PENDING_LIMIT'`;
      return changed > 0;
    });
  }

  async disablePrincipal(principalId: string): Promise<void> {
    await this.#db.$executeRaw`
      UPDATE principals SET status = 'DISABLED', disabled_at = now()
      WHERE id = ${principalId}::uuid AND status = 'ACTIVE'`;
  }

  /** Records an accepted logout token; false when its identifier was seen before. */
  async rememberLogoutToken(jti: string): Promise<boolean> {
    await this.#db
      .$executeRaw`DELETE FROM backchannel_logout_replays WHERE expires_at <= now()`;
    const rows = await this.#db.$queryRaw<{ jti: string }[]>`
      INSERT INTO backchannel_logout_replays (jti, expires_at)
      VALUES (${jti}, now() + interval '10 minutes')
      ON CONFLICT (jti) DO NOTHING RETURNING jti`;
    return rows.length > 0;
  }
}
