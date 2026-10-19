import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";

type ColumnMeta = {
  description: string;
  classification: string;
  nullMeaning?: string;
  unit?: string;
};
type TableMeta = {
  owner: string;
  classification: string;
  description: string;
  lifecycle: string;
  columns: Record<string, ColumnMeta>;
  objects: Record<string, string>;
};
type Metadata = {
  tables: Record<string, TableMeta>;
  enums: Record<string, string>;
};
type Column = {
  table_name: string;
  column_name: string;
  physical_type: string;
  nullable: boolean;
  default_value: string | null;
};
type ObjectRow = { table_name: string; name: string; definition: string };
type EnumRow = { name: string; labels: string };
const metadataDirectory = resolve(import.meta.dirname, "../prisma/metadata");

/** Merges per-module schema metadata; each table or enum has one owner file. */
export async function readSchemaMetadata(
  directory = metadataDirectory,
): Promise<Metadata> {
  let files: string[];
  try {
    files = (await readdir(directory)).filter((name) => name.endsWith(".json"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { tables: {}, enums: {} };
    throw error;
  }
  const merged: Metadata = { tables: {}, enums: {} };
  for (const file of files.sort()) {
    const part = JSON.parse(
      await readFile(resolve(directory, file), "utf8"),
    ) as Partial<Metadata>;
    for (const [kind, entries] of [
      ["tables", part.tables ?? {}],
      ["enums", part.enums ?? {}],
    ] as const)
      for (const [name, value] of Object.entries(entries)) {
        if (name in merged[kind])
          throw new Error(`Schema metadata defines ${name} twice (${file})`);
        (merged[kind] as Record<string, unknown>)[name] = value;
      }
  }
  return merged;
}
function esc(value: string | null): string {
  return value === null
    ? "—"
    : value.replaceAll("|", "\\|").replaceAll("\n", " ");
}
function requireText(value: unknown, context: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "")
    throw new Error(`Missing schema documentation: ${context}`);
}
function requireClassification(value: unknown, context: string): void {
  if (
    !["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"].includes(
      String(value),
    )
  )
    throw new Error(`Invalid schema classification: ${context}`);
}
function exact(actual: string[], expected: string[], context: string) {
  if (actual.sort().join("\0") !== expected.sort().join("\0"))
    throw new Error(
      `Schema documentation mismatch at ${context}: database=[${actual.join(", ")}] metadata=[${expected.join(", ")}]`,
    );
}

export async function generateDatabaseReference(
  url: string,
  directory = metadataDirectory,
): Promise<string> {
  const metadata = await readSchemaMetadata(directory);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    // New object kinds must extend this reference deliberately. Silently omitting
    // their behavior would let a green drift check claim incomplete coverage.
    const unsupported = (
      await client.query<{ kind: string; name: string }>(`
      SELECT 'schema' AS kind, nspname AS name FROM pg_namespace
      WHERE nspname <> 'public' AND nspname <> 'information_schema' AND left(nspname, 3) <> 'pg_'
      UNION ALL
      SELECT 'relation', c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind NOT IN ('r','i')
      UNION ALL
      SELECT 'trigger', t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal
      UNION ALL
      SELECT 'row-level security', c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND (c.relrowsecurity OR c.relforcerowsecurity)
      UNION ALL
      SELECT 'row-level security policy', p.polname FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
      UNION ALL
      SELECT 'table inheritance', c.relname FROM pg_inherits i JOIN pg_class c ON c.oid=i.inhrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
      UNION ALL
      SELECT 'rule', r.rulename FROM pg_rewrite r JOIN pg_class c ON c.oid=r.ev_class
      JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND r.rulename <> '_RETURN'
      UNION ALL
      SELECT 'routine', p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND NOT EXISTS (
        SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')
      UNION ALL
      SELECT 'generated column', c.relname || '.' || a.attname FROM pg_attribute a
      JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND a.attgenerated <> '' AND NOT a.attisdropped
      UNION ALL
      SELECT 'type', t.typname FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
      LEFT JOIN pg_class c ON c.oid=t.typrelid
      WHERE n.nspname='public' AND t.typelem=0 AND (t.typtype NOT IN ('e','c') OR c.relkind='c')
      UNION ALL
      SELECT 'extension', extname FROM pg_extension WHERE extname <> 'plpgsql'
      ORDER BY kind, name`)
    ).rows;
    if (unsupported.length)
      throw new Error(
        `Extend database reference coverage before adding: ${unsupported.map((item) => `${item.kind} ${item.name}`).join(", ")}`,
      );
    const tables = (
      await client.query<{ name: string }>(`
      SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind='r' AND c.relname <> '_prisma_migrations'
      ORDER BY c.relname`)
    ).rows;
    const columns = (
      await client.query<Column>(`
      SELECT c.relname AS table_name, a.attname AS column_name,
        format_type(a.atttypid, a.atttypmod) AS physical_type,
        NOT a.attnotnull AS nullable,
        pg_get_expr(d.adbin, d.adrelid) AS default_value
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
      LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
      WHERE n.nspname='public' AND c.relkind='r' AND c.relname <> '_prisma_migrations'
      ORDER BY c.relname, a.attnum`)
    ).rows;
    const constraints = (
      await client.query<ObjectRow>(`
      SELECT c.relname AS table_name, x.conname AS name, pg_get_constraintdef(x.oid) AS definition
      FROM pg_constraint x JOIN pg_class c ON c.oid=x.conrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind='r' AND c.relname <> '_prisma_migrations'
      ORDER BY c.relname,x.conname`)
    ).rows;
    const indexes = (
      await client.query<ObjectRow>(`
      SELECT c.relname AS table_name, i.relname AS name, pg_get_indexdef(i.oid) AS definition
      FROM pg_index x JOIN pg_class c ON c.oid=x.indrelid JOIN pg_class i ON i.oid=x.indexrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname <> '_prisma_migrations'
        -- Skip only indexes owned by a primary-key, unique or exclusion
        -- constraint; a foreign key also records the referenced index in
        -- conindid, but that index remains a standalone documented object.
        AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conindid=i.oid
          AND k.conrelid=x.indrelid AND k.contype IN ('p','u','x'))
      ORDER BY c.relname,i.relname`)
    ).rows;
    const enums = (
      await client.query<EnumRow>(`
      SELECT t.typname AS name, string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder) AS labels
      FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid
      WHERE n.nspname='public' GROUP BY t.typname ORDER BY t.typname`)
    ).rows;
    exact(
      tables.map((row) => row.name),
      Object.keys(metadata.tables),
      "tables",
    );
    exact(
      enums.map((row) => row.name),
      Object.keys(metadata.enums),
      "enums",
    );
    const lines = [
      "# Database Reference",
      "",
      "<!-- Generated from migrated PostgreSQL and apps/api/prisma/metadata. Do not edit. -->",
      "",
      "[Schema documentation policy](../../database/schema-documentation.md) · [Database principles](../../database/principles.md)",
      "",
    ];
    if (Object.keys(metadata.tables).length === 0)
      lines.push(
        "No application-owned tables exist yet. Add a module's Prisma model, reviewed migration, and metadata, then regenerate this reference.",
        "",
      );
    for (const [tableName, tableMeta] of Object.entries(metadata.tables)) {
      requireText(tableMeta.owner, `${tableName}.owner`);
      requireText(tableMeta.description, `${tableName}.description`);
      requireText(tableMeta.lifecycle, `${tableName}.lifecycle`);
      requireText(tableMeta.classification, `${tableName}.classification`);
      requireClassification(
        tableMeta.classification,
        `${tableName}.classification`,
      );
      const fields = columns.filter((row) => row.table_name === tableName);
      exact(
        fields.map((row) => row.column_name),
        Object.keys(tableMeta.columns),
        `${tableName}.columns`,
      );
      const objects = [...constraints, ...indexes].filter(
        (row) => row.table_name === tableName,
      );
      exact(
        objects.map((row) => row.name),
        Object.keys(tableMeta.objects),
        `${tableName}.objects`,
      );
      lines.push(
        `## ${tableName}`,
        "",
        tableMeta.description,
        "",
        `Owner: ${tableMeta.owner}. Classification: ${tableMeta.classification}.`,
        "",
        `Lifecycle: ${tableMeta.lifecycle}`,
        "",
        "| Column | PostgreSQL type | Nullable | Default | Classification | Meaning | Null meaning | Unit |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
      );
      for (const field of fields) {
        const meta = tableMeta.columns[field.column_name];
        requireText(
          meta.description,
          `${tableName}.${field.column_name}.description`,
        );
        requireText(
          meta.classification,
          `${tableName}.${field.column_name}.classification`,
        );
        requireClassification(
          meta.classification,
          `${tableName}.${field.column_name}.classification`,
        );
        if (field.nullable)
          requireText(
            meta.nullMeaning,
            `${tableName}.${field.column_name}.nullMeaning`,
          );
        lines.push(
          `| \`${field.column_name}\` | \`${esc(field.physical_type)}\` | ${field.nullable ? "yes" : "no"} | ${field.default_value ? `\`${esc(field.default_value)}\`` : "—"} | ${esc(meta.classification)} | ${esc(meta.description)} | ${esc(meta.nullMeaning ?? null)} | ${esc(meta.unit ?? null)} |`,
        );
      }
      lines.push(
        "",
        "### Constraints and indexes",
        "",
        "| Object | Physical definition | Purpose |",
        "| --- | --- | --- |",
      );
      for (const object of objects) {
        requireText(
          tableMeta.objects[object.name],
          `${tableName}.${object.name}.purpose`,
        );
        lines.push(
          `| \`${object.name}\` | \`${esc(object.definition)}\` | ${esc(tableMeta.objects[object.name])} |`,
        );
      }
      lines.push("");
    }
    if (enums.length) {
      lines.push(
        "## Database enums",
        "",
        "| Enum | Values | Meaning |",
        "| --- | --- | --- |",
      );
      for (const item of enums) {
        requireText(metadata.enums[item.name], `enum.${item.name}`);
        lines.push(
          `| \`${item.name}\` | ${esc(item.labels)} | ${esc(metadata.enums[item.name])} |`,
        );
      }
      lines.push("");
    }
    return lines.join("\n");
  } finally {
    await client.end();
  }
}
