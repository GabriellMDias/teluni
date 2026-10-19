import { randomUUID } from "node:crypto";
import type { Database } from "../../database.js";
import { Prisma } from "../../generated/prisma/client.js";
import {
  ProgrammingFailure,
  weekdaysOf,
  type OutputKey,
  type Transition,
} from "./domain.js";
import type { ScheduleRule } from "./schedule.js";

export type Actor = Readonly<{ principalId: string; membershipId: string }>;

export type PlaylistRecord = Readonly<{
  id: string;
  companyId: string;
  branchId: string | null;
  name: string;
  transition: Transition;
  fadeMs: number | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}>;

export type ItemRecord = Readonly<{
  position: number;
  mediaAssetId: string;
  durationMs: number | null;
}>;

export type GroupRecord = Readonly<{
  id: string;
  companyId: string;
  name: string;
  allBranches: boolean;
  branchIds: readonly string[];
  version: number;
  createdAt: Date;
  updatedAt: Date;
}>;

export type OutputRecord = Readonly<{
  defaultPlaylistId: string | null;
  rules: readonly ScheduleRule[];
}>;

export type ProgramRecord = Readonly<{
  id: string;
  version: number;
  outputs: ReadonlyMap<OutputKey, OutputRecord>;
}>;

export type SettingRecord = Readonly<{
  deviceId: string;
  groupId: string | null;
  individual: boolean;
  /** 0 while the screen has no stored setting. */
  version: number;
}>;

export type ProgramSource =
  | Readonly<{ kind: "group"; groupId: string }>
  | Readonly<{ kind: "device"; deviceId: string }>;

type PlaylistRow = {
  id: string;
  company_id: string;
  branch_id: string | null;
  name: string;
  transition: Transition;
  fade_ms: number | null;
  version: number;
  created_at: Date;
  updated_at: Date;
};

const playlistColumns = Prisma.sql`id, company_id, branch_id, name,
  transition::text AS transition, fade_ms, version, created_at, updated_at`;

const playlist = (row: PlaylistRow): PlaylistRecord => ({
  id: row.id,
  companyId: row.company_id,
  branchId: row.branch_id,
  name: row.name,
  transition: row.transition,
  fadeMs: row.fade_ms,
  version: row.version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

type GroupRow = {
  id: string;
  company_id: string;
  name: string;
  all_branches: boolean;
  branch_ids: string[];
  version: number;
  created_at: Date;
  updated_at: Date;
};

const groupColumns = Prisma.sql`g.id, g.company_id, g.name, g.all_branches,
  g.version, g.created_at, g.updated_at,
  COALESCE((SELECT array_agg(b.branch_id::text ORDER BY b.branch_id)
    FROM programming_group_branches b
    WHERE b.company_id = g.company_id AND b.group_id = g.id), '{}') AS branch_ids`;

const group = (row: GroupRow): GroupRecord => ({
  id: row.id,
  companyId: row.company_id,
  name: row.name,
  allBranches: row.all_branches,
  branchIds: row.branch_ids,
  version: row.version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const uuidList = (ids: readonly string[]) =>
  Prisma.join([...new Set(ids)].sort().map((id) => Prisma.sql`${id}::uuid`));

/** True when the database rejected a write through the named constraint. */
function violates(error: unknown, constraint: string): boolean {
  if (!(error instanceof Error)) return false;
  const evidence = `${error.message} ${JSON.stringify(
    (error as { meta?: unknown }).meta ?? {},
  )}`;
  return evidence.includes(constraint);
}

/**
 * PostgreSQL persistence of programming. Writers run inside a transaction
 * that first takes the organization locks through the company-access port;
 * then screens (share), programming rows (update), playlists and media
 * (share), in that order. Every change writes its audit event in the same
 * transaction.
 */
export class PrismaProgrammingRepository {
  readonly #db: Database;

  constructor(database: Database) {
    this.#db = database;
  }

  transaction<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.#db.$transaction(work);
  }

  async audit(
    tx: Prisma.TransactionClient,
    companyId: string,
    actor: Actor,
    subject: { type: "playlist" | "group" | "program" | "device"; id: string },
    branchIds: readonly string[],
    action: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    const branches = [...new Set(branchIds)].sort();
    await tx.$executeRaw`
      INSERT INTO programming_audit_events (id, company_id, subject_type,
        subject_id, branch_ids, actor_principal_id, actor_membership_id,
        action, details)
      VALUES (${randomUUID()}::uuid, ${companyId}::uuid, ${subject.type},
        ${subject.id}::uuid, ${branches}::uuid[], ${actor.principalId}::uuid,
        ${actor.membershipId}::uuid, ${action}, ${JSON.stringify(details)}::jsonb)`;
  }

  /**
   * Counts behind the company limits. A transaction-scoped advisory lock per
   * company serializes every count-and-insert until commit (the company row
   * is only share-locked), and the count runs after it in a fresh snapshot.
   */
  async counts(
    tx: Prisma.TransactionClient,
    companyId: string,
  ): Promise<{ playlists: number; groups: number; programs: number }> {
    const key = `programming-limits:${companyId}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
    const [row] = await tx.$queryRaw<
      { playlists: number; groups: number; programs: number }[]
    >`
      SELECT
        (SELECT count(*)::int FROM playlists WHERE company_id = ${companyId}::uuid) AS playlists,
        (SELECT count(*)::int FROM programming_groups WHERE company_id = ${companyId}::uuid) AS groups,
        (SELECT count(*)::int FROM programs WHERE company_id = ${companyId}::uuid) AS programs`;
    return row ?? { playlists: 0, groups: 0, programs: 0 };
  }

  // Playlists

  async createPlaylist(
    tx: Prisma.TransactionClient,
    actor: Actor,
    input: {
      companyId: string;
      branchId: string | null;
      name: string;
      transition: Transition;
      fadeMs: number | null;
    },
  ): Promise<PlaylistRecord> {
    const id = randomUUID();
    const [row] = await tx.$queryRaw<PlaylistRow[]>`
      INSERT INTO playlists (id, company_id, branch_id, name, transition, fade_ms)
      VALUES (${id}::uuid, ${input.companyId}::uuid, ${input.branchId}::uuid,
        ${input.name}, ${input.transition}::"PlaylistTransition", ${input.fadeMs}::int)
      RETURNING ${playlistColumns}`;
    if (!row) throw new Error("Playlist insert returned no row");
    await this.audit(
      tx,
      input.companyId,
      actor,
      { type: "playlist", id },
      input.branchId ? [input.branchId] : [],
      "playlist.created",
      { transition: input.transition },
    );
    return playlist(row);
  }

  async findPlaylist(
    companyId: string,
    playlistId: string,
  ): Promise<PlaylistRecord | null> {
    const [row] = await this.#db.$queryRaw<PlaylistRow[]>`
      SELECT ${playlistColumns} FROM playlists
      WHERE company_id = ${companyId}::uuid AND id = ${playlistId}::uuid`;
    return row ? playlist(row) : null;
  }

  async findPlaylists(
    companyId: string,
    playlistIds: readonly string[],
  ): Promise<PlaylistRecord[]> {
    if (playlistIds.length === 0) return [];
    const rows = await this.#db.$queryRaw<PlaylistRow[]>`
      SELECT ${playlistColumns} FROM playlists
      WHERE company_id = ${companyId}::uuid AND id IN (${uuidList(playlistIds)})`;
    return rows.map(playlist);
  }

  async lockPlaylist(
    tx: Prisma.TransactionClient,
    companyId: string,
    playlistId: string,
  ): Promise<PlaylistRecord | null> {
    const [row] = await tx.$queryRaw<PlaylistRow[]>`
      SELECT ${playlistColumns} FROM playlists
      WHERE company_id = ${companyId}::uuid AND id = ${playlistId}::uuid
      FOR UPDATE`;
    return row ? playlist(row) : null;
  }

  /** Share-locks playlists a rule or default is about to reference. */
  async sharePlaylists(
    tx: Prisma.TransactionClient,
    companyId: string,
    playlistIds: readonly string[],
  ): Promise<PlaylistRecord[]> {
    if (playlistIds.length === 0) return [];
    const rows = await tx.$queryRaw<PlaylistRow[]>`
      SELECT ${playlistColumns} FROM playlists
      WHERE company_id = ${companyId}::uuid AND id IN (${uuidList(playlistIds)})
      ORDER BY id FOR SHARE`;
    return rows.map(playlist);
  }

  /** Newest first, keyset-paginated, within the visible scopes. */
  async listPlaylists(
    companyId: string,
    reach: "all" | ReadonlySet<string>,
    options: {
      limit: number;
      scope?: string;
      text?: string;
      before?: { createdAt: Date; id: string };
    },
  ): Promise<PlaylistRecord[]> {
    const visible =
      reach === "all"
        ? Prisma.empty
        : reach.size === 0
          ? Prisma.sql`AND branch_id IS NULL`
          : Prisma.sql`AND (branch_id IS NULL OR branch_id IN (${uuidList([
              ...reach,
            ])}))`;
    const scope =
      options.scope === undefined
        ? Prisma.empty
        : options.scope === "company"
          ? Prisma.sql`AND branch_id IS NULL`
          : Prisma.sql`AND branch_id = ${options.scope}::uuid`;
    const text = options.text
      ? Prisma.sql`AND name ILIKE ${`%${options.text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`}`
      : Prisma.empty;
    const before = options.before
      ? Prisma.sql`AND (created_at, id) < (${options.before.createdAt}::timestamptz, ${options.before.id}::uuid)`
      : Prisma.empty;
    const rows = await this.#db.$queryRaw<PlaylistRow[]>`
      SELECT ${playlistColumns} FROM playlists
      WHERE company_id = ${companyId}::uuid ${visible} ${scope} ${text} ${before}
      ORDER BY created_at DESC, id DESC
      LIMIT ${options.limit}`;
    return rows.map(playlist);
  }

  async items(
    companyId: string,
    playlistIds: readonly string[],
  ): Promise<Map<string, ItemRecord[]>> {
    const found = new Map<string, ItemRecord[]>(
      playlistIds.map((id) => [id, []]),
    );
    if (playlistIds.length === 0) return found;
    const rows = await this.#db.$queryRaw<
      {
        playlist_id: string;
        position: number;
        media_asset_id: string;
        duration_ms: number | null;
      }[]
    >`
      SELECT playlist_id, position, media_asset_id, duration_ms FROM playlist_items
      WHERE company_id = ${companyId}::uuid AND playlist_id IN (${uuidList(playlistIds)})
      ORDER BY playlist_id, position`;
    for (const row of rows)
      found.get(row.playlist_id)?.push({
        position: row.position,
        mediaAssetId: row.media_asset_id,
        durationMs: row.duration_ms,
      });
    return found;
  }

  async lockedItems(
    tx: Prisma.TransactionClient,
    companyId: string,
    playlistId: string,
  ): Promise<ItemRecord[]> {
    const rows = await tx.$queryRaw<
      { position: number; media_asset_id: string; duration_ms: number | null }[]
    >`
      SELECT position, media_asset_id, duration_ms FROM playlist_items
      WHERE company_id = ${companyId}::uuid AND playlist_id = ${playlistId}::uuid
      ORDER BY position`;
    return rows.map((row) => ({
      position: row.position,
      mediaAssetId: row.media_asset_id,
      durationMs: row.duration_ms,
    }));
  }

  async updatePlaylist(
    tx: Prisma.TransactionClient,
    actor: Actor,
    current: PlaylistRecord,
    change: {
      name?: string;
      transition?: { kind: Transition; fadeMs: number | null };
      items?: readonly { mediaAssetId: string; durationMs: number | null }[];
    },
  ): Promise<PlaylistRecord> {
    const name = change.name ?? current.name;
    const kind = change.transition?.kind ?? current.transition;
    const fadeMs = change.transition
      ? change.transition.fadeMs
      : current.fadeMs;
    const [row] = await tx.$queryRaw<PlaylistRow[]>`
      UPDATE playlists SET name = ${name},
        transition = ${kind}::"PlaylistTransition", fade_ms = ${fadeMs}::int,
        version = version + 1,
        updated_at = GREATEST(statement_timestamp(), updated_at + interval '1 millisecond')
      WHERE company_id = ${current.companyId}::uuid AND id = ${current.id}::uuid
      RETURNING ${playlistColumns}`;
    if (!row) throw new ProgrammingFailure("RESOURCE_NOT_FOUND");
    if (change.items) {
      await tx.$executeRaw`
        DELETE FROM playlist_items
        WHERE company_id = ${current.companyId}::uuid AND playlist_id = ${current.id}::uuid`;
      if (change.items.length > 0)
        await tx.$executeRaw`
          INSERT INTO playlist_items (company_id, playlist_id, position, media_asset_id, duration_ms)
          VALUES ${Prisma.join(
            change.items.map(
              (item, position) =>
                Prisma.sql`(${current.companyId}::uuid, ${current.id}::uuid, ${position},
                  ${item.mediaAssetId}::uuid, ${item.durationMs}::int)`,
            ),
          )}`;
    }
    const subject = { type: "playlist" as const, id: current.id };
    const branches = current.branchId ? [current.branchId] : [];
    if (change.name !== undefined && change.name !== current.name)
      await this.audit(
        tx,
        current.companyId,
        actor,
        subject,
        branches,
        "playlist.renamed",
        {},
      );
    if (change.transition)
      await this.audit(
        tx,
        current.companyId,
        actor,
        subject,
        branches,
        "playlist.transition_changed",
        { transition: kind, fadeMs },
      );
    if (change.items)
      await this.audit(
        tx,
        current.companyId,
        actor,
        subject,
        branches,
        "playlist.items_replaced",
        { count: change.items.length },
      );
    return playlist(row);
  }

  /** True while a rule or default references the playlist. */
  async playlistInUse(
    tx: Prisma.TransactionClient,
    companyId: string,
    playlistId: string,
  ): Promise<boolean> {
    const [row] = await tx.$queryRaw<{ used: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM schedule_rules
          WHERE company_id = ${companyId}::uuid AND playlist_id = ${playlistId}::uuid)
        OR EXISTS (SELECT 1 FROM program_outputs
          WHERE company_id = ${companyId}::uuid AND default_playlist_id = ${playlistId}::uuid) AS used`;
    return row?.used ?? false;
  }

  async deletePlaylist(
    tx: Prisma.TransactionClient,
    actor: Actor,
    current: PlaylistRecord,
  ): Promise<void> {
    await this.audit(
      tx,
      current.companyId,
      actor,
      { type: "playlist", id: current.id },
      current.branchId ? [current.branchId] : [],
      "playlist.deleted",
      { name: current.name },
    );
    await tx.$executeRaw`
      DELETE FROM playlists
      WHERE company_id = ${current.companyId}::uuid AND id = ${current.id}::uuid`;
  }

  /** The media reference guard: playlists whose items use the asset. */
  async playlistsUsingMedia(
    tx: Prisma.TransactionClient,
    companyId: string,
    assetId: string,
  ): Promise<{ branchId: string | null }[]> {
    return tx.$queryRaw<{ branchId: string | null }[]>`
      SELECT DISTINCT p.id, p.branch_id AS "branchId"
      FROM playlist_items i
      JOIN playlists p ON p.company_id = i.company_id AND p.id = i.playlist_id
      WHERE i.company_id = ${companyId}::uuid AND i.media_asset_id = ${assetId}::uuid`;
  }

  // Groups

  async createGroup(
    tx: Prisma.TransactionClient,
    actor: Actor,
    input: {
      companyId: string;
      name: string;
      allBranches: boolean;
      branchIds: readonly string[];
    },
  ): Promise<GroupRecord> {
    const id = randomUUID();
    try {
      await tx.$executeRaw`
        INSERT INTO programming_groups (id, company_id, name, all_branches)
        VALUES (${id}::uuid, ${input.companyId}::uuid, ${input.name}, ${input.allBranches})`;
    } catch (error) {
      if (violates(error, "programming_groups_company_name_unique"))
        throw new ProgrammingFailure("GROUP_NAME_IN_USE");
      throw error;
    }
    await this.#writeSpan(tx, input.companyId, id, input.branchIds);
    await this.#createProgram(tx, input.companyId, {
      kind: "group",
      groupId: id,
    });
    await this.audit(
      tx,
      input.companyId,
      actor,
      { type: "group", id },
      input.branchIds,
      "group.created",
      { allBranches: input.allBranches, branchCount: input.branchIds.length },
    );
    const created = await this.lockGroup(tx, input.companyId, id, "share");
    if (!created) throw new Error("Group insert returned no row");
    return created;
  }

  async #writeSpan(
    tx: Prisma.TransactionClient,
    companyId: string,
    groupId: string,
    branchIds: readonly string[],
  ): Promise<void> {
    await tx.$executeRaw`
      DELETE FROM programming_group_branches
      WHERE company_id = ${companyId}::uuid AND group_id = ${groupId}::uuid`;
    if (branchIds.length > 0)
      await tx.$executeRaw`
        INSERT INTO programming_group_branches (company_id, group_id, branch_id)
        VALUES ${Prisma.join(
          branchIds.map(
            (branchId) =>
              Prisma.sql`(${companyId}::uuid, ${groupId}::uuid, ${branchId}::uuid)`,
          ),
        )}`;
  }

  async findGroup(
    companyId: string,
    groupId: string,
  ): Promise<GroupRecord | null> {
    const [row] = await this.#db.$queryRaw<GroupRow[]>`
      SELECT ${groupColumns} FROM programming_groups g
      WHERE g.company_id = ${companyId}::uuid AND g.id = ${groupId}::uuid`;
    return row ? group(row) : null;
  }

  async lockGroup(
    tx: Prisma.TransactionClient,
    companyId: string,
    groupId: string,
    mode: "update" | "share",
  ): Promise<GroupRecord | null> {
    const lock =
      mode === "update" ? Prisma.sql`FOR UPDATE` : Prisma.sql`FOR SHARE`;
    const [locked] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM programming_groups
      WHERE company_id = ${companyId}::uuid AND id = ${groupId}::uuid ${lock}`;
    if (!locked) return null;
    const [row] = await tx.$queryRaw<GroupRow[]>`
      SELECT ${groupColumns} FROM programming_groups g
      WHERE g.company_id = ${companyId}::uuid AND g.id = ${groupId}::uuid`;
    return row ? group(row) : null;
  }

  async listGroups(companyId: string): Promise<GroupRecord[]> {
    const rows = await this.#db.$queryRaw<GroupRow[]>`
      SELECT ${groupColumns} FROM programming_groups g
      WHERE g.company_id = ${companyId}::uuid
      ORDER BY lower(g.name), g.id`;
    return rows.map(group);
  }

  async updateGroup(
    tx: Prisma.TransactionClient,
    actor: Actor,
    current: GroupRecord,
    change: {
      name?: string;
      span?: { allBranches: boolean; branchIds: readonly string[] };
    },
  ): Promise<GroupRecord> {
    const name = change.name ?? current.name;
    const allBranches = change.span?.allBranches ?? current.allBranches;
    try {
      await tx.$executeRaw`
        UPDATE programming_groups SET name = ${name}, all_branches = ${allBranches},
          version = version + 1,
          updated_at = GREATEST(statement_timestamp(), updated_at + interval '1 millisecond')
        WHERE company_id = ${current.companyId}::uuid AND id = ${current.id}::uuid`;
    } catch (error) {
      if (violates(error, "programming_groups_company_name_unique"))
        throw new ProgrammingFailure("GROUP_NAME_IN_USE");
      throw error;
    }
    if (change.span)
      await this.#writeSpan(
        tx,
        current.companyId,
        current.id,
        change.span.branchIds,
      );
    const subject = { type: "group" as const, id: current.id };
    const branches = [...current.branchIds, ...(change.span?.branchIds ?? [])];
    if (change.name !== undefined && change.name !== current.name)
      await this.audit(
        tx,
        current.companyId,
        actor,
        subject,
        branches,
        "group.renamed",
        {},
      );
    if (change.span)
      await this.audit(
        tx,
        current.companyId,
        actor,
        subject,
        branches,
        "group.span_changed",
        {
          allBranches: change.span.allBranches,
          branchCount: change.span.branchIds.length,
        },
      );
    const updated = await this.lockGroup(
      tx,
      current.companyId,
      current.id,
      "share",
    );
    if (!updated) throw new ProgrammingFailure("RESOURCE_NOT_FOUND");
    return updated;
  }

  async deleteGroup(
    tx: Prisma.TransactionClient,
    actor: Actor,
    current: GroupRecord,
  ): Promise<void> {
    await this.audit(
      tx,
      current.companyId,
      actor,
      { type: "group", id: current.id },
      current.branchIds,
      "group.deleted",
      { name: current.name },
    );
    await tx.$executeRaw`
      DELETE FROM programming_groups
      WHERE company_id = ${current.companyId}::uuid AND id = ${current.id}::uuid`;
  }

  /** Member screens of groups; settings rows naming each group. */
  async members(
    companyId: string,
    groupIds: readonly string[],
    tx?: Prisma.TransactionClient,
  ): Promise<Map<string, string[]>> {
    const found = new Map<string, string[]>(groupIds.map((id) => [id, []]));
    if (groupIds.length === 0) return found;
    const rows = await (tx ?? this.#db).$queryRaw<
      { group_id: string; device_id: string }[]
    >`
      SELECT group_id, device_id FROM programming_device_settings
      WHERE company_id = ${companyId}::uuid AND group_id IN (${uuidList(groupIds)})
      ORDER BY device_id`;
    for (const row of rows) found.get(row.group_id)?.push(row.device_id);
    return found;
  }

  /** True while a group's explicit span names the branch. */
  async branchInSpan(
    tx: Prisma.TransactionClient,
    companyId: string,
    branchId: string,
  ): Promise<boolean> {
    const [row] = await tx.$queryRaw<{ group_id: string }[]>`
      SELECT group_id FROM programming_group_branches
      WHERE company_id = ${companyId}::uuid AND branch_id = ${branchId}::uuid
      LIMIT 1`;
    return Boolean(row);
  }

  // Programs

  async #createProgram(
    tx: Prisma.TransactionClient,
    companyId: string,
    source: ProgramSource,
  ): Promise<string> {
    const id = randomUUID();
    const groupId = source.kind === "group" ? source.groupId : null;
    const deviceId = source.kind === "device" ? source.deviceId : null;
    await tx.$executeRaw`
      INSERT INTO programs (id, company_id, group_id, device_id)
      VALUES (${id}::uuid, ${companyId}::uuid, ${groupId}::uuid, ${deviceId}::uuid)`;
    await tx.$executeRaw`
      INSERT INTO program_outputs (company_id, program_id, output_key)
      VALUES (${companyId}::uuid, ${id}::uuid, 'screen')`;
    return id;
  }

  #sourceFilter(source: ProgramSource) {
    return source.kind === "group"
      ? Prisma.sql`group_id = ${source.groupId}::uuid`
      : Prisma.sql`device_id = ${source.deviceId}::uuid`;
  }

  /** The program of a source; absent for a screen never programmed. */
  async program(
    companyId: string,
    source: ProgramSource,
    tx?: Prisma.TransactionClient,
    lock = false,
  ): Promise<ProgramRecord | null> {
    const db = tx ?? this.#db;
    const [head] = await db.$queryRaw<{ id: string; version: number }[]>`
      SELECT id, version FROM programs
      WHERE company_id = ${companyId}::uuid AND ${this.#sourceFilter(source)}
      ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`;
    if (!head) return null;
    const outputs = await db.$queryRaw<
      { output_key: OutputKey; default_playlist_id: string | null }[]
    >`
      SELECT output_key, default_playlist_id FROM program_outputs
      WHERE company_id = ${companyId}::uuid AND program_id = ${head.id}::uuid`;
    const rules = await db.$queryRaw<
      {
        id: string;
        output_key: OutputKey;
        playlist_id: string;
        weekdays: number;
        all_day: boolean;
        start_minute: number | null;
        end_minute: number | null;
        starts_on: string;
        ends_on: string | null;
      }[]
    >`
      SELECT id, output_key, playlist_id, weekdays, all_day, start_minute,
        end_minute, to_char(starts_on, 'YYYY-MM-DD') AS starts_on,
        to_char(ends_on, 'YYYY-MM-DD') AS ends_on
      FROM schedule_rules
      WHERE company_id = ${companyId}::uuid AND program_id = ${head.id}::uuid
      ORDER BY output_key, position`;
    const map = new Map<OutputKey, OutputRecord>();
    for (const output of outputs)
      map.set(output.output_key, {
        defaultPlaylistId: output.default_playlist_id,
        rules: rules
          .filter((rule) => rule.output_key === output.output_key)
          .map((rule) => ({
            id: rule.id,
            playlistId: rule.playlist_id,
            weekdays: weekdaysOf(rule.weekdays),
            allDay: rule.all_day,
            startMinute: rule.start_minute,
            endMinute: rule.end_minute,
            startsOn: rule.starts_on,
            endsOn: rule.ends_on,
          })),
      });
    return { id: head.id, version: head.version, outputs: map };
  }

  /** Replaces one output's default and rules, creating the program if needed. */
  async replaceOutput(
    tx: Prisma.TransactionClient,
    actor: Actor,
    companyId: string,
    source: ProgramSource,
    branchIds: readonly string[],
    current: ProgramRecord | null,
    outputKey: OutputKey,
    output: {
      defaultPlaylistId: string | null;
      rules: readonly (Omit<ScheduleRule, "id"> & { weekdayMask: number })[];
    },
  ): Promise<ProgramRecord> {
    const programId =
      current?.id ?? (await this.#createProgram(tx, companyId, source));
    await tx.$executeRaw`
      DELETE FROM schedule_rules
      WHERE company_id = ${companyId}::uuid AND program_id = ${programId}::uuid
        AND output_key = ${outputKey}`;
    await tx.$executeRaw`
      UPDATE program_outputs SET default_playlist_id = ${output.defaultPlaylistId}::uuid
      WHERE company_id = ${companyId}::uuid AND program_id = ${programId}::uuid
        AND output_key = ${outputKey}`;
    if (output.rules.length > 0)
      await tx.$executeRaw`
        INSERT INTO schedule_rules (id, company_id, program_id, output_key, position,
          playlist_id, weekdays, all_day, start_minute, end_minute, starts_on, ends_on)
        VALUES ${Prisma.join(
          output.rules.map(
            (rule, position) =>
              Prisma.sql`(${randomUUID()}::uuid, ${companyId}::uuid, ${programId}::uuid,
                ${outputKey}, ${position}, ${rule.playlistId}::uuid, ${rule.weekdayMask},
                ${rule.allDay}, ${rule.startMinute}::int, ${rule.endMinute}::int,
                ${rule.startsOn}::date, ${rule.endsOn}::date)`,
          ),
        )}`;
    // A program created by this save keeps version 1.
    if (current)
      await tx.$executeRaw`
        UPDATE programs SET version = version + 1,
          updated_at = GREATEST(statement_timestamp(), updated_at + interval '1 millisecond')
        WHERE company_id = ${companyId}::uuid AND id = ${programId}::uuid`;
    await this.audit(
      tx,
      companyId,
      actor,
      { type: "program", id: programId },
      branchIds,
      "program.output_replaced",
      {
        output: outputKey,
        rules: output.rules.length,
        hasDefault: output.defaultPlaylistId !== null,
      },
    );
    const updated = await this.program(companyId, source, tx);
    if (!updated) throw new Error("Program write returned no row");
    return updated;
  }

  // Screen settings

  async setting(
    companyId: string,
    deviceId: string,
    tx?: Prisma.TransactionClient,
    lock = false,
  ): Promise<SettingRecord> {
    const [row] = await (tx ?? this.#db).$queryRaw<
      { group_id: string | null; individual: boolean; version: number }[]
    >`
      SELECT group_id, individual, version FROM programming_device_settings
      WHERE company_id = ${companyId}::uuid AND device_id = ${deviceId}::uuid
      ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`;
    return row
      ? {
          deviceId,
          groupId: row.group_id,
          individual: row.individual,
          version: row.version,
        }
      : { deviceId, groupId: null, individual: false, version: 0 };
  }

  async settings(
    companyId: string,
    deviceIds: readonly string[],
  ): Promise<Map<string, SettingRecord>> {
    const found = new Map<string, SettingRecord>();
    if (deviceIds.length === 0) return found;
    const rows = await this.#db.$queryRaw<
      {
        device_id: string;
        group_id: string | null;
        individual: boolean;
        version: number;
      }[]
    >`
      SELECT device_id, group_id, individual, version FROM programming_device_settings
      WHERE company_id = ${companyId}::uuid AND device_id IN (${uuidList(deviceIds)})`;
    for (const row of rows)
      found.set(row.device_id, {
        deviceId: row.device_id,
        groupId: row.group_id,
        individual: row.individual,
        version: row.version,
      });
    return found;
  }

  async writeSetting(
    tx: Prisma.TransactionClient,
    actor: Actor,
    companyId: string,
    current: SettingRecord,
    next: { groupId: string | null; individual: boolean },
    branchIds: readonly string[],
    action = "device.assignment_changed",
  ): Promise<SettingRecord> {
    const [row] =
      current.version === 0
        ? await tx.$queryRaw<{ version: number }[]>`
            INSERT INTO programming_device_settings (company_id, device_id, group_id, individual)
            VALUES (${companyId}::uuid, ${current.deviceId}::uuid, ${next.groupId}::uuid, ${next.individual})
            ON CONFLICT DO NOTHING
            RETURNING version`
        : await tx.$queryRaw<{ version: number }[]>`
            UPDATE programming_device_settings SET group_id = ${next.groupId}::uuid,
              individual = ${next.individual}, version = version + 1,
              updated_at = GREATEST(statement_timestamp(), updated_at + interval '1 millisecond')
            WHERE company_id = ${companyId}::uuid AND device_id = ${current.deviceId}::uuid
              AND version = ${current.version}
            RETURNING version`;
    if (!row) throw new ProgrammingFailure("RESOURCE_VERSION_CONFLICT");
    await this.audit(
      tx,
      companyId,
      actor,
      { type: "device", id: current.deviceId },
      branchIds,
      action,
      {
        fromGroupId: current.groupId,
        toGroupId: next.groupId,
        individual: next.individual,
      },
    );
    return {
      deviceId: current.deviceId,
      groupId: next.groupId,
      individual: next.individual,
      version: row.version,
    };
  }
}
