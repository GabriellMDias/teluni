import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import pg from "pg";
import { expect, it } from "vitest";
import {
  generateDatabaseReference,
  readSchemaMetadata,
} from "../scripts/database-reference.js";
import {
  assertPrismaSchemaMatchesDatabase,
  withMigratedDatabase,
} from "../scripts/migrated-database.js";

// The fixture table is created by the test itself, so the generator's checks
// are exercised whether or not the repository composes any module tables.
const fixtureMetadata = {
  tables: {
    reference_fixture: {
      owner: "Database reference test",
      classification: "INTERNAL",
      description: "Synthetic table that exercises reference generation.",
      lifecycle: "Created and dropped by one test run.",
      columns: {
        id: { description: "Fixture identifier.", classification: "INTERNAL" },
        title: { description: "Fixture text.", classification: "INTERNAL" },
        note: {
          description: "Optional fixture note.",
          classification: "INTERNAL",
          nullMeaning: "No note supplied.",
        },
      },
      objects: { reference_fixture_pkey: "Fixture primary key." },
    },
  },
  enums: {},
};

it("checks authored schema drift and refuses undocumented PostgreSQL object kinds", async () => {
  const metadata = await mkdtemp(join(tmpdir(), "orion-schema-metadata-"));
  try {
    await cp(resolve(import.meta.dirname, "../prisma/metadata"), metadata, {
      recursive: true,
    }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    await writeFile(
      join(metadata, "zz-reference-fixture.json"),
      JSON.stringify(fixtureMetadata),
    );
    await withMigratedDatabase(async (_runtimeUrl, migrationUrl) => {
      const client = new pg.Client({ connectionString: migrationUrl });
      await client.connect();
      try {
        await assertPrismaSchemaMatchesDatabase(migrationUrl);
        await client.query(
          "CREATE TABLE reference_fixture (id uuid PRIMARY KEY, title text NOT NULL, note text)",
        );
        await expect(
          assertPrismaSchemaMatchesDatabase(migrationUrl),
        ).rejects.toThrow("Prisma schema differs from committed migrations");
        const reference = await generateDatabaseReference(
          migrationUrl,
          metadata,
        );
        expect(reference).toContain("## reference_fixture");
        expect(reference).toContain("PRIMARY KEY (id)");
        expect(reference.match(/`reference_fixture_pkey`/g)).toHaveLength(1);

        // A foreign key's conindid points at its referenced unique index.
        // That standalone index must still appear in the physical reference.
        await client.query(
          "CREATE UNIQUE INDEX reference_fixture_title_unique ON reference_fixture (title)",
        );
        await client.query(
          "ALTER TABLE reference_fixture ADD CONSTRAINT reference_fixture_note_fkey FOREIGN KEY (note) REFERENCES reference_fixture (title)",
        );
        await writeFile(
          join(metadata, "zz-reference-fixture.json"),
          JSON.stringify({
            ...fixtureMetadata,
            tables: {
              reference_fixture: {
                ...fixtureMetadata.tables.reference_fixture,
                objects: {
                  ...fixtureMetadata.tables.reference_fixture.objects,
                  reference_fixture_title_unique:
                    "Standalone referenced unique index.",
                  reference_fixture_note_fkey: "Synthetic self-reference.",
                },
              },
            },
          }),
        );
        const withReference = await generateDatabaseReference(
          migrationUrl,
          metadata,
        );
        expect(
          withReference.match(/`reference_fixture_title_unique`/g),
        ).toHaveLength(1);
        expect(withReference).toContain("FOREIGN KEY (note)");
        await client.query(
          "ALTER TABLE reference_fixture DROP CONSTRAINT reference_fixture_note_fkey",
        );
        await client.query("DROP INDEX reference_fixture_title_unique");
        await writeFile(
          join(metadata, "zz-reference-fixture.json"),
          JSON.stringify(fixtureMetadata),
        );

        await client.query(
          "ALTER TABLE reference_fixture ADD COLUMN undocumented text",
        );
        await expect(
          generateDatabaseReference(migrationUrl, metadata),
        ).rejects.toThrow(
          "Schema documentation mismatch at reference_fixture.columns",
        );
        await client.query(
          "ALTER TABLE reference_fixture DROP COLUMN undocumented",
        );
        await client.query(
          "CREATE INDEX undocumented_index ON reference_fixture (title)",
        );
        await expect(
          generateDatabaseReference(migrationUrl, metadata),
        ).rejects.toThrow(
          "Schema documentation mismatch at reference_fixture.objects",
        );
        await client.query("DROP INDEX undocumented_index");
        await client.query("CREATE TABLE undocumented_empty_table ()");
        await expect(
          generateDatabaseReference(migrationUrl, metadata),
        ).rejects.toThrow("Schema documentation mismatch at tables");
        await client.query("DROP TABLE undocumented_empty_table");

        const unsupported = [
          [
            "CREATE SCHEMA unsupported_schema",
            "DROP SCHEMA unsupported_schema",
            "schema unsupported_schema",
          ],
          [
            "CREATE VIEW unsupported_view AS SELECT id FROM reference_fixture",
            "DROP VIEW unsupported_view",
            "relation unsupported_view",
          ],
          [
            "CREATE SEQUENCE unsupported_sequence",
            "DROP SEQUENCE unsupported_sequence",
            "relation unsupported_sequence",
          ],
          [
            "CREATE DOMAIN unsupported_domain AS text",
            "DROP DOMAIN unsupported_domain",
            "type unsupported_domain",
          ],
          [
            "ALTER TABLE reference_fixture ENABLE ROW LEVEL SECURITY",
            "ALTER TABLE reference_fixture DISABLE ROW LEVEL SECURITY",
            "row-level security reference_fixture",
          ],
          [
            "CREATE FUNCTION unsupported_routine() RETURNS integer LANGUAGE sql AS 'SELECT 1'",
            "DROP FUNCTION unsupported_routine()",
            "routine unsupported_routine",
          ],
          [
            "ALTER TABLE reference_fixture ADD COLUMN unsupported_generated integer GENERATED ALWAYS AS (1) STORED",
            "ALTER TABLE reference_fixture DROP COLUMN unsupported_generated",
            "generated column reference_fixture.unsupported_generated",
          ],
        ];
        for (const [create, drop, failure] of unsupported) {
          await client.query(create);
          try {
            await expect(
              generateDatabaseReference(migrationUrl, metadata),
            ).rejects.toThrow(failure);
          } finally {
            await client.query(drop);
          }
        }
        expect(await generateDatabaseReference(migrationUrl, metadata)).toBe(
          reference,
        );

        // A project without application tables gets an explicit empty reference.
        await client.query("DROP SCHEMA public CASCADE");
        await client.query("CREATE SCHEMA public");
        const empty = join(metadata, "empty");
        expect(await generateDatabaseReference(migrationUrl, empty)).toContain(
          "No application-owned tables exist yet.",
        );
      } finally {
        await client.end();
      }
    });
  } finally {
    await rm(metadata, { recursive: true, force: true });
  }
}, 120_000);

it("refuses metadata that two module files both claim", async () => {
  const metadata = await mkdtemp(join(tmpdir(), "orion-schema-metadata-"));
  try {
    await writeFile(join(metadata, "a.json"), JSON.stringify(fixtureMetadata));
    await writeFile(join(metadata, "b.json"), JSON.stringify(fixtureMetadata));
    await expect(readSchemaMetadata(metadata)).rejects.toThrow(
      "Schema metadata defines reference_fixture twice (b.json)",
    );
    expect(await readSchemaMetadata(join(metadata, "missing"))).toEqual({
      tables: {},
      enums: {},
    });
  } finally {
    await rm(metadata, { recursive: true, force: true });
  }
});
