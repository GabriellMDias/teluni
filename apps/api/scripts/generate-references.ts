import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { configReference } from "../src/config.js";
import { publicErrorRegistry } from "../src/error-registry.js";
import { apiModules } from "../src/modules.js";
import { generateOpenApi } from "./openapi.js";
import { generateDatabaseReference } from "./database-reference.js";
import {
  assertPrismaSchemaMatchesDatabase,
  withMigratedDatabase,
} from "./migrated-database.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const generated = [
  {
    path: resolve(root, "docs/generated/api/openapi.json"),
    content: await generateOpenApi(),
  },
  {
    path: resolve(root, "docs/generated/configuration/api.md"),
    content: [
      "# API Configuration Reference",
      "",
      "<!-- Generated from apps/api/src/config.ts. Run pnpm -C apps/api references:write; do not edit. -->",
      "",
      "[Configuration policy](../../architecture/configuration.md) · [API runtime](../../../apps/api/README.md)",
      "",
      "No values are eligible for client exposure. `ORION_ENV` is always required. The three token settings are configured together. The six `TELUNI_` human identity settings are also configured together and additionally require the token settings, whose issuer they reuse. API modules that require the database, bearer authentication or human identity stay unmounted until those settings exist, and production startup fails instead.",
      "",
      "| Environment variable | Type | Required | Default | Visibility | Classification | Secret | Purpose |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      ...configReference.map(
        (item) =>
          `| \`${item.name}\` | ${item.type.replaceAll("|", "\\|")} | ${item.required ? "yes" : "no"} | ${item.default ? `\`${item.default}\`` : "—"} | ${item.visibility} | ${item.classification} | ${item.secret ? "yes" : "no"} | ${item.purpose} |`,
      ),
      "",
    ].join("\n"),
  },
  {
    path: resolve(root, "docs/generated/api/errors.md"),
    content: [
      "# API Error Registry",
      "",
      "<!-- Generated from apps/api/src/errors.ts and composed module errors. Run pnpm -C apps/api references:write; do not edit. -->",
      "",
      "[Error contract](../../api/error-contract.md) · [API runtime](../../../apps/api/README.md)",
      "",
      "| Code | HTTP status | Category | Retryable | Public message |",
      "| --- | --- | --- | --- | --- |",
      ...Object.entries(publicErrorRegistry(apiModules)).map(
        ([code, item]) =>
          `| \`${code}\` | ${item.status} | ${item.category} | ${item.retryable ? "yes" : "no"} | ${item.message} |`,
      ),
      "",
    ].join("\n"),
  },
];

const write = process.argv[2] === "--write";
if (!write && process.argv[2] !== "--check")
  throw new Error("Expected --check or --write");
const normalizeLineEndings = (value: string) => value.replace(/\r\n?/g, "\n");
generated.push({
  path: resolve(root, "docs/generated/database/schema.md"),
  content: await withMigratedDatabase(async (_runtimeUrl, migrationUrl) => {
    await assertPrismaSchemaMatchesDatabase(migrationUrl);
    return generateDatabaseReference(migrationUrl);
  }),
});
for (const artifact of generated) {
  if (write) {
    await mkdir(dirname(artifact.path), { recursive: true });
    await writeFile(artifact.path, artifact.content);
  } else {
    const actual = await readFile(artifact.path, "utf8").catch(() => "");
    if (normalizeLineEndings(actual) !== normalizeLineEndings(artifact.content))
      throw new Error(`Generated reference drift: ${artifact.path}`);
  }
}
