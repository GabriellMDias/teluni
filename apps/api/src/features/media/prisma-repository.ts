import { randomUUID } from "node:crypto";
import type { Database } from "../../database.js";
import { Prisma } from "../../generated/prisma/client.js";
import {
  MediaFailure,
  mediaBackupLockKey,
  mediaPolicy,
  type MediaKind,
  type MediaStatus,
  type ProcessingStage,
  type RejectionReason,
} from "./domain.js";
import type { MediaObjectStore, WorkFile } from "./storage.js";

export type MediaRecord = Readonly<{
  id: string;
  companyId: string;
  branchId: string | null;
  name: string;
  tags: readonly string[];
  kind: MediaKind;
  status: MediaStatus;
  rejectionReason: RejectionReason | null;
  declaredContentType: string;
  declaredSize: number;
  originalSha256: Buffer | null;
  displaySha256: Buffer | null;
  thumbnailSha256: Buffer | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  hasAudio: boolean | null;
  processingStage: ProcessingStage | null;
  processingProgress: number | null;
  processingAttempts: number;
  createdAt: Date;
  readyAt: Date | null;
  archivedAt: Date | null;
  deletedAt: Date | null;
  purgeAfter: Date | null;
  version: number;
}>;

/** A claimed processing job; `attempt` fences writes of a stale claim. */
export type ProcessingJob = Readonly<{
  id: string;
  companyId: string;
  kind: MediaKind;
  declaredContentType: string;
  originalSha256: Buffer;
  attempt: number;
}>;

/** Who acts on an asset: a member, or the processor/maintenance (null). */
export type MediaActor = Readonly<{
  principalId: string;
  membershipId: string;
}> | null;

export type ObjectDescriptor = Readonly<{
  sha256: Buffer;
  byteSize: number;
  contentType: string;
}>;

type Row = {
  id: string;
  company_id: string;
  branch_id: string | null;
  name: string;
  tags: string[];
  kind: MediaKind;
  status: MediaStatus;
  rejection_reason: RejectionReason | null;
  declared_content_type: string;
  declared_size: bigint;
  original_sha256: Uint8Array | null;
  display_sha256: Uint8Array | null;
  thumbnail_sha256: Uint8Array | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  has_audio: boolean | null;
  processing_stage: ProcessingStage | null;
  processing_progress: number | null;
  processing_attempts: number;
  created_at: Date;
  ready_at: Date | null;
  archived_at: Date | null;
  deleted_at: Date | null;
  purge_after: Date | null;
  version: number;
};

const columns = Prisma.sql`id, company_id, branch_id, name, tags,
  kind::text AS kind, status::text AS status, rejection_reason,
  declared_content_type, declared_size, original_sha256, display_sha256,
  thumbnail_sha256, width, height, duration_ms, has_audio, processing_stage,
  processing_progress, processing_attempts, created_at, ready_at, archived_at,
  deleted_at, purge_after, version`;

/** The driver returns bytea as Uint8Array; the module works with Buffers. */
const bytes = (value: Uint8Array): Buffer => Buffer.from(value);
const maybeBytes = (value: Uint8Array | null): Buffer | null =>
  value === null ? null : bytes(value);

const record = (row: Row): MediaRecord => ({
  id: row.id,
  companyId: row.company_id,
  branchId: row.branch_id,
  name: row.name,
  tags: row.tags ?? [],
  kind: row.kind,
  status: row.status,
  rejectionReason: row.rejection_reason,
  declaredContentType: row.declared_content_type,
  declaredSize: Number(row.declared_size),
  originalSha256: maybeBytes(row.original_sha256),
  displaySha256: maybeBytes(row.display_sha256),
  thumbnailSha256: maybeBytes(row.thumbnail_sha256),
  width: row.width,
  height: row.height,
  durationMs: row.duration_ms,
  hasAudio: row.has_audio,
  processingStage: row.processing_stage,
  processingProgress: row.processing_progress,
  processingAttempts: row.processing_attempts,
  createdAt: row.created_at,
  readyAt: row.ready_at,
  archivedAt: row.archived_at,
  deletedAt: row.deleted_at,
  purgeAfter: row.purge_after,
  version: row.version,
});

/**
 * Serializes publishing and releasing one object for the transaction. A
 * transaction-scoped advisory lock needs no UPDATE privilege on the
 * immutable object rows; a hash collision only serializes unrelated work.
 */
async function lockObject(
  tx: Prisma.TransactionClient,
  companyId: string,
  sha256: Buffer,
): Promise<void> {
  const key = `media-object:${companyId}:${sha256.toString("hex")}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

async function writeAudit(
  tx: Prisma.TransactionClient,
  companyId: string,
  assetId: string,
  actor: MediaActor,
  action: string,
  details: Record<string, unknown>,
): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO media_audit_events (id, company_id, asset_id,
      actor_principal_id, actor_membership_id, action, details)
    VALUES (${randomUUID()}::uuid, ${companyId}::uuid, ${assetId}::uuid,
      ${actor?.principalId ?? null}::uuid, ${actor?.membershipId ?? null}::uuid,
      ${action}, ${JSON.stringify(details)}::jsonb)`;
}

export type ListFilter = Readonly<{
  view: "library" | "archived" | "trash" | "selectable";
  kind?: MediaKind;
  /** "company" for company-owned items, or one branch ID. */
  scope?: string;
  tag?: string;
  text?: string;
  limit: number;
  before?: { createdAt: Date; id: string };
}>;

const viewStatuses: Readonly<Record<ListFilter["view"], MediaStatus[]>> = {
  library: ["UPLOADING", "PROCESSING", "READY", "REJECTED", "FAILED"],
  archived: ["ARCHIVED"],
  trash: ["DELETED"],
  selectable: ["READY"],
};

export type Change =
  | { kind: "configure"; name?: string; tags?: readonly string[] }
  | { kind: "archive" }
  | { kind: "restore" }
  | { kind: "delete" }
  | { kind: "restoreDeleted" }
  | { kind: "discard" };

/**
 * PostgreSQL persistence of the media library (ADR-0028). Member writers
 * run inside a transaction that first takes the organization locks through
 * the company-access port, then lock the asset row and finally object rows;
 * the processor and maintenance lock the asset row, then object rows. Every
 * change writes its audit event in the same transaction.
 */
export class PrismaMediaRepository {
  readonly #db: Database;
  readonly #store: MediaObjectStore;

  constructor(database: Database, store: MediaObjectStore) {
    this.#db = database;
    this.#store = store;
  }

  transaction<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.#db.$transaction(work, { timeout: 60_000 });
  }

  /** Counts behind the abuse limits, read under the company lock. */
  async usage(
    tx: Prisma.TransactionClient,
    companyId: string,
    principalId: string,
  ): Promise<{
    openByPrincipal: number;
    openByCompany: number;
    createdToday: number;
    processing: number;
  }> {
    const [row] = await tx.$queryRaw<
      {
        open_by_principal: number;
        open_by_company: number;
        created_today: number;
        processing: number;
      }[]
    >`
      SELECT
        count(*) FILTER (WHERE status = 'UPLOADING'
          AND created_by_principal_id = ${principalId}::uuid)::int AS open_by_principal,
        count(*) FILTER (WHERE status = 'UPLOADING')::int AS open_by_company,
        count(*) FILTER (WHERE created_at > statement_timestamp() - interval '1 day')::int AS created_today,
        count(*) FILTER (WHERE status = 'PROCESSING')::int AS processing
      FROM media_assets WHERE company_id = ${companyId}::uuid`;
    return {
      openByPrincipal: row?.open_by_principal ?? 0,
      openByCompany: row?.open_by_company ?? 0,
      createdToday: row?.created_today ?? 0,
      processing: row?.processing ?? 0,
    };
  }

  async create(
    tx: Prisma.TransactionClient,
    actor: NonNullable<MediaActor>,
    input: {
      companyId: string;
      branchId: string | null;
      name: string;
      tags: readonly string[];
      kind: MediaKind;
      declaredContentType: string;
      declaredSize: number;
    },
  ): Promise<MediaRecord> {
    const id = randomUUID();
    const [row] = await tx.$queryRaw<Row[]>`
      INSERT INTO media_assets (id, company_id, branch_id, name, tags, kind,
        declared_content_type, declared_size, created_by_membership_id,
        created_by_principal_id)
      VALUES (${id}::uuid, ${input.companyId}::uuid, ${input.branchId}::uuid,
        ${input.name}, ${input.tags as string[]}::text[],
        ${input.kind}::"MediaKind", ${input.declaredContentType},
        ${input.declaredSize}, ${actor.membershipId}::uuid,
        ${actor.principalId}::uuid)
      RETURNING ${columns}`;
    await writeAudit(tx, input.companyId, id, actor, "media.created", {
      kind: input.kind,
      branchId: input.branchId,
      declaredSize: input.declaredSize,
    });
    return record(row);
  }

  async find(companyId: string, id: string): Promise<MediaRecord | null> {
    const [row] = await this.#db.$queryRaw<Row[]>`
      SELECT ${columns} FROM media_assets
      WHERE company_id = ${companyId}::uuid AND id = ${id}::uuid`;
    return row ? record(row) : null;
  }

  async findMany(
    companyId: string,
    ids: readonly string[],
  ): Promise<MediaRecord[]> {
    if (ids.length === 0) return [];
    const rows = await this.#db.$queryRaw<Row[]>`
      SELECT ${columns} FROM media_assets
      WHERE company_id = ${companyId}::uuid AND id IN (${Prisma.join(
        [...new Set(ids)].map((id) => Prisma.sql`${id}::uuid`),
      )})`;
    return rows.map(record);
  }

  async lock(
    tx: Prisma.TransactionClient,
    companyId: string,
    id: string,
  ): Promise<MediaRecord | null> {
    const [row] = await tx.$queryRaw<Row[]>`
      SELECT ${columns} FROM media_assets
      WHERE company_id = ${companyId}::uuid AND id = ${id}::uuid
      FOR UPDATE`;
    return row ? record(row) : null;
  }

  /** Share-locks an item a new reference is about to record. */
  async share(
    tx: Prisma.TransactionClient,
    companyId: string,
    id: string,
  ): Promise<MediaRecord | null> {
    const [row] = await tx.$queryRaw<Row[]>`
      SELECT ${columns} FROM media_assets
      WHERE company_id = ${companyId}::uuid AND id = ${id}::uuid
      FOR SHARE`;
    return row ? record(row) : null;
  }

  /**
   * One page of a company's items newest first. `reach` restricts branch
   * items to the caller's branches; company items are visible to anyone
   * who may view media.
   */
  async list(
    companyId: string,
    reach: "all" | ReadonlySet<string>,
    filter: ListFilter,
  ): Promise<MediaRecord[]> {
    const conditions: Prisma.Sql[] = [
      Prisma.sql`company_id = ${companyId}::uuid`,
      Prisma.sql`status::text = ANY(${viewStatuses[filter.view]}::text[])`,
    ];
    if (reach !== "all")
      conditions.push(
        Prisma.sql`(branch_id IS NULL OR branch_id = ANY(${[...reach]}::uuid[]))`,
      );
    if (filter.kind)
      conditions.push(Prisma.sql`kind = ${filter.kind}::"MediaKind"`);
    if (filter.scope === "company")
      conditions.push(Prisma.sql`branch_id IS NULL`);
    else if (filter.scope)
      conditions.push(Prisma.sql`branch_id = ${filter.scope}::uuid`);
    if (filter.tag) conditions.push(Prisma.sql`${filter.tag} = ANY(tags)`);
    if (filter.text)
      conditions.push(
        Prisma.sql`name ILIKE ${"%" + filter.text.replace(/[\\%_]/g, (match) => "\\" + match) + "%"}`,
      );
    if (filter.before)
      conditions.push(
        Prisma.sql`(created_at, id) < (${filter.before.createdAt}, ${filter.before.id}::uuid)`,
      );
    const rows = await this.#db.$queryRaw<Row[]>`
      SELECT ${columns} FROM media_assets
      WHERE ${Prisma.join(conditions, " AND ")}
      ORDER BY created_at DESC, id DESC
      LIMIT ${filter.limit}`;
    return rows.map(record);
  }

  /** The stored descriptor of one of the company's objects. */
  async object(
    companyId: string,
    sha256: Buffer,
  ): Promise<ObjectDescriptor | null> {
    const [row] = await this.#db.$queryRaw<
      { sha256: Uint8Array; byte_size: bigint; content_type: string }[]
    >`
      SELECT sha256, byte_size, content_type FROM media_objects
      WHERE company_id = ${companyId}::uuid AND sha256 = ${sha256}`;
    return row
      ? {
          sha256: bytes(row.sha256),
          byteSize: Number(row.byte_size),
          contentType: row.content_type,
        }
      : null;
  }

  /**
   * Records an object and publishes its work file into the volume while
   * the object lock is held, so a concurrent purge either finished before
   * (and the row is created again) or sees the new reference after commit.
   */
  async #publishObject(
    tx: Prisma.TransactionClient,
    companyId: string,
    file: WorkFile,
    contentType: string,
  ): Promise<void> {
    await lockObject(tx, companyId, file.sha256);
    await tx.$executeRaw`
      INSERT INTO media_objects (company_id, sha256, byte_size, content_type)
      VALUES (${companyId}::uuid, ${file.sha256}, ${file.size}, ${contentType})
      ON CONFLICT DO NOTHING`;
    await this.#store.publish(companyId, file);
  }

  /** Stores the received original and queues the item for processing. */
  async completeUpload(
    tx: Prisma.TransactionClient,
    actor: NonNullable<MediaActor>,
    companyId: string,
    id: string,
    file: WorkFile,
    contentType: string,
  ): Promise<MediaRecord> {
    await this.#publishObject(tx, companyId, file, contentType);
    const [row] = await tx.$queryRaw<Row[]>`
      UPDATE media_assets SET status = 'PROCESSING',
        original_sha256 = ${file.sha256}, uploaded_at = statement_timestamp(),
        next_attempt_at = statement_timestamp(), processing_attempts = 0,
        version = version + 1, updated_at = statement_timestamp()
      WHERE company_id = ${companyId}::uuid AND id = ${id}::uuid
        AND status = 'UPLOADING'
      RETURNING ${columns}`;
    if (!row) throw new MediaFailure("MEDIA_NOT_UPLOADING");
    await writeAudit(tx, companyId, id, actor, "media.uploaded", {
      size: file.size,
    });
    return record(row);
  }

  /** Claims due processing work; several processes may claim concurrently. */
  async claim(limit: number): Promise<ProcessingJob[]> {
    const rows = await this.#db.$queryRaw<
      {
        id: string;
        company_id: string;
        kind: MediaKind;
        declared_content_type: string;
        original_sha256: Uint8Array;
        processing_attempts: number;
      }[]
    >`
      UPDATE media_assets SET
        lease_until = statement_timestamp() + make_interval(secs => ${mediaPolicy.leaseSeconds}),
        processing_attempts = processing_attempts + 1,
        processing_stage = 'probing', processing_progress = NULL
      WHERE id IN (
        SELECT id FROM media_assets
        WHERE status = 'PROCESSING' AND next_attempt_at <= statement_timestamp()
          AND (lease_until IS NULL OR lease_until < statement_timestamp())
        ORDER BY next_attempt_at
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit})
      RETURNING id, company_id, kind::text AS kind, declared_content_type,
        original_sha256, processing_attempts`;
    return rows.map((row) => ({
      id: row.id,
      companyId: row.company_id,
      kind: row.kind,
      declaredContentType: row.declared_content_type,
      originalSha256: bytes(row.original_sha256),
      attempt: row.processing_attempts,
    }));
  }

  /** Reports a stage or progress of a job that still holds its claim. */
  async progress(
    job: ProcessingJob,
    stage: ProcessingStage,
    progress: number | null,
  ): Promise<void> {
    await this.#db.$executeRaw`
      UPDATE media_assets SET processing_stage = ${stage},
        processing_progress = ${progress},
        lease_until = statement_timestamp() + make_interval(secs => ${mediaPolicy.leaseSeconds})
      WHERE id = ${job.id}::uuid AND status = 'PROCESSING'
        AND processing_attempts = ${job.attempt}`;
  }

  /** Publishes the renditions and makes the item usable. */
  async finishReady(
    job: ProcessingJob,
    output: {
      display: WorkFile & { contentType: string };
      thumbnail: WorkFile & { contentType: string };
      width: number;
      height: number;
      durationMs: number | null;
      hasAudio: boolean | null;
    },
  ): Promise<boolean> {
    return this.transaction(async (tx) => {
      const [current] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM media_assets
        WHERE id = ${job.id}::uuid AND status = 'PROCESSING'
          AND processing_attempts = ${job.attempt}
        FOR UPDATE`;
      if (!current) return false;
      for (const file of [output.display, output.thumbnail])
        await this.#publishObject(tx, job.companyId, file, file.contentType);
      await tx.$executeRaw`
        UPDATE media_assets SET status = 'READY',
          display_sha256 = ${output.display.sha256},
          thumbnail_sha256 = ${output.thumbnail.sha256},
          width = ${output.width}, height = ${output.height},
          duration_ms = ${output.durationMs}, has_audio = ${output.hasAudio},
          processing_stage = NULL, processing_progress = NULL,
          lease_until = NULL, next_attempt_at = NULL,
          ready_at = statement_timestamp(), version = version + 1,
          updated_at = statement_timestamp()
        WHERE id = ${job.id}::uuid`;
      await writeAudit(tx, job.companyId, job.id, null, "media.ready", {
        width: output.width,
        height: output.height,
        durationMs: output.durationMs,
        displaySize: output.display.size,
      });
      return true;
    });
  }

  /** Rejects the item for good and releases its original. */
  async finishRejected(
    job: ProcessingJob,
    reason: RejectionReason,
  ): Promise<Buffer[]> {
    const released = await this.transaction(async (tx) => {
      const [current] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM media_assets
        WHERE id = ${job.id}::uuid AND status = 'PROCESSING'
          AND processing_attempts = ${job.attempt}
        FOR UPDATE`;
      if (!current) return [];
      await tx.$executeRaw`
        UPDATE media_assets SET status = 'REJECTED',
          rejection_reason = ${reason}, original_sha256 = NULL,
          processing_stage = NULL, processing_progress = NULL,
          lease_until = NULL, next_attempt_at = NULL, version = version + 1,
          updated_at = statement_timestamp()
        WHERE id = ${job.id}::uuid`;
      await writeAudit(tx, job.companyId, job.id, null, "media.rejected", {
        reason,
      });
      return this.#release(tx, job.companyId, [job.originalSha256]);
    });
    await this.removeFiles(job.companyId, released);
    return released;
  }

  /** Retries an internal failure later, or gives up after the last attempt. */
  async finishFailed(job: ProcessingJob): Promise<void> {
    const final = job.attempt >= mediaPolicy.maxAttempts;
    const delaySeconds = 30 * 4 ** (job.attempt - 1);
    await this.transaction(async (tx) => {
      const [updated] = await tx.$queryRaw<{ id: string }[]>`
        UPDATE media_assets SET
          status = ${final ? "FAILED" : "PROCESSING"}::"MediaStatus",
          processing_stage = NULL, processing_progress = NULL,
          lease_until = NULL,
          next_attempt_at = ${final ? null : new Date(Date.now() + delaySeconds * 1000)},
          version = version + ${final ? 1 : 0},
          updated_at = statement_timestamp()
        WHERE id = ${job.id}::uuid AND status = 'PROCESSING'
          AND processing_attempts = ${job.attempt}
        RETURNING id`;
      if (updated && final)
        await writeAudit(tx, job.companyId, job.id, null, "media.failed", {
          attempts: job.attempt,
        });
    });
  }

  /**
   * Applies one member change to a locked item and returns it with the
   * objects that were deleted because no item references them any more.
   */
  async change(
    tx: Prisma.TransactionClient,
    actor: MediaActor,
    current: MediaRecord,
    change: Change,
  ): Promise<{ record: MediaRecord; released: Buffer[] }> {
    const company = current.companyId;
    const id = current.id;
    let row: Row | undefined;
    let action: string;
    let details: Record<string, unknown> = {};
    switch (change.kind) {
      case "configure": {
        [row] = await tx.$queryRaw<Row[]>`
          UPDATE media_assets SET
            name = ${change.name ?? current.name},
            tags = ${(change.tags ?? current.tags) as string[]}::text[],
            version = version + 1, updated_at = statement_timestamp()
          WHERE company_id = ${company}::uuid AND id = ${id}::uuid
          RETURNING ${columns}`;
        action =
          change.name !== undefined && change.name !== current.name
            ? "media.renamed"
            : "media.tagged";
        details = {
          renamed: change.name !== undefined && change.name !== current.name,
          tagCount: (change.tags ?? current.tags).length,
        };
        break;
      }
      case "archive":
        [row] = await tx.$queryRaw<Row[]>`
          UPDATE media_assets SET status = 'ARCHIVED',
            archived_at = statement_timestamp(),
            version = version + 1, updated_at = statement_timestamp()
          WHERE company_id = ${company}::uuid AND id = ${id}::uuid
          RETURNING ${columns}`;
        action = "media.archived";
        break;
      case "restore":
        [row] = await tx.$queryRaw<Row[]>`
          UPDATE media_assets SET status = 'READY', archived_at = NULL,
            version = version + 1, updated_at = statement_timestamp()
          WHERE company_id = ${company}::uuid AND id = ${id}::uuid
          RETURNING ${columns}`;
        action = "media.restored";
        break;
      case "delete":
        [row] = await tx.$queryRaw<Row[]>`
          UPDATE media_assets SET status = 'DELETED',
            deleted_at = statement_timestamp(),
            purge_after = statement_timestamp()
              + make_interval(days => ${mediaPolicy.trashDays}),
            version = version + 1, updated_at = statement_timestamp()
          WHERE company_id = ${company}::uuid AND id = ${id}::uuid
          RETURNING ${columns}`;
        action = "media.deleted";
        break;
      case "restoreDeleted":
        [row] = await tx.$queryRaw<Row[]>`
          UPDATE media_assets SET status = 'ARCHIVED', deleted_at = NULL,
            purge_after = NULL,
            version = version + 1, updated_at = statement_timestamp()
          WHERE company_id = ${company}::uuid AND id = ${id}::uuid
          RETURNING ${columns}`;
        action = "media.trash_restored";
        break;
      case "discard":
        return {
          record: await this.#purge(tx, actor, current, "media.discarded"),
          released: await this.#release(
            tx,
            company,
            [current.originalSha256].filter((hash): hash is Buffer => !!hash),
          ),
        };
    }
    await writeAudit(tx, company, id, actor, action, details);
    return { record: record(row), released: [] };
  }

  async #purge(
    tx: Prisma.TransactionClient,
    actor: MediaActor,
    current: MediaRecord,
    action: string,
  ): Promise<MediaRecord> {
    const [row] = await tx.$queryRaw<Row[]>`
      UPDATE media_assets SET status = 'PURGED', purged_at = statement_timestamp(),
        original_sha256 = NULL, display_sha256 = NULL, thumbnail_sha256 = NULL,
        rejection_reason = NULL, purge_after = NULL, lease_until = NULL,
        next_attempt_at = NULL, processing_stage = NULL,
        processing_progress = NULL, version = version + 1,
        updated_at = statement_timestamp()
      WHERE company_id = ${current.companyId}::uuid AND id = ${current.id}::uuid
      RETURNING ${columns}`;
    await writeAudit(tx, current.companyId, current.id, actor, action, {
      previousStatus: current.status,
    });
    return record(row);
  }

  /**
   * Deletes the rows of objects no item of the company references any more,
   * each under its own lock, and returns their hashes. Their files go only
   * after the transaction commits, through `removeFiles`, so a rollback
   * never leaves a recorded object without its file.
   */
  async #release(
    tx: Prisma.TransactionClient,
    companyId: string,
    hashes: readonly Buffer[],
  ): Promise<Buffer[]> {
    const released: Buffer[] = [];
    const unique = [
      ...new Map(hashes.map((hash) => [hash.toString("hex"), hash])).values(),
    ];
    for (const hash of unique) {
      await lockObject(tx, companyId, hash);
      const [present] = await tx.$queryRaw<{ sha256: Uint8Array }[]>`
        SELECT sha256 FROM media_objects
        WHERE company_id = ${companyId}::uuid AND sha256 = ${hash}`;
      if (!present) continue;
      const [used] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM media_assets
        WHERE company_id = ${companyId}::uuid
          AND (original_sha256 = ${hash} OR display_sha256 = ${hash}
            OR thumbnail_sha256 = ${hash})
        LIMIT 1`;
      if (used) continue;
      await tx.$executeRaw`
        DELETE FROM media_objects
        WHERE company_id = ${companyId}::uuid AND sha256 = ${hash}`;
      released.push(hash);
    }
    return released;
  }

  /** Items in the trash past their purge instant, oldest first. */
  async duePurges(limit: number): Promise<{ id: string; companyId: string }[]> {
    const rows = await this.#db.$queryRaw<{ id: string; company_id: string }[]>`
      SELECT id, company_id FROM media_assets
      WHERE status = 'DELETED' AND purge_after <= statement_timestamp()
      ORDER BY purge_after LIMIT ${limit}`;
    return rows.map((row) => ({ id: row.id, companyId: row.company_id }));
  }

  /** Uploads that never completed within the upload window. */
  async expiredUploads(
    limit: number,
  ): Promise<{ id: string; companyId: string }[]> {
    const rows = await this.#db.$queryRaw<{ id: string; company_id: string }[]>`
      SELECT id, company_id FROM media_assets
      WHERE status = 'UPLOADING' AND created_at < statement_timestamp()
        - make_interval(secs => ${mediaPolicy.uploadExpirySeconds})
      ORDER BY created_at LIMIT ${limit}`;
    return rows.map((row) => ({ id: row.id, companyId: row.company_id }));
  }

  /**
   * Purges a locked item whose protection the caller already checked,
   * releasing its objects; returns the released hashes.
   */
  async purgeLocked(
    tx: Prisma.TransactionClient,
    current: MediaRecord,
    action: "media.purged" | "media.discarded",
  ): Promise<Buffer[]> {
    await this.#purge(tx, null, current, action);
    return this.#release(
      tx,
      current.companyId,
      [
        current.originalSha256,
        current.displaySha256,
        current.thumbnailSha256,
      ].filter((hash): hash is Buffer => !!hash),
    );
  }

  /**
   * Deletes an object's file unless the database records the object, under
   * the object lock: an upload of the same bytes publishes and commits while
   * holding that lock, so it either finished first (and the file stays) or
   * publishes a fresh file afterwards. Returns whether the file was deleted.
   */
  async removeUnrecorded(companyId: string, sha256: Buffer): Promise<boolean> {
    return this.transaction(async (tx) => {
      // A backup holds this lock exclusively from before its database dump
      // until it has linked the objects, so no object the dump records can
      // vanish first. The file stays for now; the orphan sweep removes it.
      const [backup] = await tx.$queryRaw<{ free: boolean }[]>`
        SELECT pg_try_advisory_xact_lock_shared(
          hashtextextended(${mediaBackupLockKey}, 0)) AS free`;
      if (!backup?.free) return false;
      await lockObject(tx, companyId, sha256);
      const [row] = await tx.$queryRaw<{ found: number }[]>`
        SELECT 1 AS found FROM media_objects
        WHERE company_id = ${companyId}::uuid AND sha256 = ${sha256}`;
      if (row) return false;
      await this.#store.delete(companyId, sha256);
      return true;
    });
  }

  /**
   * Deletes the files of objects a committed transaction released and
   * returns how many could not be deleted; the orphan sweep removes those.
   */
  async removeFiles(
    companyId: string,
    hashes: readonly Buffer[],
  ): Promise<number> {
    let failed = 0;
    for (const hash of hashes)
      await this.removeUnrecorded(companyId, hash).catch(() => {
        failed += 1;
      });
    return failed;
  }
}
