import { randomUUID } from "node:crypto";
import type { Database } from "../../database.js";
import { Prisma } from "../../generated/prisma/client.js";
import type {
  AreaDefinition,
  LayoutDefinition,
  Orientation,
  PageDefinition,
  Presentation,
  ViewRole,
} from "./layouts.js";
import type { Actor } from "./prisma-repository.js";

export type LayoutRecord = Readonly<{
  id: string;
  companyId: string;
  branchId: string | null;
  name: string;
  orientation: Orientation;
  audioMixConfirmed: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}>;

type LayoutRow = {
  id: string;
  company_id: string;
  branch_id: string | null;
  name: string;
  orientation: "LANDSCAPE" | "PORTRAIT";
  audio_mix_confirmed: boolean;
  version: number;
  created_at: Date;
  updated_at: Date;
};

const layoutColumns = Prisma.sql`id, company_id, branch_id, name,
  orientation::text AS orientation, audio_mix_confirmed, version, created_at,
  updated_at`;

const layout = (row: LayoutRow): LayoutRecord => ({
  id: row.id,
  companyId: row.company_id,
  branchId: row.branch_id,
  name: row.name,
  orientation: row.orientation === "LANDSCAPE" ? "landscape" : "portrait",
  audioMixConfirmed: row.audio_mix_confirmed,
  version: row.version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const uuidList = (ids: readonly string[]) =>
  Prisma.join([...new Set(ids)].sort().map((id) => Prisma.sql`${id}::uuid`));

/**
 * PostgreSQL persistence of layouts, part of the programming module. Writers
 * run inside a transaction that first takes the organization locks, then
 * the layout row (update), then catalogs (key share) and media (share)
 * through their ports. A save replaces the areas, view fields, pages and
 * page contents as a whole. Every change writes its programming audit event
 * in the same transaction.
 */
export class PrismaLayoutRepository {
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
    layoutId: string,
    branchIds: readonly string[],
    action: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    await tx.$executeRaw`
      INSERT INTO programming_audit_events (id, company_id, subject_type,
        subject_id, branch_ids, actor_principal_id, actor_membership_id,
        action, details)
      VALUES (${randomUUID()}::uuid, ${companyId}::uuid, 'layout',
        ${layoutId}::uuid, ${[...new Set(branchIds)].sort()}::uuid[],
        ${actor.principalId}::uuid, ${actor.membershipId}::uuid, ${action},
        ${JSON.stringify(details)}::jsonb)`;
  }

  /**
   * The company's layout count behind its limit, under the same per-company
   * advisory lock as the other programming limits.
   */
  async countLayouts(
    tx: Prisma.TransactionClient,
    companyId: string,
  ): Promise<number> {
    const key = `programming-limits:${companyId}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
    const [row] = await tx.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count FROM layouts WHERE company_id = ${companyId}::uuid`;
    return row?.count ?? 0;
  }

  async createLayout(
    tx: Prisma.TransactionClient,
    input: {
      companyId: string;
      branchId: string | null;
      name: string;
      definition: LayoutDefinition;
    },
  ): Promise<LayoutRecord> {
    const [row] = await tx.$queryRaw<LayoutRow[]>`
      INSERT INTO layouts (id, company_id, branch_id, name, orientation,
        audio_mix_confirmed)
      VALUES (${randomUUID()}::uuid, ${input.companyId}::uuid,
        ${input.branchId}::uuid, ${input.name},
        ${input.definition.orientation.toUpperCase()}::"LayoutOrientation",
        ${input.definition.audioMixConfirmed})
      RETURNING ${layoutColumns}`;
    if (!row) throw new Error("Layout insert returned no row");
    const created = layout(row);
    await this.#writeDefinition(tx, created, input.definition);
    return created;
  }

  async findLayout(
    companyId: string,
    layoutId: string,
  ): Promise<LayoutRecord | null> {
    const [row] = await this.#db.$queryRaw<LayoutRow[]>`
      SELECT ${layoutColumns} FROM layouts
      WHERE company_id = ${companyId}::uuid AND id = ${layoutId}::uuid`;
    return row ? layout(row) : null;
  }

  async lockLayout(
    tx: Prisma.TransactionClient,
    companyId: string,
    layoutId: string,
  ): Promise<LayoutRecord | null> {
    const [row] = await tx.$queryRaw<LayoutRow[]>`
      SELECT ${layoutColumns} FROM layouts
      WHERE company_id = ${companyId}::uuid AND id = ${layoutId}::uuid
      FOR UPDATE`;
    return row ? layout(row) : null;
  }

  /** Newest first, keyset-paginated, within the visible scopes. */
  async listLayouts(
    companyId: string,
    reach: "all" | ReadonlySet<string>,
    options: {
      limit: number;
      scope?: string;
      text?: string;
      before?: { createdAt: Date; id: string };
    },
  ): Promise<LayoutRecord[]> {
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
    const rows = await this.#db.$queryRaw<LayoutRow[]>`
      SELECT ${layoutColumns} FROM layouts
      WHERE company_id = ${companyId}::uuid ${visible} ${scope} ${text} ${before}
      ORDER BY created_at DESC, id DESC
      LIMIT ${options.limit}`;
    return rows.map(layout);
  }

  /** A layout's stored definition, areas by stacking order. */
  async definition(
    current: LayoutRecord,
    tx?: Prisma.TransactionClient,
  ): Promise<LayoutDefinition> {
    const db = tx ?? this.#db;
    const { companyId, id } = current;
    const areaRows = await db.$queryRaw<
      {
        id: string;
        key: string;
        name: string;
        x: number;
        y: number;
        width: number;
        height: number;
        z: number;
        background: string;
        fit: "contain" | "cover";
        muted: boolean;
        volume: number;
        kind: "MEDIA" | "CATALOG";
        page_controlled: boolean;
        catalog_id: string | null;
        presentation: Presentation | null;
        text_size: number | null;
        show_unavailable: boolean | null;
        page_seconds: number | null;
      }[]
    >`
      SELECT id, key, name, x, y, width, height, z, background, fit, muted,
        volume, kind::text AS kind, page_controlled, catalog_id, presentation,
        text_size, show_unavailable, page_seconds
      FROM layout_areas
      WHERE company_id = ${companyId}::uuid AND layout_id = ${id}::uuid
      ORDER BY z`;
    const fieldRows = await db.$queryRaw<
      { area_id: string; field_id: string; role: ViewRole }[]
    >`
      SELECT f.area_id, f.field_id, f.role FROM layout_view_fields f
      JOIN layout_areas a ON a.company_id = f.company_id AND a.id = f.area_id
      WHERE a.company_id = ${companyId}::uuid AND a.layout_id = ${id}::uuid
      ORDER BY f.area_id, f.position`;
    const pageRows = await db.$queryRaw<
      { id: string; duration_seconds: number }[]
    >`
      SELECT id, duration_seconds FROM layout_pages
      WHERE company_id = ${companyId}::uuid AND layout_id = ${id}::uuid
      ORDER BY position`;
    const contentRows = await db.$queryRaw<
      {
        page_id: string;
        area_id: string;
        media_asset_id: string | null;
        view_page: number | null;
        group_choice_id: string | null;
      }[]
    >`
      SELECT c.page_id, c.area_id, c.media_asset_id, c.view_page,
        c.group_choice_id
      FROM layout_page_contents c
      JOIN layout_pages p ON p.company_id = c.company_id AND p.id = c.page_id
      WHERE p.company_id = ${companyId}::uuid AND p.layout_id = ${id}::uuid`;
    const keys = new Map(areaRows.map((row) => [row.id, row.key]));
    const areas: AreaDefinition[] = areaRows.map((row) => ({
      key: row.key,
      name: row.name,
      x: row.x,
      y: row.y,
      width: row.width,
      height: row.height,
      z: row.z,
      background: row.background,
      fit: row.fit,
      muted: row.muted,
      volume: row.volume,
      kind: row.kind === "MEDIA" ? "media" : "catalog",
      pageControlled: row.page_controlled,
      view:
        row.catalog_id === null
          ? null
          : {
              catalogId: row.catalog_id,
              fields: fieldRows
                .filter((field) => field.area_id === row.id)
                .map((field) => ({
                  fieldId: field.field_id,
                  role: field.role,
                })),
              presentation: row.presentation ?? "list",
              textSize: row.text_size ?? 0,
              unavailable: row.show_unavailable ? "show" : "hide",
              pageSeconds: row.page_seconds ?? 0,
            },
    }));
    const order = new Map(areas.map((area, index) => [area.key, index]));
    const pages: PageDefinition[] = pageRows.map((page) => ({
      durationSeconds: page.duration_seconds,
      contents: contentRows
        .filter((content) => content.page_id === page.id)
        .map((content) => ({
          areaKey: keys.get(content.area_id) ?? "",
          mediaAssetId: content.media_asset_id,
          viewPage: content.view_page,
          groupChoiceId: content.group_choice_id,
        }))
        .sort(
          (a, b) => (order.get(a.areaKey) ?? 0) - (order.get(b.areaKey) ?? 0),
        ),
    }));
    return {
      orientation: current.orientation,
      audioMixConfirmed: current.audioMixConfirmed,
      areas,
      pages,
    };
  }

  /** Replaces a layout's definition and bumps its version. */
  async saveDefinition(
    tx: Prisma.TransactionClient,
    current: LayoutRecord,
    changes: { name?: string; definition?: LayoutDefinition },
  ): Promise<LayoutRecord> {
    const definition = changes.definition;
    const [row] = await tx.$queryRaw<LayoutRow[]>`
      UPDATE layouts SET
        name = ${changes.name ?? current.name},
        orientation = ${(definition?.orientation ?? current.orientation).toUpperCase()}::"LayoutOrientation",
        audio_mix_confirmed = ${definition?.audioMixConfirmed ?? current.audioMixConfirmed},
        version = version + 1,
        updated_at = now()
      WHERE company_id = ${current.companyId}::uuid AND id = ${current.id}::uuid
      RETURNING ${layoutColumns}`;
    if (!row) throw new Error("Layout update returned no row");
    const updated = layout(row);
    if (definition) {
      // Areas cascade to their view fields and page contents.
      await tx.$executeRaw`
        DELETE FROM layout_areas
        WHERE company_id = ${current.companyId}::uuid AND layout_id = ${current.id}::uuid`;
      await tx.$executeRaw`
        DELETE FROM layout_pages
        WHERE company_id = ${current.companyId}::uuid AND layout_id = ${current.id}::uuid`;
      await this.#writeDefinition(tx, updated, definition);
    }
    return updated;
  }

  async #writeDefinition(
    tx: Prisma.TransactionClient,
    current: LayoutRecord,
    definition: LayoutDefinition,
  ): Promise<void> {
    const { companyId } = current;
    const areaIds = new Map<string, string>();
    for (const area of definition.areas) {
      const areaId = randomUUID();
      areaIds.set(area.key, areaId);
      const view = area.view;
      await tx.$executeRaw`
        INSERT INTO layout_areas (id, company_id, layout_id, key, name, x, y,
          width, height, z, background, fit, muted, volume, kind,
          page_controlled, catalog_id, presentation, text_size,
          show_unavailable, page_seconds)
        VALUES (${areaId}::uuid, ${companyId}::uuid, ${current.id}::uuid,
          ${area.key}, ${area.name}, ${area.x}::int, ${area.y}::int,
          ${area.width}::int, ${area.height}::int, ${area.z}::int,
          ${area.background}, ${area.fit}, ${area.muted}, ${area.volume}::int,
          ${area.kind.toUpperCase()}::"LayoutAreaKind", ${area.pageControlled},
          ${view?.catalogId ?? null}::uuid, ${view?.presentation ?? null},
          ${view?.textSize ?? null}::int,
          ${view ? view.unavailable === "show" : null}::boolean,
          ${view?.pageSeconds ?? null}::int)`;
      for (const [position, field] of (view?.fields ?? []).entries())
        await tx.$executeRaw`
          INSERT INTO layout_view_fields (company_id, area_id, position,
            field_id, role)
          VALUES (${companyId}::uuid, ${areaId}::uuid, ${position}::int,
            ${field.fieldId}::uuid, ${field.role})`;
    }
    for (const [position, page] of definition.pages.entries()) {
      const pageId = randomUUID();
      await tx.$executeRaw`
        INSERT INTO layout_pages (id, company_id, layout_id, position,
          duration_seconds)
        VALUES (${pageId}::uuid, ${companyId}::uuid, ${current.id}::uuid,
          ${position}::int, ${page.durationSeconds}::int)`;
      for (const content of page.contents)
        await tx.$executeRaw`
          INSERT INTO layout_page_contents (company_id, page_id, area_id,
            media_asset_id, view_page, group_choice_id)
          VALUES (${companyId}::uuid, ${pageId}::uuid,
            ${areaIds.get(content.areaKey) ?? null}::uuid,
            ${content.mediaAssetId}::uuid, ${content.viewPage}::int,
            ${content.groupChoiceId})`;
    }
  }

  async deleteLayout(
    tx: Prisma.TransactionClient,
    current: LayoutRecord,
  ): Promise<void> {
    await tx.$executeRaw`
      DELETE FROM layouts
      WHERE company_id = ${current.companyId}::uuid AND id = ${current.id}::uuid`;
  }

  /** Layouts binding a catalog, and each field, for the catalogs guard. */
  async catalogUsage(
    tx: Prisma.TransactionClient,
    companyId: string,
    catalogId: string,
  ): Promise<{ layouts: number; fields: Map<string, number> }> {
    const [row] = await tx.$queryRaw<{ count: number }[]>`
      SELECT count(DISTINCT layout_id)::int AS count FROM layout_areas
      WHERE company_id = ${companyId}::uuid AND catalog_id = ${catalogId}::uuid`;
    const fields = await tx.$queryRaw<{ field_id: string; count: number }[]>`
      SELECT f.field_id, count(DISTINCT a.layout_id)::int AS count
      FROM layout_view_fields f
      JOIN layout_areas a ON a.company_id = f.company_id AND a.id = f.area_id
      WHERE a.company_id = ${companyId}::uuid AND a.catalog_id = ${catalogId}::uuid
      GROUP BY f.field_id`;
    return {
      layouts: row?.count ?? 0,
      fields: new Map(fields.map((entry) => [entry.field_id, entry.count])),
    };
  }

  /** Layouts whose pages name a media item, for the media guard. */
  async layoutsUsingMedia(
    tx: Prisma.TransactionClient,
    companyId: string,
    assetId: string,
  ): Promise<{ branchId: string | null }[]> {
    return tx.$queryRaw<{ branchId: string | null }[]>`
      SELECT DISTINCT l.branch_id AS "branchId"
      FROM layout_page_contents c
      JOIN layout_pages p ON p.company_id = c.company_id AND p.id = c.page_id
      JOIN layouts l ON l.company_id = p.company_id AND l.id = p.layout_id
      WHERE c.company_id = ${companyId}::uuid AND c.media_asset_id = ${assetId}::uuid`;
  }
}
