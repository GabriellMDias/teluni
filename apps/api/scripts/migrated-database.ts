import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { GenericContainer, Wait } from "testcontainers";
import pg from "pg";
import { applyRuntimeGrants } from "./runtime-grants.js";

const run = promisify(execFile);
const appRoot = resolve(import.meta.dirname, "..");

/** Compare only Prisma-representable structure; SQL-only objects use catalog checks. */
export async function assertPrismaSchemaMatchesDatabase(
  migrationUrl: string,
): Promise<void> {
  try {
    await run(
      process.execPath,
      [
        resolve(appRoot, "node_modules/prisma/build/index.js"),
        "migrate",
        "diff",
        "--from-config-datasource",
        "--to-schema",
        resolve(appRoot, "prisma/schema"),
        "--exit-code",
      ],
      {
        cwd: appRoot,
        env: { ...process.env, ORION_MIGRATION_DATABASE_URL: migrationUrl },
        timeout: 90_000,
      },
    );
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === 2
    )
      throw new Error(
        "Prisma schema differs from committed migrations. Reconcile schema.prisma and reviewed migration SQL before generating references.",
        { cause: error },
      );
    throw error;
  }
}

export async function withMigratedDatabase<T>(
  work: (runtimeUrl: string, migrationUrl: string) => Promise<T>,
): Promise<T> {
  const container = await new GenericContainer("postgres:16")
    .withEnvironment({
      POSTGRES_USER: "postgres",
      POSTGRES_PASSWORD: "test",
      POSTGRES_DB: "orion",
    })
    .withExposedPorts(5432)
    .withWaitStrategy(
      // Initialization starts a temporary server before the final mapped server.
      Wait.forLogMessage("database system is ready to accept connections", 2),
    )
    .start();
  try {
    const url = `postgresql://postgres:test@${container.getHost()}:${container.getMappedPort(5432)}/orion`;
    await run(
      process.execPath,
      [
        resolve(appRoot, "node_modules/prisma/build/index.js"),
        "migrate",
        "deploy",
      ],
      {
        cwd: appRoot,
        env: { ...process.env, ORION_MIGRATION_DATABASE_URL: url },
        timeout: 90_000,
      },
    );
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    try {
      await admin.query(
        "CREATE ROLE orion_runtime LOGIN PASSWORD 'runtime_test'",
      );
      await applyRuntimeGrants(admin);
    } finally {
      await admin.end();
    }
    const runtimeUrl = `postgresql://orion_runtime:runtime_test@${container.getHost()}:${container.getMappedPort(5432)}/orion`;
    return await work(runtimeUrl, url);
  } finally {
    await container.stop();
  }
}
