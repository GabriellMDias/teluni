import type { Readable } from "node:stream";
import type { Prisma } from "../../generated/prisma/client.js";
import type { HumanContext } from "../identity/public.js";
import {
  branchReach,
  decide,
  OrganizationFailure,
  requireCapability,
  type Capability,
  type CompanyAccess,
  type CompanyAccessPort,
} from "../organizations/public.js";
import {
  admitDeclared,
  MediaFailure,
  mediaName,
  mediaPolicy,
  mediaTags,
  reserveBytes,
  type MediaKind,
  type MediaVariant,
} from "./domain.js";
import type {
  Change,
  ListFilter,
  MediaRecord,
  ObjectDescriptor,
  PrismaMediaRepository,
} from "./prisma-repository.js";
import type {
  MediaReference,
  MediaReferenceGuard,
  SelectableMedia,
} from "./public.js";
import { UploadTooLong, type MediaObjectStore } from "./storage.js";

export type MediaView = MediaRecord &
  Readonly<{ branchName: string | null; references?: number }>;

type Cursor = { c: string; p: string; r: string; t: string; i: string };

function encodeCursor(value: Cursor): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

/** Cursors are bound to the company, caller, visible scope and filters. */
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
  throw new MediaFailure("VALIDATION_FAILED");
}

/**
 * Whether the access may see an item: company items through any media
 * grant in the company, branch items through a grant on their branch, and
 * items in the trash only with company-wide deletion authority.
 */
function visible(access: CompanyAccess, item: MediaRecord): boolean {
  if (item.status === "PURGED") return false;
  if (item.status === "DELETED")
    return decide(access, "media.delete") === "allow";
  if (item.branchId === null) {
    const reach = branchReach(access, "media.view");
    return reach === "all" || reach.size > 0;
  }
  return decide(access, "media.view", item.branchId) === "allow";
}

/** Hidden items answer RESOURCE_NOT_FOUND; visible ones explain denials. */
function requireOn(
  access: CompanyAccess,
  capability: Capability,
  item: MediaRecord,
): void {
  if (access.companyStatus === "SUSPENDED")
    throw new OrganizationFailure("COMPANY_SUSPENDED");
  if (!visible(access, item)) throw new MediaFailure("RESOURCE_NOT_FOUND");
  requireCapability(access, capability, item.branchId ?? undefined);
}

export type ListQuery = Readonly<{
  limit: number;
  cursor?: string;
  view?: ListFilter["view"];
  kind?: MediaKind;
  scope?: string;
  tag?: string;
  text?: string;
}>;

/** The media library over the organizations access boundary (ADR-0028). */
export class MediaService {
  readonly #repository: PrismaMediaRepository;
  readonly #companies: CompanyAccessPort;
  readonly #store: MediaObjectStore;
  readonly #guards = new Map<string, MediaReferenceGuard>();
  readonly #wake: () => void;

  constructor(options: {
    repository: PrismaMediaRepository;
    companies: CompanyAccessPort;
    store: MediaObjectStore;
    /** Asks the processor for a prompt pass after an upload commits. */
    wake: () => void;
  }) {
    this.#repository = options.repository;
    this.#companies = options.companies;
    this.#store = options.store;
    this.#wake = options.wake;
  }

  registerReferenceGuard(kind: string, guard: MediaReferenceGuard): void {
    if (this.#guards.has(kind))
      throw new Error("Duplicate media reference guard");
    this.#guards.set(kind, guard);
  }

  async references(
    tx: Prisma.TransactionClient,
    companyId: string,
    assetId: string,
  ): Promise<MediaReference[]> {
    const found: MediaReference[] = [];
    for (const guard of this.#guards.values())
      found.push(...(await guard(tx, companyId, assetId)));
    return found;
  }

  async #requireCapacity(declaredSize: number): Promise<void> {
    const { free, total } = await this.#store.capacity();
    // The original and its rendition may both need room.
    if (free - 2 * declaredSize < reserveBytes(total))
      throw new MediaFailure("MEDIA_STORAGE_FULL");
  }

  async create(
    context: HumanContext,
    companyId: string,
    input: {
      name: string;
      branchId: string | null;
      contentType: string;
      size: number;
      tags?: readonly string[];
    },
  ): Promise<MediaView> {
    const name = mediaName(input.name);
    const tags = mediaTags(input.tags ?? []);
    const declared = admitDeclared(input.contentType, input.size);
    const scope = input.branchId ?? undefined;
    const access = await this.#companies.resolve(context, companyId);
    requireCapability(access, "media.upload", scope);
    await this.#requireCapacity(input.size);
    const created = await this.#repository.transaction(async (tx) => {
      const locked = await this.#companies.lockForWrite(
        tx,
        context,
        companyId,
        input.branchId ? [input.branchId] : [],
      );
      requireCapability(locked.access, "media.upload", scope);
      if (input.branchId && !locked.activeBranchIds.has(input.branchId))
        throw new MediaFailure("VALIDATION_FAILED");
      const usage = await this.#repository.usage(
        tx,
        companyId,
        context.principalId,
      );
      if (
        usage.openByPrincipal >= mediaPolicy.maxOpenUploadsPerPrincipal ||
        usage.openByCompany >= mediaPolicy.maxOpenUploadsPerCompany ||
        usage.createdToday >= mediaPolicy.maxCreationsPerCompanyPerDay ||
        usage.processing >= mediaPolicy.maxProcessingPerCompany
      )
        throw new MediaFailure("RATE_LIMITED");
      return this.#repository.create(
        tx,
        {
          principalId: context.principalId,
          membershipId: locked.access.membershipId,
        },
        {
          companyId,
          branchId: input.branchId,
          name,
          tags,
          kind: declared.kind,
          declaredContentType: input.contentType,
          declaredSize: input.size,
        },
      );
    });
    return (await this.#views(companyId, [created]))[0];
  }

  /**
   * Receives the bytes of an item in UPLOADING. The stream must carry
   * exactly the declared size; anything else leaves the item uploading.
   */
  async upload(
    context: HumanContext,
    companyId: string,
    assetId: string,
    body: Readable,
    contentLength: number | undefined,
  ): Promise<MediaView> {
    const access = await this.#companies.resolve(context, companyId);
    const item = await this.#repository.find(companyId, assetId);
    if (!item) throw new MediaFailure("RESOURCE_NOT_FOUND");
    requireOn(access, "media.upload", item);
    if (item.status !== "UPLOADING")
      throw new MediaFailure("MEDIA_NOT_UPLOADING");
    if (contentLength !== item.declaredSize)
      throw new MediaFailure("MEDIA_UPLOAD_INCOMPLETE");
    await this.#requireCapacity(item.declaredSize);
    let file;
    try {
      file = await this.#store.receive(body, item.declaredSize);
    } catch (error) {
      if (error instanceof UploadTooLong || isStreamFailure(error))
        throw new MediaFailure("MEDIA_UPLOAD_INCOMPLETE");
      throw error;
    }
    if (file.size !== item.declaredSize) {
      await this.#store.removeWork(file.path);
      throw new MediaFailure("MEDIA_UPLOAD_INCOMPLETE");
    }
    try {
      const updated = await this.#repository.transaction(async (tx) => {
        const locked = await this.#companies.lockForWrite(
          tx,
          context,
          companyId,
          item.branchId ? [item.branchId] : [],
        );
        const current = await this.#repository.lock(tx, companyId, assetId);
        if (!current) throw new MediaFailure("RESOURCE_NOT_FOUND");
        requireOn(locked.access, "media.upload", current);
        if (current.status !== "UPLOADING")
          throw new MediaFailure("MEDIA_NOT_UPLOADING");
        return this.#repository.completeUpload(
          tx,
          {
            principalId: context.principalId,
            membershipId: locked.access.membershipId,
          },
          companyId,
          assetId,
          file,
          current.declaredContentType,
        );
      });
      this.#wake();
      return (await this.#views(companyId, [updated]))[0];
    } finally {
      // Published files were moved away; anything left is the work copy.
      await this.#store.removeWork(file.path);
    }
  }

  async list(
    context: HumanContext,
    companyId: string,
    query: ListQuery,
  ): Promise<{ items: MediaView[]; nextCursor: string | null }> {
    const access = await this.#companies.resolve(context, companyId);
    if (access.companyStatus === "SUSPENDED")
      throw new OrganizationFailure("COMPANY_SUSPENDED");
    const view = query.view ?? "library";
    if (view === "trash") requireCapability(access, "media.delete");
    const reach = view === "trash" ? "all" : branchReach(access, "media.view");
    if (reach !== "all" && reach.size === 0)
      requireCapability(access, "media.view");
    if (
      query.scope &&
      query.scope !== "company" &&
      reach !== "all" &&
      !reach.has(query.scope)
    )
      return { items: [], nextCursor: null };
    const tag = query.tag === undefined ? undefined : mediaTags([query.tag])[0];
    const text = query.text?.trim() || undefined;
    const scope = [
      reach === "all" ? "all" : [...reach].sort().join(","),
      view,
      query.kind ?? "",
      query.scope ?? "",
      tag ?? "",
      text ?? "",
    ].join("|");
    const cursor = decodeCursor(query.cursor, {
      company: companyId,
      principal: context.principalId,
      scope,
    });
    const rows = await this.#repository.list(companyId, reach, {
      view,
      limit: query.limit + 1,
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.scope ? { scope: query.scope } : {}),
      ...(tag ? { tag } : {}),
      ...(text ? { text } : {}),
      ...(cursor
        ? { before: { createdAt: new Date(cursor.t), id: cursor.i } }
        : {}),
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: await this.#views(companyId, page),
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

  async get(
    context: HumanContext,
    companyId: string,
    assetId: string,
  ): Promise<MediaView> {
    const access = await this.#companies.resolve(context, companyId);
    if (access.companyStatus === "SUSPENDED")
      throw new OrganizationFailure("COMPANY_SUSPENDED");
    const item = await this.#repository.find(companyId, assetId);
    if (!item || !visible(access, item))
      throw new MediaFailure("RESOURCE_NOT_FOUND");
    return (await this.#views(companyId, [item]))[0];
  }

  /** Authorizes reading one variant and describes the object to stream. */
  async content(
    context: HumanContext,
    companyId: string,
    assetId: string,
    variant: MediaVariant,
  ): Promise<{ item: MediaRecord; object: ObjectDescriptor }> {
    const access = await this.#companies.resolve(context, companyId);
    const item = await this.#repository.find(companyId, assetId);
    if (!item) throw new MediaFailure("RESOURCE_NOT_FOUND");
    requireOn(
      access,
      variant === "original" ? "media.upload" : "media.view",
      item,
    );
    const hash =
      variant === "original"
        ? item.originalSha256
        : variant === "display"
          ? item.displaySha256
          : item.thumbnailSha256;
    if (!hash) throw new MediaFailure("MEDIA_NOT_READY");
    const object = await this.#repository.object(companyId, hash);
    if (!object) throw new MediaFailure("MEDIA_NOT_READY");
    return { item, object };
  }

  openObject(
    companyId: string,
    sha256: Buffer,
    range?: { start: number; end: number },
  ) {
    return this.#store.open(companyId, sha256, range);
  }

  configure(
    context: HumanContext,
    companyId: string,
    assetId: string,
    expectedVersion: number,
    changes: { name?: string; tags?: readonly string[] },
  ): Promise<MediaView> {
    if (changes.name === undefined && changes.tags === undefined)
      throw new MediaFailure("VALIDATION_FAILED");
    const name =
      changes.name === undefined ? undefined : mediaName(changes.name);
    const tags =
      changes.tags === undefined ? undefined : mediaTags(changes.tags);
    return this.#change(
      context,
      companyId,
      assetId,
      expectedVersion,
      "media.upload",
      (current) => {
        if (current.status === "DELETED")
          throw new MediaFailure("MEDIA_INVALID_STATE");
        return {
          kind: "configure",
          ...(name !== undefined ? { name } : {}),
          ...(tags !== undefined ? { tags } : {}),
        };
      },
    );
  }

  archive(
    context: HumanContext,
    companyId: string,
    assetId: string,
    expectedVersion: number,
  ): Promise<MediaView> {
    return this.#change(
      context,
      companyId,
      assetId,
      expectedVersion,
      "media.archive",
      (current) => {
        if (current.status !== "READY")
          throw new MediaFailure("MEDIA_INVALID_STATE");
        return { kind: "archive" };
      },
    );
  }

  restore(
    context: HumanContext,
    companyId: string,
    assetId: string,
    expectedVersion: number,
  ): Promise<MediaView> {
    return this.#change(
      context,
      companyId,
      assetId,
      expectedVersion,
      "media.archive",
      (current) => {
        if (current.status !== "ARCHIVED")
          throw new MediaFailure("MEDIA_INVALID_STATE");
        return { kind: "restore" };
      },
    );
  }

  /** Moves an archived item to the trash unless something protects it. */
  remove(
    context: HumanContext,
    companyId: string,
    assetId: string,
    expectedVersion: number,
  ): Promise<MediaView> {
    return this.#change(
      context,
      companyId,
      assetId,
      expectedVersion,
      "media.delete",
      async (current, tx) => {
        if (current.status !== "ARCHIVED")
          throw new MediaFailure("MEDIA_INVALID_STATE");
        const references = await this.references(tx, companyId, assetId);
        if (references.length > 0) throw new MediaFailure("MEDIA_IN_USE");
        return { kind: "delete" };
      },
    );
  }

  restoreDeleted(
    context: HumanContext,
    companyId: string,
    assetId: string,
    expectedVersion: number,
  ): Promise<MediaView> {
    return this.#change(
      context,
      companyId,
      assetId,
      expectedVersion,
      "media.delete",
      (current) => {
        if (current.status !== "DELETED")
          throw new MediaFailure("MEDIA_INVALID_STATE");
        return { kind: "restoreDeleted" };
      },
    );
  }

  /** Discards an upload that never became usable. */
  async discard(
    context: HumanContext,
    companyId: string,
    assetId: string,
    expectedVersion: number,
  ): Promise<void> {
    await this.#change(
      context,
      companyId,
      assetId,
      expectedVersion,
      "media.upload",
      (current) => {
        if (!["UPLOADING", "REJECTED", "FAILED"].includes(current.status))
          throw new MediaFailure("MEDIA_INVALID_STATE");
        return { kind: "discard" };
      },
    );
  }

  /** The public port's selection of media for a new reference. */
  async requireSelectable(
    tx: Prisma.TransactionClient,
    access: CompanyAccess,
    assetIds: readonly string[],
  ): Promise<SelectableMedia[]> {
    const selected: SelectableMedia[] = [];
    for (const id of [...new Set(assetIds)].sort()) {
      const item = await this.#repository.share(tx, access.companyId, id);
      if (!item || !visible(access, item) || item.status === "DELETED")
        throw new MediaFailure("RESOURCE_NOT_FOUND");
      if (item.status !== "READY" || !item.displaySha256)
        throw new MediaFailure("MEDIA_NOT_READY");
      const display = await this.#repository.object(
        access.companyId,
        item.displaySha256,
      );
      if (!display) throw new MediaFailure("MEDIA_NOT_READY");
      selected.push({
        id: item.id,
        kind: item.kind,
        branchId: item.branchId,
        width: item.width ?? 0,
        height: item.height ?? 0,
        durationMs: item.durationMs,
        hasAudio: item.hasAudio ?? false,
        displaySha256: item.displaySha256.toString("hex"),
        displaySize: display.byteSize,
        displayContentType: display.contentType,
      });
    }
    return selected;
  }

  async #change(
    context: HumanContext,
    companyId: string,
    assetId: string,
    expectedVersion: number,
    capability: Capability,
    decideChange: (
      current: MediaRecord,
      tx: Prisma.TransactionClient,
    ) => Change | Promise<Change>,
  ): Promise<MediaView> {
    const before = await this.#repository.find(companyId, assetId);
    if (!before) throw new MediaFailure("RESOURCE_NOT_FOUND");
    const changed = await this.#repository.transaction(async (tx) => {
      const locked = await this.#companies.lockForWrite(
        tx,
        context,
        companyId,
        before.branchId ? [before.branchId] : [],
      );
      const current = await this.#repository.lock(tx, companyId, assetId);
      if (!current) throw new MediaFailure("RESOURCE_NOT_FOUND");
      requireOn(locked.access, capability, current);
      if (current.version !== expectedVersion)
        throw new MediaFailure("RESOURCE_VERSION_CONFLICT");
      const change = await decideChange(current, tx);
      const { record } = await this.#repository.change(
        tx,
        {
          principalId: context.principalId,
          membershipId: locked.access.membershipId,
        },
        current,
        change,
      );
      return record;
    });
    return (await this.#views(companyId, [changed]))[0];
  }

  async #views(
    companyId: string,
    items: readonly MediaRecord[],
  ): Promise<MediaView[]> {
    const branchIds = [
      ...new Set(
        items
          .map((item) => item.branchId)
          .filter((id): id is string => id !== null),
      ),
    ];
    const description = branchIds.length
      ? await this.#companies.describe(companyId, branchIds)
      : null;
    return items.map((item) => ({
      ...item,
      branchName: item.branchId
        ? (description?.branches.get(item.branchId)?.name ?? "")
        : null,
    }));
  }
}

function isStreamFailure(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return (
    code === "ERR_STREAM_PREMATURE_CLOSE" ||
    code === "ECONNRESET" ||
    code === "ERR_STREAM_DESTROYED"
  );
}
