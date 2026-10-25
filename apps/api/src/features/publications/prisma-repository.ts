import type { PlayerDiagnostics } from "./domain.js";
import { randomUUID } from "node:crypto";
import type { Database } from "../../database.js";
import { Prisma } from "../../generated/prisma/client.js";
import { publicationPolicy } from "./domain.js";

export type Actor = Readonly<{ principalId: string; membershipId: string }>;

/** A person's publication, a restore, or the price processor's. */
export type PublicationOrigin = "MANUAL" | "RESTORE" | "PRICE";

/** A catalog a protocol 2 publication copies, with the price changes it includes. */
export type CatalogCopy = Readonly<{
  catalogId: string;
  priceSequence: number;
}>;

export type PublicationRecord = Readonly<{
  id: string;
  companyId: string;
  programId: string;
  branchIds: readonly string[];
  generation: number;
  protocol: number;
  contentSha256: Buffer;
  manifestSha256: Buffer;
  manifestSize: number;
  counts: Readonly<{
    rules: number;
    playlists: number;
    items: number;
    media: number;
    mediaBytes: number;
  }>;
  restoredFromGeneration: number | null;
  origin: PublicationOrigin;
  publishedByPrincipalId: string;
  publishedByMembershipId: string;
  publishedAt: Date;
  supersededAt: Date | null;
  prunedAt: Date | null;
}>;

export type NewPublication = Readonly<{
  id: string;
  programId: string;
  branchIds: readonly string[];
  generation: number;
  protocol: number;
  contentSha256: Buffer;
  manifest: Buffer;
  manifestSha256: Buffer;
  counts: PublicationRecord["counts"];
  restoredFromGeneration: number | null;
  origin: PublicationOrigin;
  publishedAt: Date;
  playlists: readonly Readonly<{ id: string; branchId: string | null }>[];
  catalogs: readonly CatalogCopy[];
  media: readonly Readonly<{
    id: string;
    sha256: Buffer;
    size: number;
    contentType: string;
  }>[];
}>;

/** A rendition a retained publication delivers. */
export type DeliveredMedia = Readonly<{
  sha256: Buffer;
  size: number;
  contentType: string;
}>;

/** The latest stored report of a screen. */
export type StateRecord = Readonly<{
  deviceId: string;
  receivedAt: Date;
  protocol: number;
  appVersion: string;
  desiredPublicationId: string | null;
  activePublicationId: string | null;
  activeSince: Date | null;
  recoveryPublicationId: string | null;
  staging: Readonly<{
    publicationId: string;
    state: "DOWNLOADING" | "VERIFYING" | "READY" | "FAILED";
    failure: string | null;
    bytesDone: number;
    bytesTotal: number;
  }> | null;
  playback: string;
  storage: Readonly<{ freeBytes: number; totalBytes: number }> | null;
  deviceTime: Date | null;
  diagnostics: PlayerDiagnostics | null;
}>;

export type DeviceEventKind =
  "DESIRED_DELIVERED" | "ACTIVATED" | "STAGING_FAILED" | "PLAYBACK_CHANGED";

type PublicationRow = {
  id: string;
  company_id: string;
  program_id: string;
  branch_ids: string[];
  generation: number;
  protocol: number;
  content_sha256: Uint8Array;
  manifest_sha256: Uint8Array;
  manifest_size: number;
  rule_count: number;
  playlist_count: number;
  item_count: number;
  media_count: number;
  media_bytes: bigint;
  restored_from_generation: number | null;
  origin: PublicationOrigin;
  published_by_principal_id: string;
  published_by_membership_id: string;
  published_at: Date;
  superseded_at: Date | null;
  pruned_at: Date | null;
};

const publicationColumns = Prisma.sql`id, company_id, program_id,
  COALESCE(branch_ids::text[], '{}') AS branch_ids, generation, protocol,
  content_sha256, manifest_sha256, manifest_size, rule_count, playlist_count,
  item_count, media_count, media_bytes, restored_from_generation, origin,
  published_by_principal_id, published_by_membership_id, published_at,
  superseded_at, pruned_at`;

const bytes = (value: Uint8Array) =>
  Buffer.from(value.buffer, value.byteOffset, value.byteLength);

const publication = (row: PublicationRow): PublicationRecord => ({
  id: row.id,
  companyId: row.company_id,
  programId: row.program_id,
  branchIds: row.branch_ids,
  generation: row.generation,
  protocol: row.protocol,
  contentSha256: bytes(row.content_sha256),
  manifestSha256: bytes(row.manifest_sha256),
  manifestSize: row.manifest_size,
  counts: {
    rules: row.rule_count,
    playlists: row.playlist_count,
    items: row.item_count,
    media: row.media_count,
    mediaBytes: Number(row.media_bytes),
  },
  restoredFromGeneration: row.restored_from_generation,
  origin: row.origin,
  publishedByPrincipalId: row.published_by_principal_id,
  publishedByMembershipId: row.published_by_membership_id,
  publishedAt: row.published_at,
  supersededAt: row.superseded_at,
  prunedAt: row.pruned_at,
});

type StateRow = {
  device_id: string;
  received_at: Date;
  protocol: number;
  app_version: string;
  desired_publication_id: string | null;
  active_publication_id: string | null;
  active_since: Date | null;
  recovery_publication_id: string | null;
  staging_publication_id: string | null;
  staging_state: "DOWNLOADING" | "VERIFYING" | "READY" | "FAILED" | null;
  staging_failure: string | null;
  staging_bytes_done: bigint | null;
  staging_bytes_total: bigint | null;
  playback: string;
  storage_free_bytes: bigint | null;
  storage_total_bytes: bigint | null;
  device_time: Date | null;
  clock_state: PlayerDiagnostics["clock"] | null;
  clock_skew_millis: bigint | null;
  crash_count: number | null;
};

const state = (row: StateRow): StateRecord => ({
  deviceId: row.device_id,
  receivedAt: row.received_at,
  protocol: row.protocol,
  appVersion: row.app_version,
  desiredPublicationId: row.desired_publication_id,
  activePublicationId: row.active_publication_id,
  activeSince: row.active_since,
  recoveryPublicationId: row.recovery_publication_id,
  staging:
    row.staging_publication_id && row.staging_state
      ? {
          publicationId: row.staging_publication_id,
          state: row.staging_state,
          failure: row.staging_failure,
          bytesDone: Number(row.staging_bytes_done ?? 0),
          bytesTotal: Number(row.staging_bytes_total ?? 0),
        }
      : null,
  playback: row.playback,
  storage:
    row.storage_free_bytes !== null && row.storage_total_bytes !== null
      ? {
          freeBytes: Number(row.storage_free_bytes),
          totalBytes: Number(row.storage_total_bytes),
        }
      : null,
  deviceTime: row.device_time,
  diagnostics:
    row.clock_state === null
      ? null
      : {
          clock: row.clock_state,
          systemSkewMillis:
            row.clock_skew_millis === null
              ? null
              : Number(row.clock_skew_millis),
          crashCount: row.crash_count,
        },
});

const uuidList = (ids: readonly string[]) =>
  Prisma.join([...new Set(ids)].sort().map((id) => Prisma.sql`${id}::uuid`));

/**
 * Whether a program has a publication. It runs in the caller's transaction
 * (an assignment's) and needs no activated module, so assignments ask for
 * confirmation correctly even while publications are unmounted.
 */
export async function programIsPublished(
  tx: Prisma.TransactionClient,
  companyId: string,
  programId: string,
): Promise<boolean> {
  const [row] = await tx.$queryRaw<{ found: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM publications
      WHERE company_id = ${companyId}::uuid AND program_id = ${programId}::uuid) AS found`;
  return row?.found ?? false;
}

const publicationLockKey = (companyId: string) => `publications:${companyId}`;

/**
 * Takes the company's publication lock shared until commit: a price change
 * then sees every publication committed before it, and a publication waits
 * for the change's commit and sees its price sequence.
 */
export async function lockPublicationsShared(
  tx: Prisma.TransactionClient,
  companyId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${publicationLockKey(companyId)}, 0))`;
}

/**
 * The branches of each retained publication that references a media item.
 * It runs in the deleting or purging transaction and needs no activated
 * module, so the media guard fails closed while publications are unmounted.
 */
export async function publicationMediaReferences(
  tx: Prisma.TransactionClient,
  companyId: string,
  mediaId: string,
): Promise<{ branchIds: string[] }[]> {
  const rows = await tx.$queryRaw<{ branch_ids: string[] }[]>`
    SELECT DISTINCT COALESCE(p.branch_ids::text[], '{}') AS branch_ids
    FROM publication_media m
    JOIN publications p ON p.company_id = m.company_id AND p.id = m.publication_id
    WHERE m.company_id = ${companyId}::uuid AND m.media_asset_id = ${mediaId}::uuid`;
  return rows.map((row) => ({ branchIds: row.branch_ids }));
}

/**
 * PostgreSQL persistence of publications. Publishing runs inside a
 * transaction that first takes the organization locks and the programming
 * and media share locks through the ports, then the per-company
 * publication lock; every publication writes its audit event in the same
 * transaction.
 */
export class PrismaPublicationRepository {
  readonly #db: Database;

  constructor(database: Database) {
    this.#db = database;
  }

  transaction<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.#db.$transaction(work);
  }

  /**
   * Serializes publishing per company until commit, so generations, the
   * supersession of the previous one and the limits are exact. Price
   * changes take the same lock shared (`lockPublicationsShared`).
   */
  async lockCompany(
    tx: Prisma.TransactionClient,
    companyId: string,
  ): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${publicationLockKey(companyId)}, 0))`;
  }

  /** The latest publication of a program, which is never pruned. */
  async latest(
    companyId: string,
    programId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<PublicationRecord | null> {
    const [row] = await (tx ?? this.#db).$queryRaw<PublicationRow[]>`
      SELECT ${publicationColumns} FROM publications
      WHERE company_id = ${companyId}::uuid AND program_id = ${programId}::uuid
      ORDER BY generation DESC LIMIT 1`;
    return row ? publication(row) : null;
  }

  async find(
    companyId: string,
    publicationId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<PublicationRecord | null> {
    const [row] = await (tx ?? this.#db).$queryRaw<PublicationRow[]>`
      SELECT ${publicationColumns} FROM publications
      WHERE company_id = ${companyId}::uuid AND id = ${publicationId}::uuid`;
    return row ? publication(row) : null;
  }

  /** Publications of one company by ID; unknown IDs are omitted. */
  async findMany(
    companyId: string,
    publicationIds: readonly string[],
  ): Promise<PublicationRecord[]> {
    if (publicationIds.length === 0) return [];
    const rows = await this.#db.$queryRaw<PublicationRow[]>`
      SELECT ${publicationColumns} FROM publications
      WHERE company_id = ${companyId}::uuid AND id IN (${uuidList(publicationIds)})`;
    return rows.map(publication);
  }

  /** A program's publications, newest generation first. */
  async list(
    companyId: string,
    programId: string,
    options: { limit: number; beforeGeneration?: number },
  ): Promise<PublicationRecord[]> {
    const before =
      options.beforeGeneration === undefined
        ? Prisma.empty
        : Prisma.sql`AND generation < ${options.beforeGeneration}`;
    const rows = await this.#db.$queryRaw<PublicationRow[]>`
      SELECT ${publicationColumns} FROM publications
      WHERE company_id = ${companyId}::uuid AND program_id = ${programId}::uuid ${before}
      ORDER BY generation DESC LIMIT ${options.limit}`;
    return rows.map(publication);
  }

  async manifest(
    companyId: string,
    publicationId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Buffer | null> {
    const [row] = await (tx ?? this.#db).$queryRaw<
      { manifest: Uint8Array | null }[]
    >`
      SELECT manifest FROM publications
      WHERE company_id = ${companyId}::uuid AND id = ${publicationId}::uuid`;
    return row?.manifest ? bytes(row.manifest) : null;
  }

  /** The playlists a publication copied, with the branch that owned each. */
  async playlists(
    tx: Prisma.TransactionClient,
    companyId: string,
    publicationId: string,
  ): Promise<{ id: string; branchId: string | null }[]> {
    const rows = await tx.$queryRaw<
      { playlist_id: string; branch_id: string | null }[]
    >`
      SELECT playlist_id, branch_id FROM publication_playlists
      WHERE company_id = ${companyId}::uuid AND publication_id = ${publicationId}::uuid
      ORDER BY playlist_id`;
    return rows.map((row) => ({
      id: row.playlist_id,
      branchId: row.branch_id,
    }));
  }

  /** The catalogs a publication copies, with the price changes each copy includes. */
  async catalogs(
    tx: Prisma.TransactionClient,
    companyId: string,
    publicationId: string,
  ): Promise<CatalogCopy[]> {
    const rows = await tx.$queryRaw<
      { catalog_id: string; price_sequence: bigint }[]
    >`
      SELECT catalog_id, price_sequence FROM publication_catalogs
      WHERE company_id = ${companyId}::uuid AND publication_id = ${publicationId}::uuid
      ORDER BY catalog_id`;
    return rows.map((row) => ({
      catalogId: row.catalog_id,
      priceSequence: Number(row.price_sequence),
    }));
  }

  /** Publications counted by the limits: this program's hour, the company's day. */
  async recentCounts(
    tx: Prisma.TransactionClient,
    companyId: string,
    programId: string,
  ): Promise<{ programHour: number; companyDay: number }> {
    const [row] = await tx.$queryRaw<
      { program_hour: number; company_day: number }[]
    >`
      SELECT
        count(*) FILTER (WHERE program_id = ${programId}::uuid
          AND published_at > statement_timestamp() - interval '1 hour')::int AS program_hour,
        count(*)::int AS company_day
      FROM publications
      WHERE company_id = ${companyId}::uuid
        AND published_at > statement_timestamp() - interval '1 day'`;
    return {
      programHour: row?.program_hour ?? 0,
      companyDay: row?.company_day ?? 0,
    };
  }

  /**
   * Records a publication as its program's next generation: supersedes the
   * previous one, stores the manifest, its playlists and media, and writes
   * the audit event.
   */
  async insert(
    tx: Prisma.TransactionClient,
    actor: Actor,
    companyId: string,
    created: NewPublication,
    action:
      | "publication.published"
      | "publication.restored"
      | "publication.price_published",
    details: Record<string, unknown>,
  ): Promise<PublicationRecord> {
    const branches = [...new Set(created.branchIds)].sort();
    await tx.$executeRaw`
      UPDATE publications SET superseded_at = ${created.publishedAt}
      WHERE company_id = ${companyId}::uuid AND program_id = ${created.programId}::uuid
        AND superseded_at IS NULL`;
    await tx.$executeRaw`
      INSERT INTO publications (id, company_id, program_id, branch_ids, generation,
        protocol, content_sha256, manifest, manifest_sha256, manifest_size,
        rule_count, playlist_count, item_count, media_count, media_bytes,
        restored_from_generation, origin, published_by_principal_id,
        published_by_membership_id, published_at)
      VALUES (${created.id}::uuid, ${companyId}::uuid, ${created.programId}::uuid,
        ${branches}::uuid[], ${created.generation}, ${created.protocol},
        ${created.contentSha256},
        ${created.manifest}, ${created.manifestSha256}, ${created.manifest.length},
        ${created.counts.rules}, ${created.counts.playlists}, ${created.counts.items},
        ${created.counts.media}, ${created.counts.mediaBytes}::bigint,
        ${created.restoredFromGeneration}::int, ${created.origin},
        ${actor.principalId}::uuid,
        ${actor.membershipId}::uuid, ${created.publishedAt})`;
    if (created.playlists.length > 0)
      await tx.$executeRaw`
        INSERT INTO publication_playlists (company_id, publication_id, playlist_id, branch_id)
        VALUES ${Prisma.join(
          created.playlists.map(
            (item) =>
              Prisma.sql`(${companyId}::uuid, ${created.id}::uuid, ${item.id}::uuid, ${item.branchId}::uuid)`,
          ),
        )}`;
    if (created.catalogs.length > 0)
      await tx.$executeRaw`
        INSERT INTO publication_catalogs (company_id, publication_id, catalog_id, price_sequence)
        VALUES ${Prisma.join(
          created.catalogs.map(
            (item) =>
              Prisma.sql`(${companyId}::uuid, ${created.id}::uuid, ${item.catalogId}::uuid,
                ${item.priceSequence}::bigint)`,
          ),
        )}`;
    if (created.media.length > 0)
      await tx.$executeRaw`
        INSERT INTO publication_media (company_id, publication_id, media_asset_id,
          sha256, byte_size, content_type)
        VALUES ${Prisma.join(
          created.media.map(
            (item) =>
              Prisma.sql`(${companyId}::uuid, ${created.id}::uuid, ${item.id}::uuid,
                ${item.sha256}, ${item.size}::bigint, ${item.contentType})`,
          ),
        )}`;
    await tx.$executeRaw`
      INSERT INTO publication_audit_events (id, company_id, subject_type,
        subject_id, branch_ids, actor_principal_id, actor_membership_id,
        action, details)
      VALUES (${randomUUID()}::uuid, ${companyId}::uuid, 'program',
        ${created.programId}::uuid, ${branches}::uuid[], ${actor.principalId}::uuid,
        ${actor.membershipId}::uuid, ${action}, ${JSON.stringify(details)}::jsonb)`;
    const stored = await this.find(companyId, created.id, tx);
    if (!stored) throw new Error("Publication write returned no row");
    return stored;
  }

  /** Writes an audit event of a program that records no publication. */
  async audit(
    tx: Prisma.TransactionClient,
    actor: Actor,
    companyId: string,
    programId: string,
    branchIds: readonly string[],
    action: "publication.price_reauthorized",
    details: Record<string, unknown>,
  ): Promise<void> {
    const branches = [...new Set(branchIds)].sort();
    await tx.$executeRaw`
      INSERT INTO publication_audit_events (id, company_id, subject_type,
        subject_id, branch_ids, actor_principal_id, actor_membership_id,
        action, details)
      VALUES (${randomUUID()}::uuid, ${companyId}::uuid, 'program',
        ${programId}::uuid, ${branches}::uuid[], ${actor.principalId}::uuid,
        ${actor.membershipId}::uuid, ${action}, ${JSON.stringify(details)}::jsonb)`;
  }

  /** A rendition of a retained publication, if that publication names it. */
  async deliveredMedia(
    companyId: string,
    publicationId: string,
    mediaId: string,
  ): Promise<DeliveredMedia | null> {
    const [row] = await this.#db.$queryRaw<
      { sha256: Uint8Array; byte_size: bigint; content_type: string }[]
    >`
      SELECT sha256, byte_size, content_type FROM publication_media
      WHERE company_id = ${companyId}::uuid AND publication_id = ${publicationId}::uuid
        AND media_asset_id = ${mediaId}::uuid`;
    return row
      ? {
          sha256: bytes(row.sha256),
          size: Number(row.byte_size),
          contentType: row.content_type,
        }
      : null;
  }

  // Screen states

  async state(
    companyId: string,
    deviceId: string,
    tx?: Prisma.TransactionClient,
    lock = false,
  ): Promise<StateRecord | null> {
    const [row] = await (tx ?? this.#db).$queryRaw<StateRow[]>`
      SELECT * FROM publication_device_states
      WHERE company_id = ${companyId}::uuid AND device_id = ${deviceId}::uuid
      ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`;
    return row ? state(row) : null;
  }

  async states(
    companyId: string,
    deviceIds: readonly string[],
  ): Promise<Map<string, StateRecord>> {
    const found = new Map<string, StateRecord>();
    if (deviceIds.length === 0) return found;
    const rows = await this.#db.$queryRaw<StateRow[]>`
      SELECT * FROM publication_device_states
      WHERE company_id = ${companyId}::uuid AND device_id IN (${uuidList(deviceIds)})`;
    for (const row of rows) found.set(row.device_id, state(row));
    return found;
  }

  /**
   * Stores a screen's report as its latest state with the time the
   * database received it, and appends the transitions it caused.
   */
  async writeState(
    tx: Prisma.TransactionClient,
    companyId: string,
    report: Omit<StateRecord, "receivedAt">,
    events: readonly Readonly<{
      kind: DeviceEventKind;
      publicationId: string | null;
      detail: string | null;
    }>[],
  ): Promise<StateRecord> {
    const staging = report.staging;
    const [row] = await tx.$queryRaw<StateRow[]>`
      INSERT INTO publication_device_states (company_id, device_id, received_at,
        protocol, app_version, desired_publication_id, active_publication_id,
        active_since, recovery_publication_id, staging_publication_id,
        staging_state, staging_failure, staging_bytes_done, staging_bytes_total,
        playback, storage_free_bytes, storage_total_bytes, device_time,
        clock_state, clock_skew_millis, crash_count)
      VALUES (${companyId}::uuid, ${report.deviceId}::uuid, statement_timestamp(),
        ${report.protocol}, ${report.appVersion}, ${report.desiredPublicationId}::uuid,
        ${report.activePublicationId}::uuid, ${report.activeSince},
        ${report.recoveryPublicationId}::uuid, ${staging?.publicationId ?? null}::uuid,
        ${staging?.state ?? null}, ${staging?.failure ?? null},
        ${staging?.bytesDone ?? null}::bigint, ${staging?.bytesTotal ?? null}::bigint,
        ${report.playback}, ${report.storage?.freeBytes ?? null}::bigint,
        ${report.storage?.totalBytes ?? null}::bigint, ${report.deviceTime},
        ${report.diagnostics?.clock ?? null}, ${report.diagnostics?.systemSkewMillis ?? null}::bigint,
        ${report.diagnostics?.crashCount ?? null}::integer)
      ON CONFLICT (company_id, device_id) DO UPDATE SET
        received_at = EXCLUDED.received_at,
        protocol = EXCLUDED.protocol,
        app_version = EXCLUDED.app_version,
        desired_publication_id = EXCLUDED.desired_publication_id,
        active_publication_id = EXCLUDED.active_publication_id,
        active_since = EXCLUDED.active_since,
        recovery_publication_id = EXCLUDED.recovery_publication_id,
        staging_publication_id = EXCLUDED.staging_publication_id,
        staging_state = EXCLUDED.staging_state,
        staging_failure = EXCLUDED.staging_failure,
        staging_bytes_done = EXCLUDED.staging_bytes_done,
        staging_bytes_total = EXCLUDED.staging_bytes_total,
        playback = EXCLUDED.playback,
        storage_free_bytes = EXCLUDED.storage_free_bytes,
        storage_total_bytes = EXCLUDED.storage_total_bytes,
        device_time = EXCLUDED.device_time,
        clock_state = EXCLUDED.clock_state,
        clock_skew_millis = EXCLUDED.clock_skew_millis,
        crash_count = EXCLUDED.crash_count
      RETURNING *`;
    if (events.length > 0)
      await tx.$executeRaw`
        INSERT INTO publication_device_events (id, company_id, device_id, kind,
          publication_id, detail)
        VALUES ${Prisma.join(
          events.map(
            (event) =>
              Prisma.sql`(${randomUUID()}::uuid, ${companyId}::uuid, ${report.deviceId}::uuid,
                ${event.kind}, ${event.publicationId}::uuid, ${event.detail})`,
          ),
        )}`;
    if (!row) throw new Error("State write returned no row");
    return state(row);
  }

  // Maintenance

  /**
   * Prunes publications that are superseded for longer than the retention,
   * unless a screen reported one as active, recovery or staging recently:
   * clears the manifest and deletes the media references, keeping the row.
   */
  async prune(): Promise<number> {
    const rows = await this.#db.$queryRaw<{ id: string }[]>`
      WITH pruned AS (
        UPDATE publications p
        SET pruned_at = statement_timestamp(), manifest = NULL
        WHERE p.pruned_at IS NULL AND p.superseded_at IS NOT NULL
          AND p.superseded_at < statement_timestamp()
            - make_interval(days => ${publicationPolicy.retentionDays})
          AND NOT EXISTS (
            SELECT 1 FROM publication_device_states s
            WHERE s.company_id = p.company_id
              AND s.received_at > statement_timestamp()
                - make_interval(days => ${publicationPolicy.reportedInUseDays})
              AND p.id IN (s.active_publication_id, s.recovery_publication_id,
                s.staging_publication_id))
        RETURNING p.company_id, p.id
      ), released AS (
        DELETE FROM publication_media m USING pruned
        WHERE m.company_id = pruned.company_id AND m.publication_id = pruned.id
      )
      SELECT id FROM pruned`;
    return rows.length;
  }

  /** Deletes report transitions older than their retention (AT-20). */
  async purgeEvents(): Promise<number> {
    return this.#db.$executeRaw`
      DELETE FROM publication_device_events
      WHERE occurred_at < statement_timestamp()
        - make_interval(days => ${publicationPolicy.eventRetentionDays})`;
  }
}
