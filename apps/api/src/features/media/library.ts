import { createHash } from "node:crypto";
import type { Prisma } from "../../generated/prisma/client.js";
import type { HumanContext } from "../identity/public.js";
import {
  branchReach,
  OrganizationFailure,
  requireCapability,
  type CompanyAccess,
  type CompanyAccessPort,
} from "../organizations/public.js";
import { requireOn, scopeVisible, visible } from "./access.js";
import { mediaName, mediaPolicy, MediaFailure } from "./domain.js";
import {
  PrismaMediaLibraryRepository,
  type FolderRecord,
  type LibraryResult,
} from "./library-repository.js";
import type {
  MediaActor,
  MediaRecord,
  PrismaMediaRepository,
} from "./prisma-repository.js";

export type FolderView = FolderRecord & { branchName: string | null };
export type LibraryItem = Readonly<{
  kind: "asset" | "folder";
  id: string;
  expectedVersion: number;
  name?: string;
}>;
export type LibraryCommand = Readonly<{
  operationId: string;
  action: "MOVE" | "COPY";
  destinationFolderId: string | null;
  destinationBranchId?: string | null;
  items: readonly LibraryItem[];
}>;
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest();

/** Folder hierarchy and atomic file-manager commands; no filesystem paths change. */
type LibraryOptions = {
  folders: PrismaMediaLibraryRepository;
  assets: PrismaMediaRepository;
  companies: CompanyAccessPort;
};
export class MediaLibraryService {
  readonly options: LibraryOptions;
  constructor(options: LibraryOptions) {
    this.options = options;
  }

  #visible(
    access: CompanyAccess,
    folder: FolderRecord | null,
  ): asserts folder is FolderRecord {
    if (access.companyStatus === "SUSPENDED")
      throw new OrganizationFailure("COMPANY_SUSPENDED");
    if (!folder || folder.deletedAt || !scopeVisible(access, folder.branchId))
      throw new MediaFailure("RESOURCE_NOT_FOUND");
  }

  async requireFolder(
    tx: Prisma.TransactionClient,
    access: CompanyAccess,
    id: string,
  ) {
    const folder = await this.options.folders.find(access.companyId, id, tx);
    this.#visible(access, folder);
    return folder;
  }

  async validateUploadFolder(
    tx: Prisma.TransactionClient,
    access: CompanyAccess,
    folderId: string,
    branchId: string | null,
  ) {
    await this.options.folders.lock(tx, access.companyId);
    const folder = await this.requireFolder(tx, access, folderId);
    if (folder.branchId !== branchId)
      throw new MediaFailure("MEDIA_SCOPE_MISMATCH");
    await this.options.folders.touch(tx, access.companyId, [folderId]);
  }

  async get(context: HumanContext, companyId: string, id: string) {
    const access = await this.options.companies.resolve(context, companyId);
    return this.options.assets.transaction(async (tx) => {
      const folder = await this.requireFolder(tx, access, id);
      const path = await this.options.folders.path(tx, companyId, id);
      if (
        !path.length ||
        path[0]?.parentId !== null ||
        path.length > mediaPolicy.maxFolderDepth
      )
        throw new MediaFailure("MEDIA_FOLDER_LIMIT");
      const views = await this.#views(companyId, path);
      return {
        folder: views.find((item) => item.id === folder.id)!,
        ancestors: views.slice(0, -1),
      };
    });
  }

  async list(
    context: HumanContext,
    companyId: string,
    query: {
      parentId?: string;
      scope?: string;
      text?: string;
      cursor?: string;
      limit: number;
    },
  ) {
    const access = await this.options.companies.resolve(context, companyId);
    if (access.companyStatus === "SUSPENDED")
      throw new OrganizationFailure("COMPANY_SUSPENDED");
    const reach = branchReach(access, "media.view");
    if (reach !== "all" && !reach.size) requireCapability(access, "media.view");
    if (query.parentId && query.parentId !== "root")
      await this.options.assets.transaction((tx) =>
        this.requireFolder(tx, access, query.parentId!),
      );
    const text = query.text?.trim() || undefined;
    const binding = digest([
      companyId,
      access.membershipId,
      reach === "all" ? "all" : [...reach].sort(),
      query.parentId ?? "root",
      query.scope ?? null,
      text ?? null,
    ]).toString("hex");
    let cursor: { name: string; id: string } | undefined;
    if (query.cursor) {
      try {
        const value: unknown = JSON.parse(
          Buffer.from(query.cursor, "base64url").toString("utf8"),
        );
        if (
          !Array.isArray(value) ||
          value.length !== 3 ||
          value[0] !== binding ||
          typeof value[1] !== "string" ||
          value[1].length > 120 ||
          typeof value[2] !== "string" ||
          !/^[0-9a-f-]{36}$/i.test(value[2])
        )
          throw new Error("cursor");
        cursor = { name: value[1], id: value[2] };
      } catch {
        throw new MediaFailure("VALIDATION_FAILED");
      }
    }
    const rows = await this.options.folders.list(companyId, reach, {
      parentId:
        query.parentId && query.parentId !== "root" ? query.parentId : null,
      ...(query.scope ? { scope: query.scope } : {}),
      ...(text ? { text } : {}),
      ...(cursor ? { cursor } : {}),
      limit: query.limit + 1,
    });
    const page = rows.slice(0, query.limit),
      last = page.at(-1);
    return {
      items: await this.#views(companyId, page),
      nextCursor:
        rows.length > query.limit && last
          ? Buffer.from(JSON.stringify([binding, last.name, last.id])).toString(
              "base64url",
            )
          : null,
    };
  }

  async create(
    context: HumanContext,
    companyId: string,
    input: {
      operationId: string;
      parentId: string | null;
      branchId: string | null;
      name: string;
    },
  ) {
    const name = mediaName(input.name);
    const created = await this.options.assets.transaction(async (tx) => {
      const locked = await this.options.companies.lockForWrite(
        tx,
        context,
        companyId,
        input.branchId ? [input.branchId] : [],
      );
      requireCapability(
        locked.access,
        "media.upload",
        input.branchId ?? undefined,
      );
      if (input.branchId && !locked.activeBranchIds.has(input.branchId))
        throw new MediaFailure("VALIDATION_FAILED");
      await this.options.folders.lock(tx, companyId);
      if (input.parentId) {
        const parent = await this.requireFolder(
          tx,
          locked.access,
          input.parentId,
        );
        if (parent.branchId !== input.branchId)
          throw new MediaFailure("MEDIA_SCOPE_MISMATCH");
        const path = await this.options.folders.path(tx, companyId, parent.id);
        if (path.length >= mediaPolicy.maxFolderDepth)
          throw new MediaFailure("MEDIA_FOLDER_LIMIT");
      }
      const actor = {
        principalId: context.principalId,
        membershipId: locked.access.membershipId,
      };
      const hash = digest([
        "create-folder",
        input.operationId,
        input.parentId,
        input.branchId,
        name,
      ]);
      const receipt = await this.#receipt(
        tx,
        companyId,
        input.operationId,
        actor,
        hash,
      );
      if (receipt) {
        const original = await this.options.folders.find(
          companyId,
          receipt.items[0].id,
          tx,
        );
        if (!original) throw new MediaFailure("RESOURCE_NOT_FOUND");
        return original;
      }
      await this.#capacity(tx, companyId, 1, 0, context.principalId);
      const folder = await this.options.folders.create(tx, actor, {
        companyId,
        branchId: input.branchId,
        parentId: input.parentId,
        name,
      });
      await this.options.folders.touch(tx, companyId, [input.parentId]);
      await this.options.folders.record(
        tx,
        companyId,
        input.operationId,
        actor,
        hash,
        { items: [{ kind: "folder", id: folder.id }], affected: 1 },
      );
      return folder;
    });
    return (await this.#views(companyId, [created]))[0];
  }

  async update(
    context: HumanContext,
    companyId: string,
    id: string,
    input: { expectedVersion: number; name?: string; deleted?: true },
  ) {
    const before = await this.options.folders.find(companyId, id);
    if (!before) throw new MediaFailure("RESOURCE_NOT_FOUND");
    const changed = await this.options.assets.transaction(async (tx) => {
      const locked = await this.options.companies.lockForWrite(
        tx,
        context,
        companyId,
        before.branchId ? [before.branchId] : [],
      );
      await this.options.folders.lock(tx, companyId);
      const folder = await this.requireFolder(tx, locked.access, id);
      requireCapability(
        locked.access,
        "media.upload",
        folder.branchId ?? undefined,
      );
      if (folder.version !== input.expectedVersion)
        throw new MediaFailure("RESOURCE_VERSION_CONFLICT");
      const actor = {
        principalId: context.principalId,
        membershipId: locked.access.membershipId,
      };
      if (input.deleted) {
        if (!(await this.options.folders.empty(tx, folder)))
          throw new MediaFailure("MEDIA_FOLDER_NOT_EMPTY");
        await this.options.folders.touch(tx, companyId, [folder.parentId]);
        return this.options.folders.change(tx, actor, folder, {
          deleted: true,
        });
      }
      const name = mediaName(input.name ?? "");
      return name === folder.name
        ? folder
        : this.options.folders.change(tx, actor, folder, { name });
    });
    return (await this.#views(companyId, [changed]))[0];
  }

  async execute(
    context: HumanContext,
    companyId: string,
    input: LibraryCommand,
  ): Promise<LibraryResult> {
    if (
      !input.items.length ||
      input.items.length > mediaPolicy.maxLibraryItems ||
      new Set(input.items.map((item) => `${item.kind}:${item.id}`)).size !==
        input.items.length
    )
      throw new MediaFailure("VALIDATION_FAILED");
    if (
      input.action === "MOVE" &&
      (input.destinationBranchId !== undefined ||
        input.items.some((item) => item.name !== undefined))
    )
      throw new MediaFailure("VALIDATION_FAILED");
    const beforeAssets = await Promise.all(
      input.items
        .filter((item) => item.kind === "asset")
        .map((item) => this.options.assets.find(companyId, item.id)),
    );
    const beforeFolders = await Promise.all(
      input.items
        .filter((item) => item.kind === "folder")
        .map((item) => this.options.folders.find(companyId, item.id)),
    );
    const beforeDestination = input.destinationFolderId
      ? await this.options.folders.find(companyId, input.destinationFolderId)
      : null;
    const branchIds = [
      ...new Set(
        [...beforeAssets, ...beforeFolders, beforeDestination]
          .flatMap((item) => (item?.branchId ? [item.branchId] : []))
          .concat(input.destinationBranchId ? [input.destinationBranchId] : []),
      ),
    ].sort();
    return this.options.assets.transaction(async (tx) => {
      const locked = await this.options.companies.lockForWrite(
        tx,
        context,
        companyId,
        branchIds,
      );
      await this.options.folders.lock(tx, companyId);
      const access = locked.access;
      if (access.companyStatus === "SUSPENDED")
        throw new OrganizationFailure("COMPANY_SUSPENDED");
      const destination = input.destinationFolderId
        ? await this.requireFolder(tx, access, input.destinationFolderId)
        : null;
      if (
        destination &&
        input.destinationBranchId !== undefined &&
        input.destinationBranchId !== destination.branchId
      )
        throw new MediaFailure("VALIDATION_FAILED");
      const sources = new Map<string, FolderRecord>();
      for (const item of input.items.filter((item) => item.kind === "folder")) {
        const folder = await this.requireFolder(tx, access, item.id);
        sources.set(folder.id, folder);
      }
      const assets = new Map<string, MediaRecord>();
      for (const item of input.items
        .filter((item) => item.kind === "asset")
        .sort((a, b) => a.id.localeCompare(b.id))) {
        const asset = await this.options.assets.read(tx, companyId, item.id);
        if (!asset) throw new MediaFailure("RESOURCE_NOT_FOUND");
        if (input.action === "MOVE") requireOn(access, "media.upload", asset);
        else if (!visible(access, asset))
          throw new MediaFailure("RESOURCE_NOT_FOUND");
        if (input.action === "MOVE" && asset.status === "DELETED")
          throw new MediaFailure("MEDIA_INVALID_STATE");
        assets.set(asset.id, asset);
      }
      const scopeOf = (source: { branchId: string | null }) =>
        destination
          ? destination.branchId
          : input.destinationBranchId !== undefined
            ? input.destinationBranchId
            : source.branchId;
      for (const source of [...sources.values(), ...assets.values()]) {
        const branch = scopeOf(source);
        requireCapability(access, "media.upload", branch ?? undefined);
        if (branch && !locked.activeBranchIds.has(branch))
          throw new MediaFailure("VALIDATION_FAILED");
        if (input.action === "MOVE" && branch !== source.branchId)
          throw new MediaFailure("MEDIA_SCOPE_MISMATCH");
      }
      if (input.action === "MOVE")
        for (const folder of sources.values())
          requireCapability(
            access,
            "media.upload",
            folder.branchId ?? undefined,
          );
      const actor = {
        principalId: context.principalId,
        membershipId: access.membershipId,
      };
      const normalized = {
        operationId: input.operationId,
        action: input.action,
        destinationFolderId: input.destinationFolderId,
        ...(input.destinationBranchId !== undefined
          ? { destinationBranchId: input.destinationBranchId }
          : {}),
        items: input.items.map((item) => ({
          kind: item.kind,
          id: item.id,
          expectedVersion: item.expectedVersion,
          ...(item.name !== undefined ? { name: mediaName(item.name) } : {}),
        })),
      };
      const hash = digest(["library-command", normalized]);
      const replay = await this.#receipt(
        tx,
        companyId,
        input.operationId,
        actor,
        hash,
      );
      if (replay) return replay;
      for (const item of input.items)
        if (
          (item.kind === "folder" ? sources.get(item.id) : assets.get(item.id))
            ?.version !== item.expectedVersion
        )
          throw new MediaFailure("RESOURCE_VERSION_CONFLICT");
      const trees = new Map<string, FolderRecord[]>(),
        allFolders = new Map<string, FolderRecord>();
      const destinationDepth = destination
        ? (await this.options.folders.path(tx, companyId, destination.id))
            .length
        : 0;
      for (const source of sources.values()) {
        const tree = await this.options.folders.tree(tx, companyId, source.id);
        if (destination && tree.some((folder) => folder.id === destination.id))
          throw new MediaFailure("MEDIA_INVALID_DESTINATION");
        for (const folder of tree) {
          if (allFolders.has(folder.id))
            throw new MediaFailure("VALIDATION_FAILED");
          if (folder.branchId !== source.branchId)
            throw new MediaFailure("MEDIA_SCOPE_MISMATCH");
          allFolders.set(folder.id, folder);
        }
        const byId = new Map(tree.map((folder) => [folder.id, folder]));
        for (const folder of tree) {
          let depth = 1,
            current = folder;
          while (
            current.id !== source.id &&
            depth <= mediaPolicy.maxFolderDepth
          ) {
            const parent = current.parentId
              ? byId.get(current.parentId)
              : undefined;
            if (!parent) throw new MediaFailure("MEDIA_FOLDER_LIMIT");
            current = parent;
            depth++;
          }
          if (destinationDepth + depth > mediaPolicy.maxFolderDepth)
            throw new MediaFailure("MEDIA_FOLDER_LIMIT");
        }
        trees.set(source.id, tree);
      }
      for (const asset of assets.values())
        if (asset.folderId && allFolders.has(asset.folderId))
          throw new MediaFailure("VALIDATION_FAILED");
      if (input.action === "COPY") {
        for (const snapshot of await this.options.assets.inFolders(
          tx,
          companyId,
          [...allFolders.keys()],
        )) {
          if (!visible(access, snapshot))
            throw new MediaFailure("RESOURCE_NOT_FOUND");
          assets.set(snapshot.id, snapshot);
        }
        if (assets.size + allFolders.size > mediaPolicy.maxLibraryItems)
          throw new MediaFailure("MEDIA_FOLDER_LIMIT");
        for (const asset of assets.values())
          if (
            !["READY", "ARCHIVED"].includes(asset.status) ||
            !asset.originalSha256 ||
            !asset.displaySha256 ||
            !asset.thumbnailSha256
          )
            throw new MediaFailure("MEDIA_NOT_READY");
        await this.#capacity(
          tx,
          companyId,
          allFolders.size,
          assets.size,
          context.principalId,
        );
      }
      // Lock the complete asset set in the same order as referencing modules.
      for (const snapshot of [...assets.values()].sort((a, b) =>
        a.id.localeCompare(b.id),
      )) {
        const current = await this.options.assets.lock(
          tx,
          companyId,
          snapshot.id,
        );
        if (!current) throw new MediaFailure("RESOURCE_NOT_FOUND");
        if (input.action === "MOVE") requireOn(access, "media.upload", current);
        else if (!visible(access, current))
          throw new MediaFailure("RESOURCE_NOT_FOUND");
        if (current.version !== snapshot.version)
          throw new MediaFailure("RESOURCE_VERSION_CONFLICT");
        assets.set(current.id, current);
      }
      const result: { items: LibraryResult["items"]; affected: number } = {
        items: [],
        affected: 0,
      };
      const touched: (string | null)[] = [input.destinationFolderId];
      if (input.action === "MOVE") {
        for (const folder of sources.values()) {
          if (folder.parentId !== input.destinationFolderId) {
            await this.options.folders.change(tx, actor, folder, {
              parentId: input.destinationFolderId,
            });
            touched.push(folder.parentId);
            result.affected++;
          }
          result.items.push({ kind: "folder", id: folder.id });
        }
        for (const asset of assets.values()) {
          if (asset.folderId !== input.destinationFolderId) {
            await this.options.assets.move(
              tx,
              actor,
              asset,
              input.destinationFolderId,
            );
            touched.push(asset.folderId);
            result.affected++;
          }
          result.items.push({ kind: "asset", id: asset.id });
        }
      } else {
        const copiedFolders = new Map<string, FolderRecord>();
        for (const source of sources.values()) {
          const pending = [...trees.get(source.id)!];
          while (pending.length) {
            const index = pending.findIndex(
              (folder) =>
                folder.id === source.id ||
                (folder.parentId !== null &&
                  copiedFolders.has(folder.parentId)),
            );
            if (index < 0) throw new MediaFailure("MEDIA_INVALID_DESTINATION");
            const folder = pending.splice(index, 1)[0];
            const root = folder.id === source.id;
            const name = root
              ? (normalized.items.find(
                  (item) => item.kind === "folder" && item.id === source.id,
                )?.name ?? folder.name)
              : folder.name;
            const copy = await this.options.folders.create(
              tx,
              actor,
              {
                companyId,
                branchId: scopeOf(source),
                parentId: root
                  ? input.destinationFolderId
                  : copiedFolders.get(folder.parentId!)!.id,
                name,
              },
              folder.id,
            );
            copiedFolders.set(folder.id, copy);
            result.affected++;
            if (root) result.items.push({ kind: "folder", id: copy.id });
          }
        }
        for (const asset of assets.values()) {
          const parent = asset.folderId
            ? copiedFolders.get(asset.folderId)
            : undefined;
          const item = normalized.items.find(
            (item) => item.kind === "asset" && item.id === asset.id,
          );
          const copy = await this.options.assets.copy(tx, actor, asset, {
            folderId: parent?.id ?? input.destinationFolderId,
            branchId: parent ? parent.branchId : scopeOf(asset),
            name: item?.name ?? asset.name,
          });
          result.affected++;
          if (item) result.items.push({ kind: "asset", id: copy.id });
        }
      }
      await this.options.folders.touch(tx, companyId, touched);
      await this.options.folders.record(
        tx,
        companyId,
        input.operationId,
        actor,
        hash,
        result,
      );
      return result;
    });
  }

  async #receipt(
    tx: Prisma.TransactionClient,
    companyId: string,
    id: string,
    actor: NonNullable<MediaActor>,
    hash: Buffer,
  ): Promise<LibraryResult | null> {
    const receipt = await this.options.folders.receipt(tx, companyId, id);
    if (!receipt) return null;
    if (
      receipt.actorMembershipId !== actor.membershipId ||
      !Buffer.from(receipt.requestHash).equals(hash)
    )
      throw new MediaFailure("IDEMPOTENCY_KEY_REUSED");
    return receipt.result as unknown as LibraryResult;
  }

  async #capacity(
    tx: Prisma.TransactionClient,
    companyId: string,
    folders: number,
    assets: number,
    principalId: string,
  ) {
    const count = await this.options.folders.counts(tx, companyId);
    if (count.active + folders > mediaPolicy.maxFolders)
      throw new MediaFailure("MEDIA_FOLDER_LIMIT");
    if (count.today + folders > mediaPolicy.maxFolderCreationsPerDay)
      throw new MediaFailure("RATE_LIMITED");
    if (
      assets &&
      (await this.options.assets.usage(tx, companyId, principalId))
        .createdToday +
        assets >
        mediaPolicy.maxCreationsPerCompanyPerDay
    )
      throw new MediaFailure("RATE_LIMITED");
  }

  async #views(
    companyId: string,
    folders: readonly FolderRecord[],
  ): Promise<FolderView[]> {
    const branchIds = [
      ...new Set(
        folders.flatMap((folder) => (folder.branchId ? [folder.branchId] : [])),
      ),
    ];
    const branches = branchIds.length
      ? (await this.options.companies.describe(companyId, branchIds)).branches
      : null;
    return folders.map((folder) => ({
      ...folder,
      branchName: folder.branchId
        ? (branches?.get(folder.branchId)?.name ?? "")
        : null,
    }));
  }
}
