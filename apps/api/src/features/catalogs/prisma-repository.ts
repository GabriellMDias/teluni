import { randomUUID } from "node:crypto";
import type { Database } from "../../database.js";
import { Prisma } from "../../generated/prisma/client.js";
import type {
  FieldDefinition,
  FieldType,
  Promotion,
  SchemaCheck,
  Values,
} from "./domain.js";

export type Actor = Readonly<{ principalId: string; membershipId: string }>;

export type CatalogStatus = "ACTIVE" | "ARCHIVED";

export type CatalogData = Readonly<{
  id: string;
  companyId: string;
  branchId: string | null;
  name: string;
  status: CatalogStatus;
  version: number;
  schemaVersion: number;
  createdAt: Date;
  updatedAt: Date;
}>;

export type RecordData = Readonly<{
  id: string;
  catalogId: string;
  position: number;
  available: boolean;
  values: Values;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}>;

export type OverrideData = Readonly<{
  recordId: string;
  fieldId: string;
  branchId: string;
  amount: number;
}>;

export type PromotionData = Promotion &
  Readonly<{ recordId: string; fieldId: string; createdAt: Date }>;

type CatalogRow = {
  id: string;
  company_id: string;
  branch_id: string | null;
  name: string;
  status: CatalogStatus;
  version: number;
  schema_version: number;
  created_at: Date;
  updated_at: Date;
};

const catalogColumns = Prisma.sql`id, company_id, branch_id, name,
  status::text AS status, version, schema_version, created_at, updated_at`;

const catalog = (row: CatalogRow): CatalogData => ({
  id: row.id,
  companyId: row.company_id,
  branchId: row.branch_id,
  name: row.name,
  status: row.status,
  version: row.version,
  schemaVersion: row.schema_version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

type RecordRow = {
  id: string;
  catalog_id: string;
  position: number;
  available: boolean;
  field_values: Values;
  version: number;
  created_at: Date;
  updated_at: Date;
};

const recordColumns = Prisma.sql`id, catalog_id, position, available,
  field_values, version, created_at, updated_at`;

const record = (row: RecordRow): RecordData => ({
  id: row.id,
  catalogId: row.catalog_id,
  position: row.position,
  available: row.available,
  values: row.field_values,
  version: row.version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const storedTypes: Readonly<Record<FieldType, string>> = {
  text: "TEXT",
  longText: "LONG_TEXT",
  number: "NUMBER",
  boolean: "BOOLEAN",
  date: "DATE",
  time: "TIME",
  weekdays: "WEEKDAYS",
  selection: "SELECTION",
  money: "MONEY",
  media: "MEDIA",
  reference: "REFERENCE",
};
const wireTypes = new Map(
  Object.entries(storedTypes).map(([wire, stored]) => [
    stored,
    wire as FieldType,
  ]),
);

type FieldRow = {
  id: string;
  catalog_id: string;
  label: string;
  type: string;
  required: boolean;
  settings: Record<string, unknown>;
  currency: string | null;
  target_catalog_id: string | null;
  archived: boolean;
};

function field(row: FieldRow): FieldDefinition {
  const type = wireTypes.get(row.type);
  if (!type) throw new Error("Unknown stored catalog field type");
  const settings = row.settings;
  const base = {
    id: row.id,
    label: row.label,
    type,
    required: row.required,
    archived: row.archived,
  };
  switch (type) {
    case "text":
    case "longText":
      return { ...base, maxLength: settings.maxLength as number };
    case "number":
      return {
        ...base,
        decimals: settings.decimals as number,
        minimum: (settings.minimum as string | null) ?? null,
        maximum: (settings.maximum as string | null) ?? null,
      };
    case "selection":
      return {
        ...base,
        choices: settings.choices as { id: string; label: string }[],
      };
    case "money":
      return {
        ...base,
        currency: row.currency ?? "",
        promotions: settings.promotions as boolean,
      };
    case "reference":
      return { ...base, targetCatalogId: row.target_catalog_id ?? "" };
    default:
      return base;
  }
}

function settingsOf(definition: FieldDefinition): Record<string, unknown> {
  switch (definition.type) {
    case "text":
    case "longText":
      return { maxLength: definition.maxLength };
    case "number":
      return {
        decimals: definition.decimals,
        minimum: definition.minimum ?? null,
        maximum: definition.maximum ?? null,
      };
    case "selection":
      return { choices: definition.choices };
    case "money":
      return { promotions: definition.promotions };
    default:
      return {};
  }
}

const uuidList = (ids: readonly string[]) =>
  Prisma.join([...new Set(ids)].sort().map((id) => Prisma.sql`${id}::uuid`));

/** Records are spaced so a move usually rewrites only the moved row. */
export const positionGap = 1024;
const maxPosition = 1 << 30;

/**
 * PostgreSQL persistence of catalogs. Writers run inside a transaction that
 * first takes the organization locks through the company-access port; then
 * the catalog row (share for record and price writes, update for schema,
 * catalog and record-order writes), records (update), then media and
 * referenced records (share), in that order. Every change writes its audit
 * event in the same transaction.
 */
export class PrismaCatalogRepository {
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
    subject: { catalogId: string; recordId?: string },
    branchIds: readonly (string | null)[],
    action: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    const branches = [
      ...new Set(branchIds.filter((id): id is string => id !== null)),
    ].sort();
    await tx.$executeRaw`
      INSERT INTO catalog_audit_events (id, company_id, catalog_id, record_id,
        branch_ids, actor_principal_id, actor_membership_id, action, details)
      VALUES (${randomUUID()}::uuid, ${companyId}::uuid,
        ${subject.catalogId}::uuid, ${subject.recordId ?? null}::uuid,
        ${branches}::uuid[], ${actor.principalId}::uuid,
        ${actor.membershipId}::uuid, ${action}, ${JSON.stringify(details)}::jsonb)`;
  }

  /**
   * The company's catalog count behind its limit. A transaction-scoped
   * advisory lock per company serializes every count-and-insert until
   * commit, and the count runs after it in a fresh snapshot.
   */
  async countCatalogs(
    tx: Prisma.TransactionClient,
    companyId: string,
  ): Promise<number> {
    const key = `catalog-limits:${companyId}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
    const [row] = await tx.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count FROM catalogs WHERE company_id = ${companyId}::uuid`;
    return row?.count ?? 0;
  }

  // Catalogs

  async createCatalog(
    tx: Prisma.TransactionClient,
    input: { companyId: string; branchId: string | null; name: string },
  ): Promise<CatalogData> {
    const [row] = await tx.$queryRaw<CatalogRow[]>`
      INSERT INTO catalogs (id, company_id, branch_id, name)
      VALUES (${randomUUID()}::uuid, ${input.companyId}::uuid,
        ${input.branchId}::uuid, ${input.name})
      RETURNING ${catalogColumns}`;
    if (!row) throw new Error("Catalog insert returned no row");
    return catalog(row);
  }

  async findCatalog(
    companyId: string,
    catalogId: string,
  ): Promise<CatalogData | null> {
    const [row] = await this.#db.$queryRaw<CatalogRow[]>`
      SELECT ${catalogColumns} FROM catalogs
      WHERE company_id = ${companyId}::uuid AND id = ${catalogId}::uuid`;
    return row ? catalog(row) : null;
  }

  /**
   * Locks a catalog row. Schema, catalog and record-order writes take
   * `update` (FOR NO KEY UPDATE); record and price writes take `share`, so
   * they wait for a schema save; deletion takes `delete` (FOR UPDATE); a
   * reference field's target takes `key` (FOR KEY SHARE), which only
   * deletion waits for, so two catalogs that refer to each other never
   * deadlock.
   */
  async lockCatalog(
    tx: Prisma.TransactionClient,
    companyId: string,
    catalogId: string,
    mode: "update" | "share" | "delete" | "key",
  ): Promise<CatalogData | null> {
    const lock = {
      update: Prisma.sql`FOR NO KEY UPDATE`,
      share: Prisma.sql`FOR SHARE`,
      delete: Prisma.sql`FOR UPDATE`,
      key: Prisma.sql`FOR KEY SHARE`,
    }[mode];
    const [row] = await tx.$queryRaw<CatalogRow[]>`
      SELECT ${catalogColumns} FROM catalogs
      WHERE company_id = ${companyId}::uuid AND id = ${catalogId}::uuid
      ${lock}`;
    return row ? catalog(row) : null;
  }

  /** Newest first, keyset-paginated, within the visible scopes. */
  async listCatalogs(
    companyId: string,
    reach: "all" | ReadonlySet<string>,
    options: {
      limit: number;
      scope?: string;
      text?: string;
      status?: CatalogStatus;
      before?: { createdAt: Date; id: string };
    },
  ): Promise<CatalogData[]> {
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
    const status = options.status
      ? Prisma.sql`AND status = ${options.status}::"CatalogStatus"`
      : Prisma.empty;
    const before = options.before
      ? Prisma.sql`AND (created_at, id) < (${options.before.createdAt}::timestamptz, ${options.before.id}::uuid)`
      : Prisma.empty;
    const rows = await this.#db.$queryRaw<CatalogRow[]>`
      SELECT ${catalogColumns} FROM catalogs
      WHERE company_id = ${companyId}::uuid ${visible} ${scope} ${text} ${status} ${before}
      ORDER BY created_at DESC, id DESC
      LIMIT ${options.limit}`;
    return rows.map(catalog);
  }

  async updateCatalog(
    tx: Prisma.TransactionClient,
    current: CatalogData,
    changes: { name?: string; status?: CatalogStatus; schema?: boolean },
  ): Promise<CatalogData> {
    const [row] = await tx.$queryRaw<CatalogRow[]>`
      UPDATE catalogs SET
        name = ${changes.name ?? current.name},
        status = ${changes.status ?? current.status}::"CatalogStatus",
        schema_version = schema_version + ${changes.schema ? 1 : 0}::int,
        version = version + 1,
        updated_at = now()
      WHERE company_id = ${current.companyId}::uuid AND id = ${current.id}::uuid
      RETURNING ${catalogColumns}`;
    if (!row) throw new Error("Catalog update returned no row");
    return catalog(row);
  }

  /** Deletes an empty catalog and its fields. */
  async deleteCatalog(
    tx: Prisma.TransactionClient,
    current: CatalogData,
  ): Promise<void> {
    await tx.$executeRaw`
      DELETE FROM catalog_fields
      WHERE company_id = ${current.companyId}::uuid AND catalog_id = ${current.id}::uuid`;
    await tx.$executeRaw`
      DELETE FROM catalogs
      WHERE company_id = ${current.companyId}::uuid AND id = ${current.id}::uuid`;
  }

  async recordCounts(
    companyId: string,
    catalogIds: readonly string[],
    tx?: Prisma.TransactionClient,
  ): Promise<Map<string, number>> {
    const counts = new Map<string, number>(catalogIds.map((id) => [id, 0]));
    if (catalogIds.length === 0) return counts;
    const rows = await (tx ?? this.#db).$queryRaw<
      { catalog_id: string; count: number }[]
    >`
      SELECT catalog_id, count(*)::int AS count FROM catalog_records
      WHERE company_id = ${companyId}::uuid AND catalog_id IN (${uuidList(catalogIds)})
      GROUP BY catalog_id`;
    for (const row of rows) counts.set(row.catalog_id, row.count);
    return counts;
  }

  /** Reference fields of other catalogs that target a catalog. */
  async referencingFields(
    tx: Prisma.TransactionClient,
    companyId: string,
    catalogId: string,
  ): Promise<number> {
    const [row] = await tx.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count FROM catalog_fields
      WHERE company_id = ${companyId}::uuid
        AND target_catalog_id = ${catalogId}::uuid
        AND catalog_id <> ${catalogId}::uuid`;
    return row?.count ?? 0;
  }

  // Fields

  async fields(
    companyId: string,
    catalogIds: readonly string[],
    tx?: Prisma.TransactionClient,
  ): Promise<Map<string, FieldDefinition[]>> {
    const found = new Map<string, FieldDefinition[]>(
      catalogIds.map((id) => [id, []]),
    );
    if (catalogIds.length === 0) return found;
    const rows = await (tx ?? this.#db).$queryRaw<FieldRow[]>`
      SELECT id, catalog_id, label, type::text AS type, required, settings,
        currency, target_catalog_id, archived_at IS NOT NULL AS archived
      FROM catalog_fields
      WHERE company_id = ${companyId}::uuid AND catalog_id IN (${uuidList(catalogIds)})
      ORDER BY catalog_id, position, id`;
    for (const row of rows) found.get(row.catalog_id)?.push(field(row));
    return found;
  }

  /** Writes a planned schema: updates kept fields, inserts new ones. */
  async replaceFields(
    tx: Prisma.TransactionClient,
    current: CatalogData,
    fields: readonly FieldDefinition[],
    removed: readonly string[],
  ): Promise<void> {
    const { companyId, id: catalogId } = current;
    if (removed.length > 0)
      await tx.$executeRaw`
        DELETE FROM catalog_fields
        WHERE company_id = ${companyId}::uuid AND catalog_id = ${catalogId}::uuid
          AND id IN (${uuidList(removed)})`;
    const existing = new Set(
      (
        await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM catalog_fields
          WHERE company_id = ${companyId}::uuid AND catalog_id = ${catalogId}::uuid`
      ).map((row) => row.id),
    );
    for (const [position, definition] of fields.entries()) {
      const settings = JSON.stringify(settingsOf(definition));
      if (existing.has(definition.id))
        await tx.$executeRaw`
          UPDATE catalog_fields SET
            position = ${position}::int,
            label = ${definition.label},
            required = ${definition.required},
            settings = ${settings}::jsonb,
            archived_at = CASE
              WHEN NOT ${definition.archived} THEN NULL
              ELSE COALESCE(archived_at, now()) END
          WHERE company_id = ${companyId}::uuid AND catalog_id = ${catalogId}::uuid
            AND id = ${definition.id}::uuid`;
      else
        await tx.$executeRaw`
          INSERT INTO catalog_fields (id, company_id, catalog_id, position,
            label, type, required, settings, currency, target_catalog_id,
            archived_at)
          VALUES (${definition.id}::uuid, ${companyId}::uuid,
            ${catalogId}::uuid, ${position}::int, ${definition.label},
            ${storedTypes[definition.type]}::"CatalogFieldType",
            ${definition.required}, ${settings}::jsonb,
            ${definition.currency ?? null}, ${definition.targetCatalogId ?? null}::uuid,
            CASE WHEN ${definition.archived} THEN now() ELSE NULL END)`;
    }
  }

  /** How many stored records or prices fail one schema check. */
  async countCheck(
    tx: Prisma.TransactionClient,
    current: CatalogData,
    check: Exclude<SchemaCheck, { kind: "target" }>,
  ): Promise<number> {
    const { companyId, id: catalogId } = current;
    const records = (condition: Prisma.Sql) =>
      tx.$queryRaw<{ count: number }[]>`
        SELECT count(*)::int AS count FROM catalog_records
        WHERE company_id = ${companyId}::uuid AND catalog_id = ${catalogId}::uuid
          AND ${condition}`;
    const value = Prisma.sql`(field_values -> ${check.fieldId}::text)`;
    const text = Prisma.sql`(field_values ->> ${check.fieldId}::text)`;
    let rows: { count: number }[];
    switch (check.kind) {
      case "removed": {
        rows = await tx.$queryRaw<{ count: number }[]>`
          SELECT
            (SELECT count(*)::int FROM catalog_records
              WHERE company_id = ${companyId}::uuid AND catalog_id = ${catalogId}::uuid
                AND ${value} IS NOT NULL)
            + (SELECT count(*)::int FROM catalog_price_overrides
              WHERE company_id = ${companyId}::uuid AND catalog_id = ${catalogId}::uuid
                AND field_id = ${check.fieldId}::uuid)
            + (SELECT count(*)::int FROM catalog_promotions
              WHERE company_id = ${companyId}::uuid AND catalog_id = ${catalogId}::uuid
                AND field_id = ${check.fieldId}::uuid) AS count`;
        break;
      }
      case "missing":
        rows = await records(Prisma.sql`${value} IS NULL`);
        break;
      case "tooLong":
        rows = await records(
          Prisma.sql`char_length(${text}) > ${check.maxLength}::int`,
        );
        break;
      case "outOfRange": {
        const below =
          check.minimum === null
            ? Prisma.sql`false`
            : Prisma.sql`${text}::numeric < ${check.minimum}::numeric`;
        const above =
          check.maximum === null
            ? Prisma.sql`false`
            : Prisma.sql`${text}::numeric > ${check.maximum}::numeric`;
        rows = await records(
          Prisma.sql`${value} IS NOT NULL AND (${below} OR ${above})`,
        );
        break;
      }
      case "choices":
        rows = await records(
          Prisma.sql`${text} = ANY(${check.removed}::text[])`,
        );
        break;
      case "promotions":
        rows = await tx.$queryRaw<{ count: number }[]>`
          SELECT count(*)::int AS count FROM catalog_promotions
          WHERE company_id = ${companyId}::uuid AND catalog_id = ${catalogId}::uuid
            AND field_id = ${check.fieldId}::uuid`;
        break;
    }
    return rows[0]?.count ?? 0;
  }

  // Records

  async createRecord(
    tx: Prisma.TransactionClient,
    actor: Actor,
    current: CatalogData,
    input: { values: Values; available: boolean },
  ): Promise<RecordData> {
    const position = await this.#nextPosition(tx, current);
    const [row] = await tx.$queryRaw<RecordRow[]>`
      INSERT INTO catalog_records (id, company_id, catalog_id, position,
        available, field_values, created_by_membership_id,
        updated_by_membership_id)
      VALUES (${randomUUID()}::uuid, ${current.companyId}::uuid,
        ${current.id}::uuid, ${position}::int, ${input.available},
        ${JSON.stringify(input.values)}::jsonb, ${actor.membershipId}::uuid,
        ${actor.membershipId}::uuid)
      RETURNING ${recordColumns}`;
    if (!row) throw new Error("Record insert returned no row");
    return record(row);
  }

  /** After the last record; renumbers when positions run out. */
  async #nextPosition(
    tx: Prisma.TransactionClient,
    current: CatalogData,
  ): Promise<number> {
    const [row] = await tx.$queryRaw<{ last: number | null }[]>`
      SELECT max(position) AS last FROM catalog_records
      WHERE company_id = ${current.companyId}::uuid AND catalog_id = ${current.id}::uuid`;
    const last = row?.last ?? 0;
    if (last + positionGap < maxPosition) return last + positionGap;
    return ((await this.renumber(tx, current, null)) + 1) * positionGap;
  }

  /**
   * Respaces every record of a catalog in stored order from one gap on, so
   * there is always room before the first, leaving out one record when
   * given, and returns how many it placed.
   */
  async renumber(
    tx: Prisma.TransactionClient,
    current: CatalogData,
    except: string | null,
  ): Promise<number> {
    const [row] = await tx.$queryRaw<{ count: number }[]>`
      WITH ordered AS (
        SELECT id, row_number() OVER (ORDER BY position, id) * ${positionGap}::int AS next
        FROM catalog_records
        WHERE company_id = ${current.companyId}::uuid AND catalog_id = ${current.id}::uuid
          AND id IS DISTINCT FROM ${except}::uuid
      ), changed AS (
        UPDATE catalog_records r SET position = o.next
        FROM ordered o
        WHERE r.company_id = ${current.companyId}::uuid AND r.id = o.id
          AND r.position <> o.next
        RETURNING r.id
      )
      SELECT (SELECT count(*)::int FROM ordered) AS count`;
    return row?.count ?? 0;
  }

  /** The positions of a record and of the one after it, excluding one. */
  async neighbors(
    tx: Prisma.TransactionClient,
    current: CatalogData,
    afterRecordId: string | null,
    except: string,
  ): Promise<{ lower: number | null; upper: number | null } | null> {
    let lower: number | null = null;
    let anchor = Prisma.empty;
    if (afterRecordId !== null) {
      const [after] = await tx.$queryRaw<{ position: number; id: string }[]>`
        SELECT position, id FROM catalog_records
        WHERE company_id = ${current.companyId}::uuid AND catalog_id = ${current.id}::uuid
          AND id = ${afterRecordId}::uuid`;
      if (!after) return null;
      lower = after.position;
      anchor = Prisma.sql`AND (position, id) > (${after.position}::int, ${after.id}::uuid)`;
    }
    const [next] = await tx.$queryRaw<{ position: number }[]>`
      SELECT position FROM catalog_records
      WHERE company_id = ${current.companyId}::uuid AND catalog_id = ${current.id}::uuid
        AND id <> ${except}::uuid ${anchor}
      ORDER BY position, id LIMIT 1`;
    return { lower, upper: next?.position ?? null };
  }

  async findRecord(
    companyId: string,
    catalogId: string,
    recordId: string,
  ): Promise<RecordData | null> {
    const [row] = await this.#db.$queryRaw<RecordRow[]>`
      SELECT ${recordColumns} FROM catalog_records
      WHERE company_id = ${companyId}::uuid AND catalog_id = ${catalogId}::uuid
        AND id = ${recordId}::uuid`;
    return row ? record(row) : null;
  }

  /** Updates take FOR NO KEY UPDATE and deletion FOR UPDATE, like catalogs. */
  async lockRecord(
    tx: Prisma.TransactionClient,
    companyId: string,
    catalogId: string,
    recordId: string,
    mode: "update" | "delete",
  ): Promise<RecordData | null> {
    const lock =
      mode === "update"
        ? Prisma.sql`FOR NO KEY UPDATE`
        : Prisma.sql`FOR UPDATE`;
    const [row] = await tx.$queryRaw<RecordRow[]>`
      SELECT ${recordColumns} FROM catalog_records
      WHERE company_id = ${companyId}::uuid AND catalog_id = ${catalogId}::uuid
        AND id = ${recordId}::uuid
      ${lock}`;
    return row ? record(row) : null;
  }

  /**
   * Key-share-locks records a reference is about to name, so their deletion
   * waits for this commit; returns those found.
   */
  async shareRecords(
    tx: Prisma.TransactionClient,
    companyId: string,
    catalogId: string,
    recordIds: readonly string[],
  ): Promise<Set<string>> {
    if (recordIds.length === 0) return new Set();
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM catalog_records
      WHERE company_id = ${companyId}::uuid AND catalog_id = ${catalogId}::uuid
        AND id IN (${uuidList(recordIds)})
      ORDER BY id FOR KEY SHARE`;
    return new Set(rows.map((row) => row.id));
  }

  /** In stored order with a keyset cursor, optionally matching text fields. */
  async listRecords(
    current: CatalogData,
    options: {
      limit: number;
      after?: { position: number; id: string };
      text?: { pattern: string; fieldIds: readonly string[] };
    },
  ): Promise<RecordData[]> {
    const after = options.after
      ? Prisma.sql`AND (position, id) > (${options.after.position}::int, ${options.after.id}::uuid)`
      : Prisma.empty;
    const text = options.text
      ? Prisma.sql`AND EXISTS (
          SELECT 1 FROM jsonb_each_text(field_values) v
          WHERE v.key = ANY(${[...options.text.fieldIds]}::text[])
            AND v.value ILIKE ${`%${options.text.pattern.replace(/[\\%_]/g, (c) => `\\${c}`)}%`})`
      : Prisma.empty;
    const rows = await this.#db.$queryRaw<RecordRow[]>`
      SELECT ${recordColumns} FROM catalog_records
      WHERE company_id = ${current.companyId}::uuid AND catalog_id = ${current.id}::uuid
        ${after} ${text}
      ORDER BY position, id
      LIMIT ${options.limit}`;
    return rows.map(record);
  }

  async updateRecord(
    tx: Prisma.TransactionClient,
    actor: Actor,
    companyId: string,
    current: RecordData,
    changes: { values?: Values; available?: boolean; position?: number },
  ): Promise<RecordData> {
    const [row] = await tx.$queryRaw<RecordRow[]>`
      UPDATE catalog_records SET
        field_values = ${JSON.stringify(changes.values ?? current.values)}::jsonb,
        available = ${changes.available ?? current.available},
        position = ${changes.position ?? current.position}::int,
        version = version + 1,
        updated_by_membership_id = ${actor.membershipId}::uuid,
        updated_at = now()
      WHERE company_id = ${companyId}::uuid AND id = ${current.id}::uuid
      RETURNING ${recordColumns}`;
    if (!row) throw new Error("Record update returned no row");
    return record(row);
  }

  /** Mirrors a record's media and references from its values. */
  async replaceLinks(
    tx: Prisma.TransactionClient,
    companyId: string,
    current: RecordData,
    links: {
      media: ReadonlyMap<string, string>;
      references: ReadonlyMap<string, string>;
    },
  ): Promise<void> {
    await tx.$executeRaw`
      DELETE FROM catalog_record_media
      WHERE company_id = ${companyId}::uuid AND record_id = ${current.id}::uuid`;
    await tx.$executeRaw`
      DELETE FROM catalog_record_references
      WHERE company_id = ${companyId}::uuid AND record_id = ${current.id}::uuid`;
    for (const [fieldId, assetId] of links.media)
      await tx.$executeRaw`
        INSERT INTO catalog_record_media (company_id, catalog_id, record_id,
          field_id, media_asset_id)
        VALUES (${companyId}::uuid, ${current.catalogId}::uuid,
          ${current.id}::uuid, ${fieldId}::uuid, ${assetId}::uuid)`;
    for (const [fieldId, targetId] of links.references)
      await tx.$executeRaw`
        INSERT INTO catalog_record_references (company_id, catalog_id,
          record_id, field_id, target_record_id)
        VALUES (${companyId}::uuid, ${current.catalogId}::uuid,
          ${current.id}::uuid, ${fieldId}::uuid, ${targetId}::uuid)`;
  }

  /** Records of other rows whose references name this record. */
  async referrers(
    tx: Prisma.TransactionClient,
    companyId: string,
    recordId: string,
  ): Promise<number> {
    const [row] = await tx.$queryRaw<{ count: number }[]>`
      SELECT count(DISTINCT record_id)::int AS count FROM catalog_record_references
      WHERE company_id = ${companyId}::uuid AND target_record_id = ${recordId}::uuid
        AND record_id <> ${recordId}::uuid`;
    return row?.count ?? 0;
  }

  /** Deletes a record with its prices and links. */
  async deleteRecord(
    tx: Prisma.TransactionClient,
    companyId: string,
    current: RecordData,
  ): Promise<void> {
    // A record that refers to itself would otherwise block its own delete.
    await tx.$executeRaw`
      DELETE FROM catalog_record_references
      WHERE company_id = ${companyId}::uuid AND record_id = ${current.id}::uuid`;
    await tx.$executeRaw`
      DELETE FROM catalog_records
      WHERE company_id = ${companyId}::uuid AND id = ${current.id}::uuid`;
  }

  /** Titles of records, by the first active text field of their catalog. */
  async titles(
    companyId: string,
    recordIds: readonly string[],
  ): Promise<Map<string, string | null>> {
    const found = new Map<string, string | null>();
    if (recordIds.length === 0) return found;
    const rows = await this.#db.$queryRaw<
      { id: string; title: string | null }[]
    >`
      SELECT r.id, r.field_values ->> (
        SELECT f.id::text FROM catalog_fields f
        WHERE f.company_id = r.company_id AND f.catalog_id = r.catalog_id
          AND f.type = 'TEXT' AND f.archived_at IS NULL
        ORDER BY f.position, f.id LIMIT 1) AS title
      FROM catalog_records r
      WHERE r.company_id = ${companyId}::uuid AND r.id IN (${uuidList(recordIds)})`;
    for (const row of rows) found.set(row.id, row.title);
    return found;
  }

  /** Media held by records, with the branch of their catalog. */
  async recordsUsingMedia(
    tx: Prisma.TransactionClient,
    companyId: string,
    assetId: string,
  ): Promise<{ branchId: string | null }[]> {
    return tx.$queryRaw<{ branchId: string | null }[]>`
      SELECT DISTINCT c.branch_id AS "branchId"
      FROM catalog_record_media m
      JOIN catalogs c ON c.company_id = m.company_id AND c.id = m.catalog_id
      WHERE m.company_id = ${companyId}::uuid AND m.media_asset_id = ${assetId}::uuid`;
  }

  // Prices

  async overrides(
    companyId: string,
    recordIds: readonly string[],
    tx?: Prisma.TransactionClient,
  ): Promise<OverrideData[]> {
    if (recordIds.length === 0) return [];
    const rows = await (tx ?? this.#db).$queryRaw<
      {
        record_id: string;
        field_id: string;
        branch_id: string;
        amount: bigint;
      }[]
    >`
      SELECT record_id, field_id, branch_id, amount FROM catalog_price_overrides
      WHERE company_id = ${companyId}::uuid AND record_id IN (${uuidList(recordIds)})
      ORDER BY record_id, field_id, branch_id`;
    return rows.map((row) => ({
      recordId: row.record_id,
      fieldId: row.field_id,
      branchId: row.branch_id,
      amount: Number(row.amount),
    }));
  }

  async setOverride(
    tx: Prisma.TransactionClient,
    companyId: string,
    current: RecordData,
    fieldId: string,
    branchId: string,
    amount: number | null,
  ): Promise<void> {
    if (amount === null)
      await tx.$executeRaw`
        DELETE FROM catalog_price_overrides
        WHERE company_id = ${companyId}::uuid AND record_id = ${current.id}::uuid
          AND field_id = ${fieldId}::uuid AND branch_id = ${branchId}::uuid`;
    else
      await tx.$executeRaw`
        INSERT INTO catalog_price_overrides (company_id, catalog_id, record_id,
          field_id, branch_id, amount)
        VALUES (${companyId}::uuid, ${current.catalogId}::uuid,
          ${current.id}::uuid, ${fieldId}::uuid, ${branchId}::uuid,
          ${amount}::bigint)
        ON CONFLICT (company_id, record_id, field_id, branch_id)
        DO UPDATE SET amount = EXCLUDED.amount, updated_at = now()`;
  }

  async promotions(
    companyId: string,
    recordIds: readonly string[],
    tx?: Prisma.TransactionClient,
  ): Promise<PromotionData[]> {
    if (recordIds.length === 0) return [];
    const rows = await (tx ?? this.#db).$queryRaw<
      {
        id: string;
        record_id: string;
        field_id: string;
        branch_id: string | null;
        amount: bigint;
        starts_at: string;
        ends_at: string;
        created_at: Date;
      }[]
    >`
      SELECT id, record_id, field_id, branch_id, amount,
        to_char(starts_at, 'YYYY-MM-DD"T"HH24:MI') AS starts_at,
        to_char(ends_at, 'YYYY-MM-DD"T"HH24:MI') AS ends_at, created_at
      FROM catalog_promotions
      WHERE company_id = ${companyId}::uuid AND record_id IN (${uuidList(recordIds)})
      ORDER BY record_id, field_id, starts_at, id`;
    return rows.map((row) => ({
      id: row.id,
      recordId: row.record_id,
      fieldId: row.field_id,
      branchId: row.branch_id,
      amount: Number(row.amount),
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      createdAt: row.created_at,
    }));
  }

  async createPromotion(
    tx: Prisma.TransactionClient,
    actor: Actor,
    companyId: string,
    current: RecordData,
    input: Omit<Promotion, "id"> & { fieldId: string },
  ): Promise<string> {
    const id = randomUUID();
    await tx.$executeRaw`
      INSERT INTO catalog_promotions (id, company_id, catalog_id, record_id,
        field_id, branch_id, amount, starts_at, ends_at,
        created_by_membership_id)
      VALUES (${id}::uuid, ${companyId}::uuid, ${current.catalogId}::uuid,
        ${current.id}::uuid, ${input.fieldId}::uuid, ${input.branchId}::uuid,
        ${input.amount}::bigint, ${input.startsAt}::timestamp,
        ${input.endsAt}::timestamp, ${actor.membershipId}::uuid)`;
    return id;
  }

  async deletePromotion(
    tx: Prisma.TransactionClient,
    companyId: string,
    promotionId: string,
  ): Promise<void> {
    await tx.$executeRaw`
      DELETE FROM catalog_promotions
      WHERE company_id = ${companyId}::uuid AND id = ${promotionId}::uuid`;
  }
}
