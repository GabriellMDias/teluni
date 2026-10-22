import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type pg from "pg";

const runtimeGrants = resolve(import.meta.dirname, "../prisma/runtime-grants");

/** Least-privilege runtime grants that each module declares beside its schema. */
export async function runtimeGrantStatements(
  directory = runtimeGrants,
): Promise<string[]> {
  let files: string[];
  try {
    files = (await readdir(directory)).filter((name) => name.endsWith(".sql"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const statements: string[] = [];
  for (const file of files.sort())
    statements.push(
      ...(await readFile(resolve(directory, file), "utf8"))
        .replace(/--[^\n]*/g, "")
        .split(";")
        .map((statement) => statement.trim())
        .filter(Boolean),
    );
  return statements;
}

/**
 * Gives the existing runtime role schema usage and every module's grants.
 * GRANT is idempotent, so this runs after each migration.
 */
export async function applyRuntimeGrants(owner: pg.Client): Promise<void> {
  await owner.query("GRANT USAGE ON SCHEMA public TO orion_runtime");
  for (const statement of await runtimeGrantStatements())
    await owner.query(statement);
}
