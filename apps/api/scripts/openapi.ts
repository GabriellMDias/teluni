import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { healthOperations } from "../src/health-contracts.js";
import { publicErrorRegistry } from "../src/error-registry.js";
import type { ApiModule, ApiOperation } from "../src/module.js";
import { apiModules } from "../src/modules.js";
import prettier from "prettier";

// The repository identity names the API; derived projects title their own.
async function projectName(): Promise<string> {
  const manifest: unknown = JSON.parse(
    await readFile(
      resolve(import.meta.dirname, "../../../.orion/project.json"),
      "utf8",
    ),
  );
  const name =
    manifest && typeof manifest === "object" && "name" in manifest
      ? manifest.name
      : undefined;
  if (typeof name !== "string" || !name.trim())
    throw new Error("Missing project name in .orion/project.json");
  return name;
}

type Schema = Record<string, unknown>;
function asSchema(value: object): Schema {
  return value as Schema;
}
function response(schema: unknown, status: string) {
  // A `Type.Null()` response has no body, such as a redirect or 204.
  const empty =
    typeof schema === "object" &&
    schema !== null &&
    (schema as Schema).type === "null";
  return {
    description: "Response",
    ...(status === "429"
      ? {
          headers: {
            "Retry-After": {
              description: "Seconds until a bounded retry is allowed.",
              schema: { type: "integer", minimum: 1 },
            },
          },
        }
      : status.startsWith("3")
        ? {
            headers: {
              Location: {
                description: "Destination of the browser redirect.",
                schema: { type: "string" },
              },
            },
          }
        : {}),
    ...(empty ? {} : { content: { "application/json": { schema } } }),
  };
}

export async function generateOpenApi(
  modules: readonly ApiModule[] = apiModules,
): Promise<string> {
  const paths: Record<string, Record<string, unknown>> = {};
  const ids = new Set<string>();
  const errorRegistry = publicErrorRegistry(modules);
  const operations: {
    operation: ApiOperation;
    tag: string;
    security: "none" | "bearer" | "session";
  }[] = [
    ...healthOperations.map((operation) => ({
      operation,
      tag: "Health",
      security: "none" as const,
    })),
    ...modules.flatMap((module) =>
      module.operations.map((operation) => ({
        operation,
        tag: module.tag,
        security:
          operation.access === "public"
            ? ("none" as const)
            : operation.access === "session"
              ? ("session" as const)
              : module.requires.includes("authentication")
                ? ("bearer" as const)
                : ("none" as const),
      })),
    ),
  ];
  for (const { operation, tag, security } of operations) {
    if (ids.has(operation.operationId))
      throw new Error(`Duplicate operationId: ${operation.operationId}`);
    ids.add(operation.operationId);
    const path = operation.url.replace(/:([A-Za-z][A-Za-z0-9_]*)/g, "{$1}");
    const schema = operation.schema;
    const parameters: unknown[] = [];
    if (schema.params) {
      const params = asSchema(schema.params);
      for (const [name, field] of Object.entries(
        params.properties as Record<string, unknown>,
      ))
        parameters.push({ name, in: "path", required: true, schema: field });
    }
    if (schema.querystring) {
      const query = asSchema(schema.querystring);
      for (const [name, field] of Object.entries(
        query.properties as Record<string, unknown>,
      ))
        parameters.push({
          name,
          in: "query",
          required:
            (query.required as string[] | undefined)?.includes(name) ?? false,
          schema: field,
        });
    }
    if (schema.headers) {
      const headers = asSchema(schema.headers);
      for (const [name, field] of Object.entries(
        headers.properties as Record<string, unknown>,
      ))
        parameters.push({ name, in: "header", required: true, schema: field });
    }
    const responses = Object.fromEntries(
      Object.entries(schema.response).map(([code, value]) => [
        code,
        response(value, code),
      ]),
    );
    if (operation.expectedErrors) {
      for (const code of operation.expectedErrors) {
        const definition = errorRegistry[code];
        if (!definition || !(String(definition.status) in responses))
          throw new Error(
            `Undeclared expected error ${code} on ${operation.operationId}`,
          );
      }
    }
    const descriptor: Record<string, unknown> = {
      operationId: operation.operationId,
      description: operation.description,
      tags: [tag],
      ...(security === "bearer"
        ? { security: [{ bearerAuth: [] }] }
        : security === "session"
          ? { security: [{ sessionCookie: [] }] }
          : {}),
      parameters,
      ...(schema.body
        ? {
            requestBody: {
              required: true,
              content: {
                [operation.bodyContentType ?? "application/json"]: {
                  schema: schema.body,
                },
              },
            },
          }
        : {}),
      responses,
      ...(operation.expectedErrors
        ? { "x-expected-error-codes": operation.expectedErrors }
        : {}),
    };
    paths[path] ??= {};
    if (paths[path][operation.method.toLowerCase()])
      throw new Error(`Duplicate route metadata: ${operation.method} ${path}`);
    paths[path][operation.method.toLowerCase()] = descriptor;
  }
  return await prettier.format(
    JSON.stringify(
      {
        openapi: "3.1.0",
        info: { title: `${await projectName()} API`, version: "1.0.0" },
        servers: [{ url: "/" }],
        paths,
        ...(operations.some(({ security }) => security !== "none")
          ? {
              components: {
                securitySchemes: {
                  ...(operations.some(({ security }) => security === "bearer")
                    ? {
                        bearerAuth: {
                          type: "http",
                          scheme: "bearer",
                          bearerFormat: "JWT",
                        },
                      }
                    : {}),
                  ...(operations.some(({ security }) => security === "session")
                    ? {
                        sessionCookie: {
                          type: "apiKey",
                          in: "cookie",
                          name: "__Host-teluni_session",
                          description:
                            "Opaque server-managed human session. Loopback development uses teluni_session. Unsafe methods also require the session CSRF token in X-CSRF-Token and a matching Origin.",
                        },
                      }
                    : {}),
                },
              },
            }
          : {}),
      },
      null,
      2,
    ),
    { parser: "json" },
  );
}
