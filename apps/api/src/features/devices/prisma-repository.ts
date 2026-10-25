import type { AuditVisibility } from "../organizations/public.js";
import { randomUUID } from "node:crypto";
import type { Database } from "../../database.js";
import { Prisma } from "../../generated/prisma/client.js";
import {
  DeviceFailure,
  devicePolicy,
  type DeviceErasure,
  type DeviceReport,
  type DeviceStatus,
  type Rotation,
} from "./domain.js";

export type DeviceRecord = Readonly<{
  id: string;
  companyId: string;
  branchId: string;
  name: string;
  /** Explicit time zone; null follows the branch. */
  timeZone: string | null;
  rotation: Rotation;
  status: DeviceStatus;
  erasure: DeviceErasure;
  report: DeviceReport;
  lastSeenAt: Date | null;
  pairedAt: Date;
  revokedAt: Date | null;
  erasureRecordedAt: Date | null;
  version: number;
}>;

/** A device resolved from its credential on one request. */
export type DeviceIdentity = Readonly<{
  id: string;
  companyId: string;
  branchId: string;
  status: DeviceStatus;
  erasure: DeviceErasure;
}>;

/** Who acts on a device: a member, or the device itself (no actor). */
export type DeviceActor = Readonly<{
  principalId: string;
  membershipId: string;
}> | null;

export type DeviceAuditRecord = Readonly<{
  id: string;
  occurredAt: Date;
  actorPrincipalId: string | null;
  action: string;
}>;

type DeviceRow = {
  id: string;
  company_id: string;
  branch_id: string;
  name: string;
  time_zone: string | null;
  rotation: number;
  status: DeviceStatus;
  erasure: DeviceErasure;
  report: DeviceReport;
  last_seen_at: Date | null;
  paired_at: Date;
  revoked_at: Date | null;
  erasure_recorded_at: Date | null;
  version: number;
};

const deviceColumns = Prisma.sql`id, company_id, branch_id, name, time_zone, rotation,
  status::text AS status, erasure::text AS erasure, report, last_seen_at,
  paired_at, revoked_at, erasure_recorded_at, version`;

const record = (row: DeviceRow): DeviceRecord => ({
  id: row.id,
  companyId: row.company_id,
  branchId: row.branch_id,
  name: row.name,
  timeZone: row.time_zone,
  rotation: row.rotation as Rotation,
  status: row.status,
  erasure: row.erasure,
  report: row.report,
  lastSeenAt: row.last_seen_at,
  pairedAt: row.paired_at,
  revokedAt: row.revoked_at,
  erasureRecordedAt: row.erasure_recorded_at,
  version: row.version,
});

/** True when the database rejected a write through the named unique index. */
function violates(error: unknown, constraint: string): boolean {
  if (!(error instanceof Error)) return false;
  const evidence = `${error.message} ${JSON.stringify(
    (error as { meta?: unknown }).meta ?? {},
  )}`;
  return evidence.includes(constraint);
}

async function writeAudit(
  tx: Prisma.TransactionClient,
  companyId: string,
  deviceId: string,
  actor: DeviceActor,
  action: string,
  details: Record<string, unknown>,
  branchIds: readonly string[],
): Promise<void> {
  const id = randomUUID();
  await tx.$executeRaw`
    INSERT INTO device_audit_events (id, company_id, device_id,
      actor_principal_id, actor_membership_id, action, details)
    VALUES (${id}::uuid, ${companyId}::uuid, ${deviceId}::uuid,
      ${actor?.principalId ?? null}::uuid, ${actor?.membershipId ?? null}::uuid,
      ${action}, ${JSON.stringify(details)}::jsonb)`;
  for (const branchId of new Set(branchIds))
    await tx.$executeRaw`
      INSERT INTO device_audit_event_branches (company_id, event_id, branch_id)
      VALUES (${companyId}::uuid, ${id}::uuid, ${branchId}::uuid)`;
}

/**
 * PostgreSQL persistence of device enrollment and lifecycle (ADR-0027).
 * Human writers run inside a transaction that first takes the organization
 * locks through the company-access port, then lock the device row; every
 * change writes its audit event in the same transaction.
 */
export class PrismaDeviceRepository {
  readonly #db: Database;

  constructor(database: Database) {
    this.#db = database;
  }

  transaction<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.#db.$transaction(work);
  }

  /** Deletes expired enrollments and old claim failures, a bounded batch at a time. */
  async purge(): Promise<void> {
    await this.#db.$executeRaw`
      DELETE FROM device_enrollments WHERE id IN (
        SELECT id FROM device_enrollments
        WHERE (status = 'PENDING' AND expires_at < statement_timestamp()
            - make_interval(days => ${devicePolicy.unclaimedRetentionDays}))
          OR (status = 'CLAIMED' AND claimed_at < statement_timestamp()
            - make_interval(days => ${devicePolicy.claimedRetentionDays}))
        LIMIT 500)`;
    await this.#db.$executeRaw`
      DELETE FROM device_claim_failures WHERE id IN (
        SELECT id FROM device_claim_failures
        WHERE occurred_at < statement_timestamp()
          - make_interval(days => ${devicePolicy.failureRetentionDays})
        LIMIT 500)`;
  }

  /**
   * Inserts a pending enrollment, retrying with a new code when the code's
   * HMAC collides. A credential hash already bound to a device or an
   * enrollment is rejected.
   */
  async startEnrollment(
    credentialHash: Buffer,
    report: DeviceReport,
    nextCode: () => { code: string; hmac: Buffer; keyId: string },
  ): Promise<{ id: string; code: string; expiresAt: Date }> {
    const [pending] = await this.#db.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count FROM device_enrollments
      WHERE status = 'PENDING' AND expires_at > statement_timestamp()`;
    if ((pending?.count ?? 0) >= devicePolicy.maxPendingEnrollments)
      throw new DeviceFailure("RATE_LIMITED");
    const [bound] = await this.#db.$queryRaw<{ id: string }[]>`
      SELECT id FROM devices
      WHERE credential_hash = ${credentialHash} OR next_credential_hash = ${credentialHash}`;
    if (bound) throw new DeviceFailure("ENROLLMENT_REJECTED");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { code, hmac, keyId } = nextCode();
      const id = randomUUID();
      const [inserted] = await this.#db.$queryRaw<{ expires_at: Date }[]>`
        INSERT INTO device_enrollments (id, credential_hash, code_hmac, code_key_id, report, expires_at)
        VALUES (${id}::uuid, ${credentialHash}, ${hmac}, ${keyId},
          ${JSON.stringify(report)}::jsonb,
          statement_timestamp() + make_interval(secs => ${devicePolicy.enrollmentValiditySeconds}))
        ON CONFLICT DO NOTHING
        RETURNING expires_at`;
      if (inserted) return { id, code, expiresAt: inserted.expires_at };
      const [existing] = await this.#db.$queryRaw<{ id: string }[]>`
        SELECT id FROM device_enrollments WHERE credential_hash = ${credentialHash}`;
      if (existing) throw new DeviceFailure("ENROLLMENT_REJECTED");
    }
    throw new Error("Could not allocate a unique pairing code");
  }

  /**
   * One poll by the enrolling device, at most once per polling interval.
   * Wrong credentials and unknown enrollments are indistinguishable.
   */
  async pollEnrollment(
    enrollmentId: string,
    credentialHash: Buffer,
  ): Promise<
    | { status: "pending" | "expired"; deviceId: null }
    | { status: "paired"; deviceId: string }
  > {
    const minimumGap =
      devicePolicy.pollIntervalSeconds - devicePolicy.pollToleranceSeconds;
    const [polled] = await this.#db.$queryRaw<
      { status: "PENDING" | "CLAIMED"; expired: boolean }[]
    >`
      UPDATE device_enrollments SET last_polled_at = statement_timestamp()
      WHERE id = ${enrollmentId}::uuid AND credential_hash = ${credentialHash}
        AND (last_polled_at IS NULL
          OR last_polled_at <= statement_timestamp() - make_interval(secs => ${minimumGap}))
      RETURNING status::text AS status, expires_at <= statement_timestamp() AS expired`;
    if (!polled) {
      const [known] = await this.#db.$queryRaw<{ id: string }[]>`
        SELECT id FROM device_enrollments
        WHERE id = ${enrollmentId}::uuid AND credential_hash = ${credentialHash}`;
      throw new DeviceFailure(known ? "RATE_LIMITED" : "DEVICE_UNAUTHORIZED");
    }
    if (polled.status === "CLAIMED") {
      const [device] = await this.#db.$queryRaw<{ id: string }[]>`
        SELECT id FROM devices WHERE enrollment_id = ${enrollmentId}::uuid`;
      if (device) return { status: "paired", deviceId: device.id };
    }
    return { status: polled.expired ? "expired" : "pending", deviceId: null };
  }

  /** Recent failed claims by this person and in this company. */
  async failedClaims(
    principalId: string,
    companyId: string,
  ): Promise<{ principal: number; company: number }> {
    const [counts] = await this.#db.$queryRaw<
      { principal: number; company: number }[]
    >`
      SELECT
        count(*) FILTER (WHERE principal_id = ${principalId}::uuid)::int AS principal,
        count(*) FILTER (WHERE company_id = ${companyId}::uuid)::int AS company
      FROM device_claim_failures
      WHERE (principal_id = ${principalId}::uuid OR company_id = ${companyId}::uuid)
        AND occurred_at > statement_timestamp()
          - make_interval(secs => ${devicePolicy.failedClaimWindowSeconds})`;
    return counts ?? { principal: 0, company: 0 };
  }

  async recordFailedClaim(
    principalId: string,
    companyId: string,
  ): Promise<void> {
    await this.#db.$executeRaw`
      INSERT INTO device_claim_failures (id, company_id, principal_id)
      VALUES (${randomUUID()}::uuid, ${companyId}::uuid, ${principalId}::uuid)`;
  }

  /** Locks the live pending enrollment one of the code HMACs names, if any. */
  async lockPendingEnrollment(
    tx: Prisma.TransactionClient,
    codeHmacs: readonly Buffer[],
  ): Promise<{
    id: string;
    credentialHash: Buffer;
    report: DeviceReport;
  } | null> {
    const [row] = await tx.$queryRaw<
      { id: string; credential_hash: Buffer; report: DeviceReport }[]
    >`
      SELECT id, credential_hash, report FROM device_enrollments
      WHERE code_hmac IN (${Prisma.join([...codeHmacs])})
        AND status = 'PENDING' AND expires_at > statement_timestamp()
      FOR UPDATE`;
    return row
      ? {
          id: row.id,
          credentialHash: Buffer.from(row.credential_hash),
          report: row.report,
        }
      : null;
  }

  /** Claims a locked enrollment and creates its device in one company and branch. */
  async createDevice(
    tx: Prisma.TransactionClient,
    actor: NonNullable<DeviceActor>,
    input: {
      companyId: string;
      branchId: string;
      enrollmentId: string;
      credentialHash: Buffer;
      report: DeviceReport;
      name: string;
      rotation: Rotation;
    },
  ): Promise<DeviceRecord> {
    await tx.$executeRaw`
      UPDATE device_enrollments SET status = 'CLAIMED', claimed_at = statement_timestamp()
      WHERE id = ${input.enrollmentId}::uuid AND status = 'PENDING'`;
    const id = randomUUID();
    let row: DeviceRow | undefined;
    try {
      [row] = await tx.$queryRaw<DeviceRow[]>`
        INSERT INTO devices (id, company_id, branch_id, enrollment_id, name, rotation,
          credential_hash, report, paired_by_membership_id)
        VALUES (${id}::uuid, ${input.companyId}::uuid, ${input.branchId}::uuid,
          ${input.enrollmentId}::uuid, ${input.name}, ${input.rotation},
          ${input.credentialHash}, ${JSON.stringify(input.report)}::jsonb,
          ${actor.membershipId}::uuid)
        RETURNING ${deviceColumns}`;
    } catch (error) {
      // A credential that became bound elsewhere fails like any other claim.
      if (
        violates(error, "devices_credential_key") ||
        violates(error, "devices_next_credential_key")
      )
        throw new DeviceFailure("PAIRING_CODE_INVALID");
      throw error;
    }
    if (!row) throw new Error("Device insert returned no row");
    await writeAudit(
      tx,
      input.companyId,
      id,
      actor,
      "device.paired",
      {
        branchId: input.branchId,
        rotation: input.rotation,
      },
      [input.branchId],
    );
    return record(row);
  }

  /** Newest pairing first, keyset-paginated, within the visible branches. */
  async list(
    companyId: string,
    reach: "all" | ReadonlySet<string>,
    options: {
      limit: number;
      branchId?: string;
      status?: DeviceStatus;
      before?: { pairedAt: Date; id: string };
    },
  ): Promise<DeviceRecord[]> {
    if (reach !== "all" && reach.size === 0) return [];
    const visible =
      reach === "all"
        ? Prisma.empty
        : Prisma.sql`AND branch_id IN (${Prisma.join(
            [...reach].map((id) => Prisma.sql`${id}::uuid`),
          )})`;
    const branch = options.branchId
      ? Prisma.sql`AND branch_id = ${options.branchId}::uuid`
      : Prisma.empty;
    const status = options.status
      ? Prisma.sql`AND status = ${options.status}::"DeviceStatus"`
      : Prisma.empty;
    const before = options.before
      ? Prisma.sql`AND (paired_at, id) < (${options.before.pairedAt}::timestamptz, ${options.before.id}::uuid)`
      : Prisma.empty;
    const rows = await this.#db.$queryRaw<DeviceRow[]>`
      SELECT ${deviceColumns} FROM devices
      WHERE company_id = ${companyId}::uuid ${visible} ${branch} ${status} ${before}
      ORDER BY paired_at DESC, id DESC
      LIMIT ${options.limit}`;
    return rows.map(record);
  }

  /** Authorize immutable event scope before ordering/limiting, never the current branch. */
  async listAuditEvents(
    companyId: string,
    deviceId: string,
    visibility: AuditVisibility,
    options: { limit: number; before?: { occurredAt: Date; id: string } },
  ): Promise<DeviceAuditRecord[]> {
    const before = options.before
      ? Prisma.sql`AND (e.occurred_at, e.id) < (${options.before.occurredAt}, ${options.before.id}::uuid)`
      : Prisma.empty;
    const visible =
      visibility.kind === "all"
        ? Prisma.sql`TRUE`
        : Prisma.sql`
      EXISTS (SELECT 1 FROM device_audit_event_branches eb
        WHERE eb.company_id = e.company_id AND eb.event_id = e.id)
      AND ${
        visibility.branches === "all"
          ? Prisma.sql`TRUE`
          : Prisma.sql`
        NOT EXISTS (SELECT 1 FROM device_audit_event_branches eb
          WHERE eb.company_id = e.company_id AND eb.event_id = e.id
            AND eb.branch_id NOT IN (${Prisma.join(visibility.branches.map((id) => Prisma.sql`${id}::uuid`))}))`
      }`;
    const rows = await this.#db.$queryRaw<
      {
        id: string;
        occurred_at: Date;
        actor_principal_id: string | null;
        action: string;
      }[]
    >`
      SELECT e.id, e.occurred_at, e.actor_principal_id, e.action
      FROM device_audit_events e
      WHERE e.company_id = ${companyId}::uuid AND e.device_id = ${deviceId}::uuid
        AND ${visible} ${before}
      ORDER BY e.occurred_at DESC, e.id DESC LIMIT ${options.limit}`;
    return rows.map((row) => ({
      id: row.id,
      occurredAt: row.occurred_at,
      actorPrincipalId: row.actor_principal_id,
      action: row.action,
    }));
  }

  async find(
    companyId: string,
    deviceId: string,
  ): Promise<DeviceRecord | null> {
    const [row] = await this.#db.$queryRaw<DeviceRow[]>`
      SELECT ${deviceColumns} FROM devices
      WHERE company_id = ${companyId}::uuid AND id = ${deviceId}::uuid`;
    return row ? record(row) : null;
  }

  /**
   * Named devices of one company for another module's decision; inside a
   * transaction they are share-locked so moves and unlinks wait for it.
   */
  async describe(
    tx: Prisma.TransactionClient | null,
    companyId: string,
    deviceIds: readonly string[],
  ): Promise<DeviceRecord[]> {
    if (deviceIds.length === 0) return [];
    const ids = Prisma.join(
      [...new Set(deviceIds)].sort().map((id) => Prisma.sql`${id}::uuid`),
    );
    const rows = tx
      ? await tx.$queryRaw<DeviceRow[]>`
          SELECT ${deviceColumns} FROM devices
          WHERE company_id = ${companyId}::uuid AND id IN (${ids})
          ORDER BY id FOR SHARE`
      : await this.#db.$queryRaw<DeviceRow[]>`
          SELECT ${deviceColumns} FROM devices
          WHERE company_id = ${companyId}::uuid AND id IN (${ids})`;
    return rows.map(record);
  }

  async lock(
    tx: Prisma.TransactionClient,
    companyId: string,
    deviceId: string,
  ): Promise<DeviceRecord | null> {
    const [row] = await tx.$queryRaw<DeviceRow[]>`
      SELECT ${deviceColumns} FROM devices
      WHERE company_id = ${companyId}::uuid AND id = ${deviceId}::uuid
      FOR UPDATE`;
    return row ? record(row) : null;
  }

  /** Applies a validated change to a locked device and records its events. */
  async change(
    tx: Prisma.TransactionClient,
    actor: NonNullable<DeviceActor>,
    current: DeviceRecord,
    change:
      | {
          kind: "configure";
          name?: string;
          rotation?: Rotation;
          timeZone?: string | null;
        }
      | { kind: "move"; branchId: string }
      | { kind: "unlink" }
      | { kind: "reset" },
  ): Promise<DeviceRecord> {
    const name = change.kind === "configure" ? (change.name ?? null) : null;
    const rotation =
      change.kind === "configure" ? (change.rotation ?? null) : null;
    const branchId = change.kind === "move" ? change.branchId : null;
    const setZone =
      change.kind === "configure" && change.timeZone !== undefined;
    const zone = setZone ? (change.timeZone ?? null) : null;
    const unlink = change.kind === "unlink";
    const reset = change.kind === "reset";
    const [row] = await tx.$queryRaw<DeviceRow[]>`
      UPDATE devices SET
        name = COALESCE(${name}, name),
        rotation = COALESCE(${rotation}::int, rotation),
        time_zone = CASE WHEN ${setZone} THEN ${zone}::text ELSE time_zone END,
        branch_id = COALESCE(${branchId}::uuid, branch_id),
        status = CASE WHEN ${unlink} THEN 'REVOKED'::"DeviceStatus" ELSE status END,
        erasure = CASE WHEN ${unlink} THEN 'PENDING'::"DeviceErasure"
          WHEN ${reset} THEN 'RESET_RECORDED'::"DeviceErasure" ELSE erasure END,
        revoked_at = CASE WHEN ${unlink} THEN statement_timestamp() ELSE revoked_at END,
        erasure_recorded_at = CASE WHEN ${reset} THEN statement_timestamp() ELSE erasure_recorded_at END,
        next_credential_hash = CASE WHEN ${unlink} THEN NULL ELSE next_credential_hash END,
        version = version + 1,
        updated_at = GREATEST(statement_timestamp(), updated_at + interval '1 millisecond')
      WHERE company_id = ${current.companyId}::uuid AND id = ${current.id}::uuid
      RETURNING ${deviceColumns}`;
    if (!row) throw new DeviceFailure("RESOURCE_NOT_FOUND");
    const events: [string, Record<string, unknown>][] = [];
    if (change.kind === "configure") {
      if (change.name !== undefined && change.name !== current.name)
        events.push(["device.renamed", {}]);
      if (change.rotation !== undefined && change.rotation !== current.rotation)
        events.push([
          "device.rotation_changed",
          { from: current.rotation, to: change.rotation },
        ]);
      if (change.timeZone !== undefined && change.timeZone !== current.timeZone)
        events.push([
          "device.time_zone_changed",
          { from: current.timeZone, to: change.timeZone },
        ]);
    } else if (change.kind === "move")
      events.push([
        "device.moved",
        { fromBranchId: current.branchId, toBranchId: change.branchId },
      ]);
    else if (change.kind === "unlink")
      events.push(["device.unlinked", { branchId: current.branchId }]);
    else events.push(["device.reset_recorded", {}]);
    for (const [action, details] of events)
      await writeAudit(
        tx,
        current.companyId,
        current.id,
        actor,
        action,
        details,
        change.kind === "move"
          ? [current.branchId, change.branchId]
          : [current.branchId],
      );
    return record(row);
  }

  /**
   * Resolves a presented credential hash on every request, without caching.
   * The first use of a rotated credential promotes it; last_seen_at is
   * written at most once per interval. Confirmed erasures have no hash.
   */
  async authenticate(hash: Buffer): Promise<DeviceIdentity | null> {
    const [row] = await this.#db.$queryRaw<
      (DeviceIdentity & {
        via_next: boolean;
        stale: boolean;
      })[]
    >`
      SELECT id, company_id AS "companyId", branch_id AS "branchId",
        status::text AS status, erasure::text AS erasure,
        next_credential_hash IS NOT NULL AND next_credential_hash = ${hash} AS via_next,
        (last_seen_at IS NULL OR last_seen_at <= statement_timestamp()
          - make_interval(secs => ${devicePolicy.lastSeenWriteSeconds})) AS stale
      FROM devices
      WHERE credential_hash = ${hash} OR next_credential_hash = ${hash}`;
    if (!row) return null;
    if (row.via_next || row.stale)
      await this.#db.$executeRaw`
        UPDATE devices SET
          credential_hash = CASE WHEN next_credential_hash = ${hash} THEN ${hash} ELSE credential_hash END,
          next_credential_hash = CASE WHEN next_credential_hash = ${hash} THEN NULL ELSE next_credential_hash END,
          last_seen_at = statement_timestamp()
        WHERE id = ${row.id}::uuid
          AND (credential_hash = ${hash} OR next_credential_hash = ${hash})`;
    return {
      id: row.id,
      companyId: row.companyId,
      branchId: row.branchId,
      status: row.status,
      erasure: row.erasure,
    };
  }

  /** The device's configuration and the database clock for a check-in. */
  async self(
    identity: DeviceIdentity,
  ): Promise<{ device: DeviceRecord; now: Date }> {
    const [row] = await this.#db.$queryRaw<(DeviceRow & { now: Date })[]>`
      SELECT ${deviceColumns}, statement_timestamp() AS now FROM devices
      WHERE company_id = ${identity.companyId}::uuid AND id = ${identity.id}::uuid`;
    if (!row) throw new DeviceFailure("DEVICE_UNAUTHORIZED");
    return { device: record(row), now: row.now };
  }

  async updateReport(
    identity: DeviceIdentity,
    report: DeviceReport,
  ): Promise<void> {
    const changed = await this.#db.$executeRaw`
      UPDATE devices SET report = ${JSON.stringify(report)}::jsonb
      WHERE company_id = ${identity.companyId}::uuid AND id = ${identity.id}::uuid
        AND status = 'ACTIVE'`;
    if (changed === 0) throw new DeviceFailure("DEVICE_UNAUTHORIZED");
  }

  /** The unlinked device confirms clearing; its credential hash is deleted. */
  async confirmErasure(identity: DeviceIdentity): Promise<void> {
    await this.#db.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ id: string; branch_id: string }[]>`
        UPDATE devices SET erasure = 'CONFIRMED', credential_hash = NULL,
          next_credential_hash = NULL,
          erasure_recorded_at = statement_timestamp(),
          version = version + 1,
          updated_at = GREATEST(statement_timestamp(), updated_at + interval '1 millisecond')
        WHERE company_id = ${identity.companyId}::uuid AND id = ${identity.id}::uuid
          AND status = 'REVOKED' AND erasure IN ('PENDING', 'RESET_RECORDED')
        RETURNING id, branch_id`;
      if (!row) throw new DeviceFailure("DEVICE_UNAUTHORIZED");
      await writeAudit(
        tx,
        identity.companyId,
        identity.id,
        null,
        "device.erasure_confirmed",
        { afterResetRecord: identity.erasure === "RESET_RECORDED" },
        [row.branch_id],
      );
    });
  }

  /** Registers the hash of a new credential; the current one stays valid until it is used. */
  async rotateCredential(
    identity: DeviceIdentity,
    presented: Buffer,
    next: Buffer,
  ): Promise<void> {
    if (next.equals(presented)) return;
    const [used] = await this.#db.$queryRaw<{ id: string }[]>`
      SELECT id FROM device_enrollments WHERE credential_hash = ${next}
      UNION ALL
      SELECT id FROM devices WHERE id <> ${identity.id}::uuid
        AND (credential_hash = ${next} OR next_credential_hash = ${next})`;
    if (used) throw new DeviceFailure("ENROLLMENT_REJECTED");
    try {
      const changed = await this.#db.$executeRaw`
        UPDATE devices SET next_credential_hash = ${next}
        WHERE company_id = ${identity.companyId}::uuid AND id = ${identity.id}::uuid
          AND status = 'ACTIVE' AND credential_hash = ${presented}`;
      if (changed === 0) throw new DeviceFailure("DEVICE_UNAUTHORIZED");
    } catch (error) {
      if (
        violates(error, "devices_next_credential_key") ||
        violates(error, "devices_next_credential_distinct")
      )
        throw new DeviceFailure("ENROLLMENT_REJECTED");
      throw error;
    }
  }

  /** True while the branch holds an active device; used by the archive guard. */
  async branchHasActiveDevices(
    tx: Prisma.TransactionClient,
    companyId: string,
    branchId: string,
  ): Promise<boolean> {
    const [row] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM devices
      WHERE company_id = ${companyId}::uuid AND branch_id = ${branchId}::uuid
        AND status = 'ACTIVE'
      LIMIT 1`;
    return Boolean(row);
  }
}
