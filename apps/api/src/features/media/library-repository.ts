import { randomUUID } from "node:crypto";
import type { Database } from "../../database.js";
import { Prisma, type MediaFolder } from "../../generated/prisma/client.js";
import type { MediaActor } from "./prisma-repository.js";

export type FolderRecord = MediaFolder;
export type LibraryResult = Readonly<{
  items: { kind: "asset" | "folder"; id: string }[];
  affected: number;
}>;
export type FolderFilter = Readonly<{
  parentId: string | null;
  scope?: string;
  text?: string;
  cursor?: { name: string; id: string };
  limit: number;
}>;

/** Folder metadata and command receipts; bytes remain in the asset repository. */
export class PrismaMediaLibraryRepository {
  readonly database: Database;
  constructor(database: Database) {
    this.database = database;
  }

  /** Organization locks precede this lock; asset and object locks follow it. */
  async lock(tx: Prisma.TransactionClient, companyId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`media-library:${companyId}`}, 0))`;
  }

  find(
    companyId: string,
    id: string,
    tx = this.database as Prisma.TransactionClient,
  ) {
    return tx.mediaFolder.findFirst({
      where: { companyId, id, deletedAt: null },
    });
  }

  list(
    companyId: string,
    reach: "all" | ReadonlySet<string>,
    filter: FolderFilter,
  ) {
    return this.database.mediaFolder.findMany({
      where: {
        companyId,
        deletedAt: null,
        // A search is global within the caller's visible scope.
        ...(filter.text
          ? { name: { contains: filter.text, mode: "insensitive" as const } }
          : { parentId: filter.parentId }),
        ...(filter.scope
          ? { branchId: filter.scope === "company" ? null : filter.scope }
          : {}),
        AND: [
          ...(reach === "all"
            ? []
            : [{ OR: [{ branchId: null }, { branchId: { in: [...reach] } }] }]),
          ...(filter.cursor
            ? [
                {
                  OR: [
                    { name: { gt: filter.cursor.name } },
                    { name: filter.cursor.name, id: { gt: filter.cursor.id } },
                  ],
                },
              ]
            : []),
        ],
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: filter.limit,
    });
  }

  async path(
    tx: Prisma.TransactionClient,
    companyId: string,
    id: string,
  ): Promise<FolderRecord[]> {
    return tx.$queryRaw<FolderRecord[]>`
      WITH RECURSIVE ancestors AS (
        SELECT id, parent_id, 0 AS depth, ARRAY[id] AS visited FROM media_folders
        WHERE company_id = ${companyId}::uuid AND id = ${id}::uuid AND deleted_at IS NULL
        UNION ALL
        SELECT p.id, p.parent_id, a.depth + 1, a.visited || p.id
        FROM media_folders p JOIN ancestors a ON p.id = a.parent_id
        WHERE p.company_id = ${companyId}::uuid AND p.deleted_at IS NULL
          AND a.depth < 12 AND NOT p.id = ANY(a.visited)
      ) SELECT f.id, f.company_id AS "companyId", f.branch_id AS "branchId", f.parent_id AS "parentId", f.name,
        f.created_by_membership_id AS "createdByMembershipId", f.created_at AS "createdAt", f.updated_at AS "updatedAt", f.deleted_at AS "deletedAt", f.version
        FROM ancestors a JOIN media_folders f ON f.id = a.id AND f.company_id = ${companyId}::uuid ORDER BY a.depth DESC`;
  }

  async tree(
    tx: Prisma.TransactionClient,
    companyId: string,
    id: string,
  ): Promise<FolderRecord[]> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      WITH RECURSIVE descendants AS (
        SELECT id, 1 AS depth, ARRAY[id] AS visited FROM media_folders
        WHERE company_id = ${companyId}::uuid AND id = ${id}::uuid AND deleted_at IS NULL
        UNION ALL
        SELECT f.id, d.depth + 1, d.visited || f.id
        FROM media_folders f JOIN descendants d ON f.parent_id = d.id
        WHERE f.company_id = ${companyId}::uuid AND f.deleted_at IS NULL
          AND d.depth < 12 AND NOT f.id = ANY(d.visited)
      ) SELECT id FROM descendants LIMIT 2001`;
    return tx.mediaFolder.findMany({
      where: {
        companyId,
        id: { in: rows.map((row) => row.id) },
        deletedAt: null,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
  }

  async counts(tx: Prisma.TransactionClient, companyId: string) {
    const [row] = await tx.$queryRaw<{ active: bigint; today: bigint }[]>`
      SELECT count(*) FILTER (WHERE deleted_at IS NULL) AS active,
        count(*) FILTER (WHERE created_at >= date_trunc('day', statement_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS today
      FROM media_folders WHERE company_id = ${companyId}::uuid`;
    return { active: Number(row?.active ?? 0), today: Number(row?.today ?? 0) };
  }

  async create(
    tx: Prisma.TransactionClient,
    actor: NonNullable<MediaActor>,
    input: {
      companyId: string;
      branchId: string | null;
      parentId: string | null;
      name: string;
    },
    sourceId?: string,
  ) {
    const folder = await tx.mediaFolder.create({
      data: {
        id: randomUUID(),
        ...input,
        createdByMembershipId: actor.membershipId,
      },
    });
    await this.audit(tx, actor, folder, "media.folder_created", {
      parentId: input.parentId,
      branchId: input.branchId,
      ...(sourceId ? { copiedFromFolderId: sourceId } : {}),
    });
    return folder;
  }

  async change(
    tx: Prisma.TransactionClient,
    actor: NonNullable<MediaActor>,
    folder: FolderRecord,
    change: { name: string } | { parentId: string | null } | { deleted: true },
  ) {
    const name = "name" in change ? change.name : folder.name;
    const parentId = "parentId" in change ? change.parentId : folder.parentId;
    await tx.$executeRaw`UPDATE media_folders SET name = ${name}, parent_id = ${parentId}::uuid,
      deleted_at = CASE WHEN ${"deleted" in change} THEN statement_timestamp() ELSE NULL END,
      version = version + 1, updated_at = statement_timestamp()
      WHERE company_id = ${folder.companyId}::uuid AND id = ${folder.id}::uuid`;
    await this.audit(
      tx,
      actor,
      folder,
      "deleted" in change
        ? "media.folder_deleted"
        : "name" in change
          ? "media.folder_renamed"
          : "media.folder_moved",
      "parentId" in change ? { fromParentId: folder.parentId, parentId } : {},
    );
    return await tx.mediaFolder.findUniqueOrThrow({ where: { id: folder.id } });
  }

  async touch(
    tx: Prisma.TransactionClient,
    companyId: string,
    ids: readonly (string | null)[],
  ) {
    const unique = [
      ...new Set(ids.filter((id): id is string => id !== null)),
    ].sort();
    if (unique.length)
      await tx.$executeRaw`UPDATE media_folders SET version = version + 1, updated_at = statement_timestamp()
      WHERE company_id = ${companyId}::uuid AND id = ANY(${unique}::uuid[]) AND deleted_at IS NULL`;
  }

  async empty(tx: Prisma.TransactionClient, folder: FolderRecord) {
    const children = await tx.mediaFolder.count({
      where: {
        companyId: folder.companyId,
        parentId: folder.id,
        deletedAt: null,
      },
    });
    const assets = await tx.mediaAsset.count({
      where: {
        companyId: folder.companyId,
        folderId: folder.id,
        status: { not: "PURGED" },
      },
    });
    return children === 0 && assets === 0;
  }

  async receipt(tx: Prisma.TransactionClient, companyId: string, id: string) {
    return tx.mediaLibraryOperation.findUnique({
      where: { companyId_id: { companyId, id } },
    });
  }

  async record(
    tx: Prisma.TransactionClient,
    companyId: string,
    id: string,
    actor: NonNullable<MediaActor>,
    hash: Buffer,
    result: LibraryResult,
  ) {
    await tx.mediaLibraryOperation.create({
      data: {
        companyId,
        id,
        actorMembershipId: actor.membershipId,
        requestHash: new Uint8Array(hash),
        result: result,
      },
    });
  }

  private async audit(
    tx: Prisma.TransactionClient,
    actor: NonNullable<MediaActor>,
    folder: FolderRecord,
    action: string,
    details: Record<string, unknown>,
  ) {
    await tx.$executeRaw`INSERT INTO media_audit_events (id, company_id, folder_id, actor_principal_id, actor_membership_id, action, details)
      VALUES (${randomUUID()}::uuid, ${folder.companyId}::uuid, ${folder.id}::uuid,
        ${actor.principalId}::uuid, ${actor.membershipId}::uuid, ${action}, ${JSON.stringify(details)}::jsonb)`;
  }
}
