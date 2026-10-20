import type { Prisma } from "../../generated/prisma/client.js";
import { Temporal } from "temporal-polyfill";
import {
  DeviceFailure,
  type DeviceFacts,
  type DevicePort,
} from "../devices/public.js";
import type { HumanContext } from "../identity/public.js";
import type { MediaFacts, MediaPort } from "../media/public.js";
import {
  branchReach,
  decide,
  isTimeZone,
  OrganizationFailure,
  requireCapability,
  type Capability,
  type CompanyAccess,
  type CompanyAccessPort,
} from "../organizations/public.js";
import {
  checkRules,
  groupName,
  groupSpan,
  itemDurationMs,
  itemList,
  playlistName,
  programmingPolicy,
  ProgrammingFailure,
  transition as normalizeTransition,
  weekdayMask,
  type ItemInput,
  outputKeys,
  type OutputKey,
  type RuleInput,
  type Transition,
} from "./domain.js";
import type {
  Actor,
  GroupRecord,
  ItemRecord,
  PlaylistRecord,
  PrismaProgrammingRepository,
  ProgramRecord,
  ProgramSource,
  SettingRecord,
} from "./prisma-repository.js";
import type {
  ProgramSnapshot,
  ProgramTarget,
  PublicationFacts,
  PublishableRule,
} from "./public.js";
import {
  evaluate,
  findConflicts,
  formatTime,
  ruleIssue,
  TimelineTooLarge,
  type Conflict,
  type ResolutionNote,
  type ScheduleRule,
  type SegmentSource,
} from "./schedule.js";

export type ItemView = Readonly<{
  mediaAssetId: string;
  name: string;
  kind: "IMAGE" | "VIDEO";
  mediaStatus: string;
  durationMs: number | null;
}>;

export type PlaylistView = PlaylistRecord &
  Readonly<{
    branchName: string | null;
    items: readonly ItemView[];
    durationMs: number;
    videoCount: number;
  }>;

export type GroupView = GroupRecord &
  Readonly<{
    branches: readonly { id: string; name: string; timeZone: string }[];
    members: readonly {
      id: string;
      name: string;
      branchId: string;
      branchName: string;
    }[];
  }>;

export type PlaylistSummary = Readonly<{
  id: string;
  name: string;
  durationMs: number;
  itemCount: number;
}>;

export type ProgramView = Readonly<{
  version: number;
  outputs: readonly {
    key: OutputKey;
    defaultPlaylistId: string | null;
    defaultPlaylist: PlaylistSummary | null;
    rules: readonly (ScheduleRule & { playlist: PlaylistSummary | null })[];
  }[];
}>;

export type DeviceProgrammingView = Readonly<{
  device: DeviceFacts & { branchName: string; branchTimeZone: string };
  group: { id: string; name: string } | null;
  individual: boolean;
  source: "group" | "individual";
  version: number;
}>;

export type TimelineView = Readonly<{
  source:
    | { kind: "group"; group: { id: string; name: string } | null }
    | { kind: "individual" };
  timeZone: string;
  segments: readonly {
    start: string;
    end: string;
    localStart: string;
    localEnd: string;
    source: SegmentSource;
    playlist: PlaylistSummary | null;
  }[];
  notes: readonly ResolutionNote[];
}>;

type Cursor = { c: string; p: string; r: string; t: string; i: string };

function encodeCursor(value: Cursor): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeCursor(
  value: string | undefined,
  binding: { company: string; principal: string; scope: string },
): Cursor | undefined {
  if (value === undefined) return undefined;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("encoding");
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<Cursor> | null;
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.c === binding.company &&
      parsed.p === binding.principal &&
      parsed.r === binding.scope &&
      typeof parsed.t === "string" &&
      !Number.isNaN(new Date(parsed.t).getTime()) &&
      typeof parsed.i === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        parsed.i,
      )
    )
      return parsed as Cursor;
  } catch {
    // Malformed cursors answer like foreign ones.
  }
  throw new ProgrammingFailure("VALIDATION_FAILED");
}

function requireActive(access: CompanyAccess): void {
  if (access.companyStatus === "SUSPENDED")
    throw new OrganizationFailure("COMPANY_SUSPENDED");
}

function viewsAnything(access: CompanyAccess): boolean {
  const reach = branchReach(access, "programming.view");
  return reach === "all" || reach.size > 0;
}

/** Company playlists are visible to every viewer; branch ones per branch. */
function playlistVisible(access: CompanyAccess, item: PlaylistRecord): boolean {
  return item.branchId === null
    ? viewsAnything(access)
    : decide(access, "programming.view", item.branchId) === "allow";
}

function requirePlaylist(
  access: CompanyAccess,
  capability: Capability,
  item: PlaylistRecord,
): void {
  requireActive(access);
  if (!playlistVisible(access, item))
    throw new ProgrammingFailure("RESOURCE_NOT_FOUND");
  requireCapability(access, capability, item.branchId ?? undefined);
}

/** A group exists for a caller who may view every branch of its span. */
function groupVisible(
  access: CompanyAccess,
  span: { allBranches: boolean; branchIds: readonly string[] },
): boolean {
  return span.allBranches
    ? decide(access, "programming.view") === "allow"
    : span.branchIds.every(
        (id) => decide(access, "programming.view", id) === "allow",
      );
}

function requireSpan(
  access: CompanyAccess,
  capability: Capability,
  span: { allBranches: boolean; branchIds: readonly string[] },
): void {
  if (span.allBranches) requireCapability(access, capability);
  else
    for (const id of span.branchIds) requireCapability(access, capability, id);
}

function requireGroup(
  access: CompanyAccess,
  capability: Capability,
  group: GroupRecord,
): void {
  requireActive(access);
  if (!groupVisible(access, group))
    throw new ProgrammingFailure("RESOURCE_NOT_FOUND");
  requireSpan(access, capability, group);
}

function requireDevice(
  access: CompanyAccess,
  capability: Capability,
  device: DeviceFacts | undefined,
): DeviceFacts {
  requireActive(access);
  if (
    !device ||
    decide(access, "programming.view", device.branchId) !== "allow"
  )
    throw new ProgrammingFailure("RESOURCE_NOT_FOUND");
  if (device.status !== "ACTIVE") throw new DeviceFailure("DEVICE_UNLINKED");
  requireCapability(access, capability, device.branchId);
  return device;
}

/** Branches a program can reach: "all" for a whole-company group. */
type Reach = "all" | ReadonlySet<string>;

/** Company playlists fit every program; a branch one only that branch. */
function usable(item: PlaylistRecord, reach: Reach): boolean {
  return (
    item.branchId === null ||
    (reach !== "all" && reach.size === 1 && reach.has(item.branchId))
  );
}

const spanReach = (span: {
  allBranches: boolean;
  branchIds: readonly string[];
}): Reach => (span.allBranches ? "all" : new Set(span.branchIds));

const actorOf = (context: HumanContext, access: CompanyAccess): Actor => ({
  principalId: context.principalId,
  membershipId: access.membershipId,
});

export type PlaylistQuery = Readonly<{
  limit: number;
  cursor?: string;
  scope?: string;
  text?: string;
}>;

/** Programming over the organizations, devices and media boundaries. */
export class ProgrammingService {
  readonly #repository: PrismaProgrammingRepository;
  readonly #companies: CompanyAccessPort;
  readonly #devices: DevicePort;
  readonly #media: MediaPort;
  #publicationFacts: PublicationFacts | undefined;

  constructor(options: {
    repository: PrismaProgrammingRepository;
    companies: CompanyAccessPort;
    devices: DevicePort;
    media: MediaPort;
  }) {
    this.#repository = options.repository;
    this.#companies = options.companies;
    this.#devices = options.devices;
    this.#media = options.media;
  }

  // Playlists

  async createPlaylist(
    context: HumanContext,
    companyId: string,
    input: {
      name: string;
      branchId: string | null;
      transition?: Transition;
      fadeMs?: number | null;
    },
  ): Promise<PlaylistView> {
    const name = playlistName(input.name);
    const chosen = normalizeTransition(
      input.transition ?? "CUT",
      input.fadeMs ?? null,
    );
    const scope = input.branchId ?? undefined;
    const access = await this.#companies.resolve(context, companyId);
    requireCapability(access, "programming.edit", scope);
    const created = await this.#repository.transaction(async (tx) => {
      const locked = await this.#companies.lockForWrite(
        tx,
        context,
        companyId,
        input.branchId ? [input.branchId] : [],
      );
      requireCapability(locked.access, "programming.edit", scope);
      if (input.branchId && !locked.activeBranchIds.has(input.branchId))
        throw new ProgrammingFailure("VALIDATION_FAILED");
      const counts = await this.#repository.counts(tx, companyId);
      if (counts.playlists >= programmingPolicy.maxPlaylistsPerCompany)
        throw new ProgrammingFailure("PROGRAMMING_LIMIT_REACHED");
      return this.#repository.createPlaylist(
        tx,
        actorOf(context, locked.access),
        {
          companyId,
          branchId: input.branchId,
          name,
          transition: chosen.kind,
          fadeMs: chosen.fadeMs,
        },
      );
    });
    return (await this.#playlistViews(companyId, [created]))[0];
  }

  async listPlaylists(
    context: HumanContext,
    companyId: string,
    query: PlaylistQuery,
  ): Promise<{ items: PlaylistView[]; nextCursor: string | null }> {
    const access = await this.#companies.resolve(context, companyId);
    requireActive(access);
    const reach = branchReach(access, "programming.view");
    if (reach !== "all" && reach.size === 0)
      requireCapability(access, "programming.view");
    if (
      query.scope &&
      query.scope !== "company" &&
      reach !== "all" &&
      !reach.has(query.scope)
    )
      return { items: [], nextCursor: null };
    const text = query.text?.trim() || undefined;
    const scope = [
      reach === "all" ? "all" : [...reach].sort().join(","),
      query.scope ?? "",
      text ?? "",
    ].join("|");
    const cursor = decodeCursor(query.cursor, {
      company: companyId,
      principal: context.principalId,
      scope,
    });
    const rows = await this.#repository.listPlaylists(companyId, reach, {
      limit: query.limit + 1,
      ...(query.scope ? { scope: query.scope } : {}),
      ...(text ? { text } : {}),
      ...(cursor
        ? { before: { createdAt: new Date(cursor.t), id: cursor.i } }
        : {}),
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: await this.#playlistViews(companyId, page),
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor({
              c: companyId,
              p: context.principalId,
              r: scope,
              t: last.createdAt.toISOString(),
              i: last.id,
            })
          : null,
    };
  }

  async getPlaylist(
    context: HumanContext,
    companyId: string,
    playlistId: string,
  ): Promise<PlaylistView> {
    const access = await this.#companies.resolve(context, companyId);
    requireActive(access);
    const item = await this.#repository.findPlaylist(companyId, playlistId);
    if (!item || !playlistVisible(access, item))
      throw new ProgrammingFailure("RESOURCE_NOT_FOUND");
    return (await this.#playlistViews(companyId, [item]))[0];
  }

  updatePlaylist(
    context: HumanContext,
    companyId: string,
    playlistId: string,
    expectedVersion: number,
    changes: { name?: string; transition?: Transition; fadeMs?: number | null },
  ): Promise<PlaylistView> {
    if (changes.name === undefined && changes.transition === undefined)
      throw new ProgrammingFailure("VALIDATION_FAILED");
    if (changes.transition === undefined && changes.fadeMs !== undefined)
      throw new ProgrammingFailure("VALIDATION_FAILED");
    const name =
      changes.name === undefined ? undefined : playlistName(changes.name);
    const chosen =
      changes.transition === undefined
        ? undefined
        : normalizeTransition(changes.transition, changes.fadeMs ?? null);
    return this.#changePlaylist(
      context,
      companyId,
      playlistId,
      expectedVersion,
      (current, tx, actor) =>
        this.#repository.updatePlaylist(tx, actor, current, {
          ...(name !== undefined ? { name } : {}),
          ...(chosen !== undefined ? { transition: chosen } : {}),
        }),
    );
  }

  /** Replaces the ordered items; new media must be ready and in scope. */
  replaceItems(
    context: HumanContext,
    companyId: string,
    playlistId: string,
    expectedVersion: number,
    input: readonly ItemInput[],
  ): Promise<PlaylistView> {
    const items = itemList(input);
    return this.#changePlaylist(
      context,
      companyId,
      playlistId,
      expectedVersion,
      async (current, tx, actor, access) => {
        const kept = new Set(
          (await this.#repository.lockedItems(tx, companyId, current.id)).map(
            (item) => item.mediaAssetId,
          ),
        );
        const added = [
          ...new Set(
            items
              .map((item) => item.mediaAssetId)
              .filter((id) => !kept.has(id)),
          ),
        ];
        const kinds = new Map<string, "IMAGE" | "VIDEO">();
        for (const selected of await this.#media.requireSelectable(
          tx,
          access,
          added,
        )) {
          if (
            selected.branchId !== null &&
            selected.branchId !== current.branchId
          )
            throw new ProgrammingFailure("PLAYLIST_SCOPE_MISMATCH");
          kinds.set(selected.id, selected.kind);
        }
        const existing = items
          .map((item) => item.mediaAssetId)
          .filter((id) => kept.has(id));
        for (const fact of await this.#media.describe(companyId, existing))
          kinds.set(fact.id, fact.kind);
        return this.#repository.updatePlaylist(tx, actor, current, {
          items: items.map((item) => {
            const kind = kinds.get(item.mediaAssetId);
            if (!kind) throw new ProgrammingFailure("RESOURCE_NOT_FOUND");
            return {
              mediaAssetId: item.mediaAssetId,
              durationMs: itemDurationMs(kind, item.durationSeconds ?? null),
            };
          }),
        });
      },
    );
  }

  async deletePlaylist(
    context: HumanContext,
    companyId: string,
    playlistId: string,
    expectedVersion: number,
  ): Promise<void> {
    await this.#changePlaylist(
      context,
      companyId,
      playlistId,
      expectedVersion,
      async (current, tx, actor) => {
        if (await this.#repository.playlistInUse(tx, companyId, current.id))
          throw new ProgrammingFailure("PLAYLIST_IN_USE");
        await this.#repository.deletePlaylist(tx, actor, current);
        return current;
      },
      { view: false },
    );
  }

  async #changePlaylist(
    context: HumanContext,
    companyId: string,
    playlistId: string,
    expectedVersion: number,
    change: (
      current: PlaylistRecord,
      tx: Prisma.TransactionClient,
      actor: Actor,
      access: CompanyAccess,
    ) => Promise<PlaylistRecord>,
    options: { view?: boolean } = {},
  ): Promise<PlaylistView> {
    const before = await this.#repository.findPlaylist(companyId, playlistId);
    if (!before) throw new ProgrammingFailure("RESOURCE_NOT_FOUND");
    const changed = await this.#repository.transaction(async (tx) => {
      const locked = await this.#companies.lockForWrite(
        tx,
        context,
        companyId,
        before.branchId ? [before.branchId] : [],
      );
      const current = await this.#repository.lockPlaylist(
        tx,
        companyId,
        playlistId,
      );
      if (!current) throw new ProgrammingFailure("RESOURCE_NOT_FOUND");
      requirePlaylist(locked.access, "programming.edit", current);
      if (current.version !== expectedVersion)
        throw new ProgrammingFailure("RESOURCE_VERSION_CONFLICT");
      return change(
        current,
        tx,
        actorOf(context, locked.access),
        locked.access,
      );
    });
    if (options.view === false)
      return {
        ...changed,
        branchName: null,
        items: [],
        durationMs: 0,
        videoCount: 0,
      };
    return (await this.#playlistViews(companyId, [changed]))[0];
  }

  /** Media reference guard: playlist drafts protect their media. */
  mediaReferences = async (
    tx: Prisma.TransactionClient,
    companyId: string,
    assetId: string,
  ) =>
    (await this.#repository.playlistsUsingMedia(tx, companyId, assetId)).map(
      (row) => ({ kind: "playlist-draft", branchId: row.branchId }),
    );

  // Groups

  async createGroup(
    context: HumanContext,
    companyId: string,
    input: { name: string; allBranches: boolean; branchIds: readonly string[] },
  ): Promise<GroupView> {
    const name = groupName(input.name);
    const span = groupSpan(input.allBranches, input.branchIds);
    const access = await this.#companies.resolve(context, companyId);
    requireActive(access);
    requireSpan(access, "programming.edit", span);
    const created = await this.#repository.transaction(async (tx) => {
      const locked = await this.#companies.lockForWrite(
        tx,
        context,
        companyId,
        span.branchIds,
      );
      requireSpan(locked.access, "programming.edit", span);
      if (span.branchIds.some((id) => !locked.activeBranchIds.has(id)))
        throw new ProgrammingFailure("VALIDATION_FAILED");
      const counts = await this.#repository.counts(tx, companyId);
      if (
        counts.groups >= programmingPolicy.maxGroupsPerCompany ||
        counts.programs >= programmingPolicy.maxProgramsPerCompany
      )
        throw new ProgrammingFailure("PROGRAMMING_LIMIT_REACHED");
      return this.#repository.createGroup(tx, actorOf(context, locked.access), {
        companyId,
        name,
        ...span,
      });
    });
    return (await this.#groupViews(companyId, [created]))[0];
  }

  async listGroups(
    context: HumanContext,
    companyId: string,
  ): Promise<GroupView[]> {
    const access = await this.#companies.resolve(context, companyId);
    requireActive(access);
    if (!viewsAnything(access)) requireCapability(access, "programming.view");
    const groups = (await this.#repository.listGroups(companyId)).filter(
      (group) => groupVisible(access, group),
    );
    return this.#groupViews(companyId, groups);
  }

  async getGroup(
    context: HumanContext,
    companyId: string,
    groupId: string,
  ): Promise<GroupView> {
    const { group } = await this.#visibleGroup(context, companyId, groupId);
    return (await this.#groupViews(companyId, [group]))[0];
  }

  async #visibleGroup(
    context: HumanContext,
    companyId: string,
    groupId: string,
  ): Promise<{ group: GroupRecord; access: CompanyAccess }> {
    const access = await this.#companies.resolve(context, companyId);
    requireActive(access);
    const group = await this.#repository.findGroup(companyId, groupId);
    if (!group || !groupVisible(access, group))
      throw new ProgrammingFailure("RESOURCE_NOT_FOUND");
    return { group, access };
  }

  async updateGroup(
    context: HumanContext,
    companyId: string,
    groupId: string,
    expectedVersion: number,
    changes: {
      name?: string;
      allBranches?: boolean;
      branchIds?: readonly string[];
    },
  ): Promise<GroupView> {
    const name =
      changes.name === undefined ? undefined : groupName(changes.name);
    const spanChanged =
      changes.allBranches !== undefined || changes.branchIds !== undefined;
    if (name === undefined && !spanChanged)
      throw new ProgrammingFailure("VALIDATION_FAILED");
    if (spanChanged && changes.allBranches === undefined)
      throw new ProgrammingFailure("VALIDATION_FAILED");
    const span = spanChanged
      ? groupSpan(changes.allBranches as boolean, changes.branchIds ?? [])
      : undefined;
    const before = await this.#repository.findGroup(companyId, groupId);
    if (!before) throw new ProgrammingFailure("RESOURCE_NOT_FOUND");
    const changed = await this.#repository.transaction(async (tx) => {
      const locked = await this.#companies.lockForWrite(
        tx,
        context,
        companyId,
        [...before.branchIds, ...(span?.branchIds ?? [])],
      );
      const current = await this.#repository.lockGroup(
        tx,
        companyId,
        groupId,
        "update",
      );
      if (!current) throw new ProgrammingFailure("RESOURCE_NOT_FOUND");
      requireGroup(locked.access, "programming.edit", current);
      if (current.version !== expectedVersion)
        throw new ProgrammingFailure("RESOURCE_VERSION_CONFLICT");
      if (span) {
        requireSpan(locked.access, "programming.edit", span);
        const added = span.branchIds.filter(
          (id) => !current.branchIds.includes(id),
        );
        if (added.some((id) => !locked.activeBranchIds.has(id)))
          throw new ProgrammingFailure("VALIDATION_FAILED");
        if (!span.allBranches) {
          const members =
            (await this.#repository.members(companyId, [groupId], tx)).get(
              groupId,
            ) ?? [];
          const devices = await this.#devices.describe(tx, companyId, members);
          if (
            devices.some(
              (device) =>
                device.status === "ACTIVE" &&
                !span.branchIds.includes(device.branchId),
            )
          )
            throw new ProgrammingFailure("GROUP_SPAN_EXCLUDES_DEVICE");
        }
        const program = await this.#repository.program(
          companyId,
          { kind: "group", groupId },
          tx,
        );
        await this.#requireUsable(tx, companyId, program, spanReach(span));
      }
      return this.#repository.updateGroup(
        tx,
        actorOf(context, locked.access),
        current,
        {
          ...(name !== undefined ? { name } : {}),
          ...(span ? { span } : {}),
        },
      );
    });
    return (await this.#groupViews(companyId, [changed]))[0];
  }

  async deleteGroup(
    context: HumanContext,
    companyId: string,
    groupId: string,
    expectedVersion: number,
  ): Promise<void> {
    const before = await this.#repository.findGroup(companyId, groupId);
    if (!before) throw new ProgrammingFailure("RESOURCE_NOT_FOUND");
    await this.#repository.transaction(async (tx) => {
      const locked = await this.#companies.lockForWrite(
        tx,
        context,
        companyId,
        before.branchIds,
      );
      const current = await this.#repository.lockGroup(
        tx,
        companyId,
        groupId,
        "update",
      );
      if (!current) throw new ProgrammingFailure("RESOURCE_NOT_FOUND");
      requireGroup(locked.access, "programming.edit", current);
      if (current.version !== expectedVersion)
        throw new ProgrammingFailure("RESOURCE_VERSION_CONFLICT");
      const members =
        (await this.#repository.members(companyId, [groupId], tx)).get(
          groupId,
        ) ?? [];
      if (members.length > 0) throw new ProgrammingFailure("GROUP_HAS_MEMBERS");
      await this.#repository.deleteGroup(
        tx,
        actorOf(context, locked.access),
        current,
      );
    });
  }

  /** The organizations archive guard: explicit spans keep their branches. */
  branchInUse = (
    tx: Prisma.TransactionClient,
    companyId: string,
    branchId: string,
  ) => this.#repository.branchInSpan(tx, companyId, branchId);

  // Programs

  async getProgram(
    context: HumanContext,
    companyId: string,
    source: ProgramSource,
  ): Promise<ProgramView> {
    let access: CompanyAccess;
    if (source.kind === "group")
      ({ access } = await this.#visibleGroup(
        context,
        companyId,
        source.groupId,
      ));
    else {
      access = await this.#companies.resolve(context, companyId);
      const [device] = await this.#devices.describe(null, companyId, [
        source.deviceId,
      ]);
      requireDevice(access, "programming.view", device);
    }
    const program = await this.#repository.program(companyId, source);
    return this.#programView(access, companyId, program);
  }

  /** Read-only validation of a rule set for the panel. */
  async checkRules(
    context: HumanContext,
    companyId: string,
    rules: readonly RuleInput[],
  ): Promise<{
    issues: { index: number; code: "SCHEDULE_TIMES_EQUAL" }[];
    conflicts: Conflict[];
  }> {
    const access = await this.#companies.resolve(context, companyId);
    requireActive(access);
    if (!viewsAnything(access)) requireCapability(access, "programming.view");
    if (rules.length > programmingPolicy.maxRulesPerOutput)
      throw new ProgrammingFailure("PROGRAMMING_LIMIT_REACHED");
    const issues: { index: number; code: "SCHEDULE_TIMES_EQUAL" }[] = [];
    const valid: { index: number; rule: ScheduleRule }[] = [];
    rules.forEach((input, index) => {
      try {
        valid.push({
          index,
          rule: checkRules([input]).rules[0],
        });
      } catch (error) {
        if (
          error instanceof ProgrammingFailure &&
          error.code === "SCHEDULE_TIMES_EQUAL"
        )
          issues.push({ index, code: "SCHEDULE_TIMES_EQUAL" });
        else throw error;
      }
    });
    const conflicts = findConflicts(valid.map((entry) => entry.rule)).map(
      (conflict) => ({
        first: valid[conflict.first].index,
        second: valid[conflict.second].index,
        date: conflict.date,
      }),
    );
    return { issues, conflicts };
  }

  async replaceOutput(
    context: HumanContext,
    companyId: string,
    source: ProgramSource,
    outputKey: OutputKey,
    expectedVersion: number,
    input: { defaultPlaylistId: string | null; rules: readonly RuleInput[] },
  ): Promise<ProgramView> {
    const { rules, conflicts } = checkRules(input.rules);
    if (conflicts.length > 0) throw new ProgrammingFailure("SCHEDULE_CONFLICT");
    const before =
      source.kind === "group"
        ? await this.#repository.findGroup(companyId, source.groupId)
        : null;
    const [beforeDevice] =
      source.kind === "device"
        ? await this.#devices.describe(null, companyId, [source.deviceId])
        : [];
    if (source.kind === "group" && !before)
      throw new ProgrammingFailure("RESOURCE_NOT_FOUND");
    if (source.kind === "device" && !beforeDevice)
      throw new ProgrammingFailure("RESOURCE_NOT_FOUND");
    const branchIds = before?.branchIds ?? [beforeDevice.branchId];
    const program = await this.#repository.transaction(async (tx) => {
      const locked = await this.#companies.lockForWrite(
        tx,
        context,
        companyId,
        branchIds,
      );
      let reach: Reach;
      let concerned: readonly string[];
      if (source.kind === "group") {
        const group = await this.#repository.lockGroup(
          tx,
          companyId,
          source.groupId,
          "share",
        );
        if (!group) throw new ProgrammingFailure("RESOURCE_NOT_FOUND");
        requireGroup(locked.access, "programming.edit", group);
        reach = spanReach(group);
        concerned = group.branchIds;
      } else {
        const [device] = await this.#devices.describe(tx, companyId, [
          source.deviceId,
        ]);
        const found = requireDevice(locked.access, "programming.edit", device);
        reach = new Set([found.branchId]);
        concerned = [found.branchId];
      }
      const current = await this.#repository.program(
        companyId,
        source,
        tx,
        true,
      );
      if ((current?.version ?? 0) !== expectedVersion)
        throw new ProgrammingFailure("RESOURCE_VERSION_CONFLICT");
      if (!current) {
        const counts = await this.#repository.counts(tx, companyId);
        if (counts.programs >= programmingPolicy.maxProgramsPerCompany)
          throw new ProgrammingFailure("PROGRAMMING_LIMIT_REACHED");
      }
      const referenced = [
        ...rules.map((rule) => rule.playlistId),
        ...(input.defaultPlaylistId ? [input.defaultPlaylistId] : []),
      ];
      await this.#requirePlaylists(tx, companyId, referenced, reach);
      const saved = await this.#repository.replaceOutput(
        tx,
        actorOf(context, locked.access),
        companyId,
        source,
        concerned,
        current,
        outputKey,
        {
          defaultPlaylistId: input.defaultPlaylistId,
          rules: rules.map((rule) => ({
            playlistId: rule.playlistId,
            weekdays: rule.weekdays,
            weekdayMask: weekdayMask(rule.weekdays),
            allDay: rule.allDay,
            startMinute: rule.startMinute,
            endMinute: rule.endMinute,
            startsOn: rule.startsOn,
            endsOn: rule.endsOn,
          })),
        },
      );
      return { saved, access: locked.access };
    });
    return this.#programView(program.access, companyId, program.saved);
  }

  async #requirePlaylists(
    tx: Prisma.TransactionClient,
    companyId: string,
    playlistIds: readonly string[],
    reach: Reach,
  ): Promise<void> {
    const unique = [...new Set(playlistIds)];
    const found = await this.#repository.sharePlaylists(tx, companyId, unique);
    if (found.length !== unique.length)
      throw new ProgrammingFailure("RESOURCE_NOT_FOUND");
    if (found.some((item) => !usable(item, reach)))
      throw new ProgrammingFailure("PLAYLIST_SCOPE_MISMATCH");
  }

  async #requireUsable(
    tx: Prisma.TransactionClient,
    companyId: string,
    program: ProgramRecord | null,
    reach: Reach,
  ): Promise<void> {
    if (!program) return;
    const ids = [...program.outputs.values()].flatMap((output) => [
      ...output.rules.map((rule) => rule.playlistId),
      ...(output.defaultPlaylistId ? [output.defaultPlaylistId] : []),
    ]);
    await this.#requirePlaylists(tx, companyId, ids, reach);
  }

  // Screen programming

  async getDeviceProgramming(
    context: HumanContext,
    companyId: string,
    deviceId: string,
  ): Promise<DeviceProgrammingView> {
    const access = await this.#companies.resolve(context, companyId);
    const [device] = await this.#devices.describe(null, companyId, [deviceId]);
    const found = requireDevice(access, "programming.view", device);
    const setting = await this.#repository.setting(companyId, deviceId);
    return this.#deviceView(access, companyId, found, setting);
  }

  async assign(
    context: HumanContext,
    companyId: string,
    deviceId: string,
    input: {
      expectedVersion: number;
      groupId: string | null;
      individual: boolean;
      confirmUnpublished: boolean;
    },
  ): Promise<DeviceProgrammingView> {
    if (input.groupId === null && input.individual)
      throw new ProgrammingFailure("VALIDATION_FAILED");
    const [beforeDevice] = await this.#devices.describe(null, companyId, [
      deviceId,
    ]);
    if (!beforeDevice) throw new ProgrammingFailure("RESOURCE_NOT_FOUND");
    const target = input.groupId
      ? await this.#repository.findGroup(companyId, input.groupId)
      : null;
    if (input.groupId && !target)
      throw new ProgrammingFailure("RESOURCE_NOT_FOUND");
    const result = await this.#repository.transaction(async (tx) => {
      const locked = await this.#companies.lockForWrite(
        tx,
        context,
        companyId,
        [beforeDevice.branchId, ...(target?.branchIds ?? [])],
      );
      const [device] = await this.#devices.describe(tx, companyId, [deviceId]);
      const found = requireDevice(locked.access, "programming.assign", device);
      const current = await this.#repository.setting(
        companyId,
        deviceId,
        tx,
        true,
      );
      if (current.version !== input.expectedVersion)
        throw new ProgrammingFailure("RESOURCE_VERSION_CONFLICT");
      if (input.groupId && input.groupId !== current.groupId) {
        const group = await this.#repository.lockGroup(
          tx,
          companyId,
          input.groupId,
          "share",
        );
        if (!group) throw new ProgrammingFailure("RESOURCE_NOT_FOUND");
        requireGroup(locked.access, "programming.assign", group);
        if (!group.allBranches && !group.branchIds.includes(found.branchId))
          throw new ProgrammingFailure("GROUP_SPAN_EXCLUDES_DEVICE");
      }
      // A destination without a publication shows neutral output until it
      // is published, which the person must confirm.
      const destination: ProgramSource =
        input.groupId && !input.individual
          ? { kind: "group", groupId: input.groupId }
          : { kind: "device", deviceId };
      const programId = await this.#repository.programId(
        companyId,
        destination,
        tx,
      );
      const published =
        programId !== null && this.#publicationFacts
          ? await this.#publicationFacts(tx, companyId, programId)
          : false;
      if (!published && !input.confirmUnpublished)
        throw new ProgrammingFailure("ASSIGNMENT_CONFIRMATION_REQUIRED");
      const setting = await this.#repository.writeSetting(
        tx,
        actorOf(context, locked.access),
        companyId,
        current,
        { groupId: input.groupId, individual: input.individual },
        [found.branchId],
      );
      return { device: found, setting, access: locked.access };
    });
    return this.#deviceView(
      result.access,
      companyId,
      result.device,
      result.setting,
    );
  }

  /** The devices move hook: a screen leaves a group that no longer spans it. */
  onDeviceMoved = async (
    tx: Prisma.TransactionClient,
    move: {
      companyId: string;
      deviceId: string;
      branchId: string;
      actor: Actor;
    },
  ): Promise<void> => {
    const setting = await this.#repository.setting(
      move.companyId,
      move.deviceId,
      tx,
      true,
    );
    if (!setting.groupId) return;
    const group = await this.#repository.lockGroup(
      tx,
      move.companyId,
      setting.groupId,
      "share",
    );
    if (!group || group.allBranches || group.branchIds.includes(move.branchId))
      return;
    await this.#repository.writeSetting(
      tx,
      move.actor,
      move.companyId,
      setting,
      { groupId: null, individual: false },
      [move.branchId],
      "device.left_group_on_move",
    );
  };

  // Publication collaboration (the public port)

  onPublicationFacts(facts: PublicationFacts): void {
    this.#publicationFacts = facts;
  }

  async #publicationTarget(
    tx: Prisma.TransactionClient | null,
    access: CompanyAccess,
    source: ProgramSource,
    capability: Capability,
  ): Promise<ProgramTarget & { program: ProgramRecord | null }> {
    const companyId = access.companyId;
    let reach: Reach;
    let branchIds: readonly string[];
    if (source.kind === "group") {
      const group = tx
        ? await this.#repository.lockGroup(
            tx,
            companyId,
            source.groupId,
            "share",
          )
        : await this.#repository.findGroup(companyId, source.groupId);
      if (!group) throw new ProgrammingFailure("RESOURCE_NOT_FOUND");
      requireGroup(access, capability, group);
      reach = spanReach(group);
      branchIds = group.branchIds;
    } else {
      const [device] = await this.#devices.describe(tx, companyId, [
        source.deviceId,
      ]);
      const found = requireDevice(access, capability, device);
      reach = new Set([found.branchId]);
      branchIds = [found.branchId];
    }
    const program = await this.#repository.program(
      companyId,
      source,
      tx ?? undefined,
      tx ? "share" : false,
    );
    return {
      programId: program?.id ?? null,
      programVersion: program?.version ?? 0,
      reach: reach === "all" ? "all" : [...reach],
      branchIds,
      program,
    };
  }

  async publicationTarget(
    tx: Prisma.TransactionClient | null,
    access: CompanyAccess,
    source: ProgramSource,
    capability: Capability,
  ): Promise<ProgramTarget> {
    const target = await this.#publicationTarget(
      tx,
      access,
      source,
      capability,
    );
    return {
      programId: target.programId,
      programVersion: target.programVersion,
      reach: target.reach,
      branchIds: target.branchIds,
    };
  }

  async publicationSnapshot(
    tx: Prisma.TransactionClient,
    access: CompanyAccess,
    source: ProgramSource,
    capability: Capability,
  ): Promise<ProgramSnapshot> {
    const { program, ...target } = await this.#publicationTarget(
      tx,
      access,
      source,
      capability,
    );
    const outputs = outputKeys.flatMap((key) => {
      const output = program?.outputs.get(key);
      return output ? [{ key, output }] : [];
    });
    const playlistIds = [
      ...new Set(
        outputs.flatMap(({ output }) => [
          ...output.rules.map((rule) => rule.playlistId),
          ...(output.defaultPlaylistId ? [output.defaultPlaylistId] : []),
        ]),
      ),
    ];
    const playlists = await this.#repository.sharePlaylists(
      tx,
      access.companyId,
      playlistIds,
    );
    const items = await this.#repository.items(
      access.companyId,
      playlistIds,
      tx,
    );
    const reach: Reach = target.reach === "all" ? "all" : new Set(target.reach);
    return {
      ...target,
      outputs: outputs.map(({ key, output }) => ({
        key,
        defaultPlaylistId: output.defaultPlaylistId,
        rules: output.rules.map(publishableRule),
        valid:
          output.rules.every((rule) => ruleIssue(rule) === null) &&
          findConflicts(output.rules).length === 0,
      })),
      playlists: playlists.map((item) => ({
        id: item.id,
        branchId: item.branchId,
        transition: item.transition,
        fadeMs: item.fadeMs,
        usable: usable(item, reach),
        items: (items.get(item.id) ?? []).map((entry) => ({
          mediaAssetId: entry.mediaAssetId,
          durationMs: entry.durationMs,
        })),
      })),
    };
  }

  async currentProgram(
    companyId: string,
    deviceId: string,
  ): Promise<{ source: "group" | "individual"; programId: string | null }> {
    const setting = await this.#repository.setting(companyId, deviceId);
    const source: ProgramSource =
      setting.groupId && !setting.individual
        ? { kind: "group", groupId: setting.groupId }
        : { kind: "device", deviceId };
    return {
      source: source.kind === "group" ? "group" : "individual",
      programId: await this.#repository.programId(companyId, source),
    };
  }

  async followers(companyId: string, source: ProgramSource): Promise<string[]> {
    let candidates: string[];
    if (source.kind === "group")
      candidates = await this.#repository.groupFollowers(
        companyId,
        source.groupId,
      );
    else {
      const setting = await this.#repository.setting(
        companyId,
        source.deviceId,
      );
      candidates =
        setting.groupId && !setting.individual ? [] : [source.deviceId];
    }
    const screens = await this.#devices.describe(null, companyId, candidates);
    return screens
      .filter((screen) => screen.status === "ACTIVE")
      .map((screen) => screen.id)
      .sort();
  }

  // Timelines

  async deviceTimeline(
    context: HumanContext,
    companyId: string,
    deviceId: string,
    range: { from: string; to: string },
  ): Promise<TimelineView> {
    const { from, to } = timelineRange(range);
    const access = await this.#companies.resolve(context, companyId);
    const [device] = await this.#devices.describe(null, companyId, [deviceId]);
    const found = requireDevice(access, "programming.view", device);
    const setting = await this.#repository.setting(companyId, deviceId);
    const view = await this.#deviceView(access, companyId, found, setting);
    // The screen plays its group's program even when the caller may not see
    // the whole group; the group's identity then stays hidden.
    const groupId =
      view.source === "group" ? (setting.groupId ?? undefined) : undefined;
    const program = await this.#repository.program(
      companyId,
      groupId ? { kind: "group", groupId } : { kind: "device", deviceId },
    );
    const zone = found.timeZone ?? view.device.branchTimeZone;
    return this.#timeline(
      access,
      companyId,
      program,
      zone,
      from,
      to,
      groupId ? { kind: "group", group: view.group } : { kind: "individual" },
    );
  }

  async groupTimeline(
    context: HumanContext,
    companyId: string,
    groupId: string,
    range: { from: string; to: string; timeZone: string },
  ): Promise<TimelineView> {
    const { from, to } = timelineRange(range);
    if (!isTimeZone(range.timeZone))
      throw new ProgrammingFailure("VALIDATION_FAILED");
    const { group, access } = await this.#visibleGroup(
      context,
      companyId,
      groupId,
    );
    const program = await this.#repository.program(companyId, {
      kind: "group",
      groupId,
    });
    return this.#timeline(
      access,
      companyId,
      program,
      range.timeZone,
      from,
      to,
      {
        kind: "group",
        group: { id: group.id, name: group.name },
      },
    );
  }

  async #timeline(
    access: CompanyAccess,
    companyId: string,
    program: ProgramRecord | null,
    zone: string,
    from: Temporal.Instant,
    to: Temporal.Instant,
    source: TimelineView["source"],
  ): Promise<TimelineView> {
    const output = program?.outputs.get("screen") ?? {
      defaultPlaylistId: null,
      rules: [],
    };
    let timeline;
    try {
      timeline = evaluate(
        output,
        zone,
        from,
        to,
        programmingPolicy.maxTimelineSegments,
      );
    } catch (error) {
      if (error instanceof TimelineTooLarge)
        throw new ProgrammingFailure("TIMELINE_TOO_LARGE");
      throw error;
    }
    const summaries = await this.#summaries(
      access,
      companyId,
      timeline.segments.flatMap((segment) =>
        segment.source.kind === "none" ? [] : [segment.source.playlistId],
      ),
    );
    return {
      source,
      timeZone: zone,
      segments: timeline.segments.map((segment) => ({
        ...segment,
        playlist:
          segment.source.kind === "none"
            ? null
            : (summaries.get(segment.source.playlistId) ?? null),
      })),
      notes: timeline.notes,
    };
  }

  // Views

  async #playlistViews(
    companyId: string,
    playlists: readonly PlaylistRecord[],
  ): Promise<PlaylistView[]> {
    const items = await this.#repository.items(
      companyId,
      playlists.map((item) => item.id),
    );
    const facts = await this.#mediaFacts(companyId, [...items.values()].flat());
    const branchIds = [
      ...new Set(
        playlists
          .map((item) => item.branchId)
          .filter((id): id is string => id !== null),
      ),
    ];
    const description = branchIds.length
      ? await this.#companies.describe(companyId, branchIds)
      : null;
    return playlists.map((item) => {
      const views = (items.get(item.id) ?? []).map((entry) =>
        itemView(entry, facts.get(entry.mediaAssetId)),
      );
      return {
        ...item,
        branchName: item.branchId
          ? (description?.branches.get(item.branchId)?.name ?? "")
          : null,
        items: views,
        durationMs: views.reduce(
          (sum, entry) => sum + (entry.durationMs ?? 0),
          0,
        ),
        videoCount: views.filter((entry) => entry.kind === "VIDEO").length,
      };
    });
  }

  async #mediaFacts(
    companyId: string,
    items: readonly ItemRecord[],
  ): Promise<Map<string, MediaFacts>> {
    const facts = await this.#media.describe(companyId, [
      ...new Set(items.map((item) => item.mediaAssetId)),
    ]);
    return new Map(facts.map((fact) => [fact.id, fact]));
  }

  /**
   * Summaries of the referenced playlists the caller may see. A screen's own
   * program can keep playlists of its previous branch after a move; those
   * stay unresolved for a caller without access to that branch.
   */
  async #summaries(
    access: CompanyAccess,
    companyId: string,
    playlistIds: readonly string[],
  ): Promise<Map<string, PlaylistSummary>> {
    const unique = [...new Set(playlistIds)];
    const playlists = (
      await this.#repository.findPlaylists(companyId, unique)
    ).filter((playlist) => playlistVisible(access, playlist));
    const views = await this.#playlistViews(companyId, playlists);
    return new Map(
      views.map((view) => [
        view.id,
        {
          id: view.id,
          name: view.name,
          durationMs: view.durationMs,
          itemCount: view.items.length,
        },
      ]),
    );
  }

  async #programView(
    access: CompanyAccess,
    companyId: string,
    program: ProgramRecord | null,
  ): Promise<ProgramView> {
    const outputs: ProgramRecord["outputs"] = program?.outputs ?? new Map();
    const referenced = [...outputs.values()].flatMap((output) => [
      ...output.rules.map((rule) => rule.playlistId),
      ...(output.defaultPlaylistId ? [output.defaultPlaylistId] : []),
    ]);
    const summaries = await this.#summaries(access, companyId, referenced);
    const screen = outputs.get("screen") ?? {
      defaultPlaylistId: null,
      rules: [],
    };
    return {
      version: program?.version ?? 0,
      outputs: [
        {
          key: "screen",
          defaultPlaylistId: screen.defaultPlaylistId,
          defaultPlaylist: screen.defaultPlaylistId
            ? (summaries.get(screen.defaultPlaylistId) ?? null)
            : null,
          rules: screen.rules.map((rule) => ({
            ...rule,
            playlist: summaries.get(rule.playlistId) ?? null,
          })),
        },
      ],
    };
  }

  async #groupViews(
    companyId: string,
    groups: readonly GroupRecord[],
  ): Promise<GroupView[]> {
    const members = await this.#repository.members(
      companyId,
      groups.map((group) => group.id),
    );
    const deviceIds = [...members.values()].flat();
    const devices = new Map(
      (await this.#devices.describe(null, companyId, deviceIds)).map(
        (device) => [device.id, device],
      ),
    );
    const branchIds = [
      ...new Set([
        ...groups.flatMap((group) => group.branchIds),
        ...[...devices.values()].map((device) => device.branchId),
      ]),
    ];
    const description = branchIds.length
      ? await this.#companies.describe(companyId, branchIds)
      : null;
    return groups.map((group) => ({
      ...group,
      branches: group.branchIds.map((id) => ({
        id,
        name: description?.branches.get(id)?.name ?? "",
        timeZone: description?.branches.get(id)?.timeZone ?? "UTC",
      })),
      members: (members.get(group.id) ?? []).flatMap((id) => {
        const device = devices.get(id);
        return device && device.status === "ACTIVE"
          ? [
              {
                id,
                name: device.name,
                branchId: device.branchId,
                branchName:
                  description?.branches.get(device.branchId)?.name ?? "",
              },
            ]
          : [];
      }),
    }));
  }

  /**
   * A screen's programming source. The group stays hidden (null) from a
   * caller who cannot see every branch of its span, though the source
   * still says the screen follows a group.
   */
  async #deviceView(
    access: CompanyAccess,
    companyId: string,
    device: DeviceFacts,
    setting: SettingRecord,
  ): Promise<DeviceProgrammingView> {
    const description = await this.#companies.describe(companyId, [
      device.branchId,
    ]);
    const branch = description.branches.get(device.branchId);
    const group = setting.groupId
      ? await this.#repository.findGroup(companyId, setting.groupId)
      : null;
    return {
      device: {
        ...device,
        branchName: branch?.name ?? "",
        branchTimeZone: branch?.timeZone ?? "UTC",
      },
      group:
        group && groupVisible(access, group)
          ? { id: group.id, name: group.name }
          : null,
      individual: setting.individual,
      source: group && !setting.individual ? "group" : "individual",
      version: setting.version,
    };
  }
}

/** A stored rule in the shared fixtures' representation, numbered from 1. */
function publishableRule(rule: ScheduleRule, index: number): PublishableRule {
  return {
    id: `r${index + 1}`,
    playlistId: rule.playlistId,
    weekdays: [...rule.weekdays],
    allDay: rule.allDay,
    ...(rule.allDay
      ? {}
      : {
          startTime: formatTime(rule.startMinute!),
          endTime: formatTime(rule.endMinute!),
        }),
    startsOn: rule.startsOn,
    endsOn: rule.endsOn,
  };
}

function itemView(item: ItemRecord, fact: MediaFacts | undefined): ItemView {
  return {
    mediaAssetId: item.mediaAssetId,
    name: fact?.name ?? "",
    kind: fact?.kind ?? "IMAGE",
    mediaStatus: fact?.status ?? "PURGED",
    durationMs: item.durationMs ?? fact?.durationMs ?? null,
  };
}

/** Parses a timeline range: ordered instants at most 31 days apart. */
function timelineRange(range: { from: string; to: string }): {
  from: Temporal.Instant;
  to: Temporal.Instant;
} {
  let from: Temporal.Instant;
  let to: Temporal.Instant;
  try {
    from = Temporal.Instant.from(range.from);
    to = Temporal.Instant.from(range.to);
  } catch {
    throw new ProgrammingFailure("VALIDATION_FAILED");
  }
  const span = Number(to.epochMilliseconds - from.epochMilliseconds);
  if (span <= 0 || span > programmingPolicy.maxTimelineDays * 86_400_000)
    throw new ProgrammingFailure("VALIDATION_FAILED");
  return { from, to };
}
