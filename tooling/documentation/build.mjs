import prettier from "prettier";
import { Buffer } from "node:buffer";
import {
  documentGroup,
  documentId,
  renderDocument,
  sourceBaseFrom,
} from "./markdown.mjs";

const fail = (message) => {
  throw new Error(`Living documentation: ${message}`);
};

function operationComponents(operation, components = {}) {
  const selected = {};
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (
      typeof value.$ref === "string" &&
      value.$ref.startsWith("#/components/")
    ) {
      const [category, key] = value.$ref
        .slice("#/components/".length)
        .split("/")
        .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
      if (!components[category]?.[key])
        fail(`missing OpenAPI reference ${value.$ref}`);
      selected[category] ??= {};
      if (!Object.hasOwn(selected[category], key)) {
        selected[category][key] = components[category][key];
        visit(components[category][key]);
      }
    }
    for (const item of Object.values(value)) visit(item);
  };
  visit(operation);
  for (const requirement of operation.security) {
    for (const name of Object.keys(requirement)) {
      if (!components.securitySchemes?.[name])
        fail(`missing security scheme ${name}`);
      selected.securitySchemes ??= {};
      selected.securitySchemes[name] = components.securitySchemes[name];
    }
  }
  return selected;
}

function authenticationLabel(security, components) {
  if (!security.length) return "None declared";
  return security
    .map((requirement) => {
      const names = Object.keys(requirement);
      if (!names.length) return "Anonymous allowed";
      return names
        .map((name) => {
          const scheme = components.securitySchemes?.[name];
          if (
            scheme?.type === "http" &&
            scheme.scheme?.toLowerCase() === "bearer"
          )
            return "Bearer access token";
          if (scheme?.type === "apiKey" && scheme.in === "cookie")
            return "Session cookie";
          return `${name} (${scheme?.type ?? "unknown"})`;
        })
        .join(" and ");
    })
    .join(" or ");
}
function markdownRows(source, heading) {
  const allLines = source.split("\n");
  const start = allLines.findIndex((line) => line.startsWith(heading));
  if (start < 0) fail(`missing ${heading} in generated reference`);
  const lines = allLines.slice(heading.startsWith("|") ? start : start + 1);
  const rows = [];
  let inTable = false;
  for (const line of lines) {
    if (line.startsWith("#") && inTable) break;
    if (!line.startsWith("|")) {
      if (inTable) break;
      continue;
    }
    const cells = line
      .slice(1, -1)
      .split("|")
      .map((cell) => cell.trim());
    if (cells.every((cell) => /^[-: ]+$/.test(cell))) continue;
    inTable = true;
    rows.push(cells.map((cell) => cell.replaceAll("`", "")));
  }
  if (rows.length < 2) fail(`empty table after ${heading}`);
  const [headers, ...values] = rows;
  return values.map((cells) => {
    if (cells.length !== headers.length)
      fail(`malformed table after ${heading}`);
    return Object.fromEntries(
      headers.map((header, index) => [header, cells[index]]),
    );
  });
}

function schemaType(schema) {
  if (!schema) return "none";
  if (schema.anyOf) return schema.anyOf.map(schemaType).join(" | ");
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  const type =
    schema.type === "array"
      ? `array of ${schemaType(schema.items)}`
      : (schema.type ?? (schema.$ref ? schema.$ref : "unknown"));
  const details = [];
  if (schema.format) details.push(schema.format);
  if (schema.minLength !== undefined)
    details.push(`min length ${schema.minLength}`);
  if (schema.maxLength !== undefined)
    details.push(`max length ${schema.maxLength}`);
  if (schema.minimum !== undefined) details.push(`minimum ${schema.minimum}`);
  if (schema.maximum !== undefined) details.push(`maximum ${schema.maximum}`);
  if (schema.pattern) details.push(`pattern ${schema.pattern}`);
  return `${type}${details.length ? ` (${details.join(", ")})` : ""}`;
}

function fields(schema, prefix = "") {
  if (!schema?.properties) return [];
  return Object.entries(schema.properties).flatMap(([name, value]) => {
    const qualified = `${prefix}${name}`;
    const row = {
      name: qualified,
      type: schemaType(value),
      required: schema.required?.includes(name) ?? false,
    };
    return [
      row,
      ...fields(value, `${qualified}.`),
      ...fields(value.items, `${qualified}[].`),
    ];
  });
}

export async function buildDocumentation(sources) {
  const read = async (name) => {
    if (!sources.has(name)) fail(`missing source ${name}`);
    return sources.get(name).replaceAll("\r\n", "\n");
  };
  const outputs = new Map();
  const projectSource = await read(".orion/project.json");
  const sourceBase = sourceBaseFrom(projectSource);
  // The portal belongs to the repository it documents, Orion or a project.
  const projectName = JSON.parse(projectSource).name;
  if (typeof projectName !== "string" || !projectName.trim())
    fail("missing project name in .orion/project.json");
  const openapiText = await read("docs/generated/api/openapi.json");
  const openapi = JSON.parse(openapiText);
  if (!openapi.openapi?.startsWith("3.1.")) fail("expected OpenAPI 3.1");
  const operations = [];
  for (const [route, methods] of Object.entries(openapi.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      if (
        ![
          "get",
          "post",
          "put",
          "patch",
          "delete",
          "options",
          "head",
          "trace",
        ].includes(method)
      )
        continue;
      // Browser-navigation operations succeed with a redirect instead of 2xx.
      const success = Object.entries(operation.responses).filter(
        ([status]) => status.startsWith("2") || status.startsWith("3"),
      );
      if (!operation.operationId || success.length === 0)
        fail(`missing operationId or success response: ${method} ${route}`);
      // Most bodies are JSON; protocol endpoints may declare a form instead.
      const requestSchema =
        operation.requestBody?.content?.["application/json"]?.schema ??
        Object.values(operation.requestBody?.content ?? {})[0]?.schema;
      const security = operation.security ?? openapi.security ?? [];
      const parameters = new Map();
      for (const parameter of [
        ...(methods.parameters ?? []),
        ...(operation.parameters ?? []),
      ])
        parameters.set(
          parameter.$ref ?? `${parameter.in}:${parameter.name}`,
          parameter,
        );
      operations.push({
        kind: "api",
        operationId: operation.operationId,
        summary: operation.summary ?? "",
        description: operation.description ?? "",
        security,
        components: operationComponents(
          { ...operation, parameters: [...parameters.values()], security },
          openapi.components,
        ),
        method: method.toUpperCase(),
        path: route,
        tags: operation.tags ?? [],
        authentication: authenticationLabel(security, openapi.components ?? {}),
        parameters: [...parameters.values()].map((parameter) => ({
          ...parameter,
          name: parameter.name,
          in: parameter.in,
          required: parameter.required ?? false,
          type: schemaType(parameter.schema),
          description: parameter.description ?? "",
          schema: parameter.schema ?? {},
        })),
        request: operation.requestBody
          ? {
              required: operation.requestBody.required ?? false,
              description: operation.requestBody.description ?? "",
              content: operation.requestBody.content ?? {},
              schema: requestSchema ?? null,
              fields: fields(requestSchema),
            }
          : null,
        responses: Object.entries(operation.responses).map(
          ([status, response]) => ({
            status,
            description: response.description ?? "",
            content: response.content ?? {},
            schema: response.content?.["application/json"]?.schema ?? null,
            fields: fields(response.content?.["application/json"]?.schema),
          }),
        ),
      });
    }
  }
  const ids = operations.map((operation) => operation.operationId);
  if (new Set(ids).size !== ids.length) fail("duplicate API operationId");

  const databaseText = await read("docs/generated/database/schema.md");
  const tableHeadings = [...databaseText.matchAll(/^## ([a-z][a-z0-9_]*)$/gm)]
    .map((match) => match[1])
    .filter((name) => name !== "database_enums");
  const tables = tableHeadings.map((name) => {
    const section = databaseText.split(`## ${name}\n`)[1]?.split(/^## /m)[0];
    if (!section) fail(`missing database section ${name}`);
    const description = section
      .split("\n")
      .find((line) => line.trim() && !line.startsWith("<!--"));
    const ownerLine = section.match(/^Owner: (.+)\. Classification: (.+)\.$/m);
    const lifecycle = section.match(/^Lifecycle: (.+)$/m);
    if (!description || !ownerLine || !lifecycle)
      fail(`missing table metadata: ${name}`);
    return {
      name,
      description,
      owner: ownerLine[1],
      classification: ownerLine[2],
      lifecycle: lifecycle[1],
      columns: markdownRows(section, "| Column |"),
      constraints: markdownRows(section, "### Constraints and indexes"),
    };
  });
  if (
    tables.length === 0 &&
    !databaseText.includes("No application-owned tables exist yet.")
  )
    fail("database reference has neither tables nor its empty-state statement");
  if (databaseText.includes("\n## Database enums\n"))
    markdownRows(databaseText, "## Database enums");
  const errorsText = await read("docs/generated/api/errors.md");
  markdownRows(errorsText, "| Code |");

  const componentText = await read("apps/web/src/components.docs.json");
  const componentSource = await read("apps/web/src/components.tsx");
  const portalSource = await read("apps/web/src/documentation/examples.tsx");
  const componentMetadata = JSON.parse(componentText);
  const components = componentMetadata.components;
  if (!Array.isArray(components)) fail("component metadata is missing");
  const actualExports = [
    ...componentSource.matchAll(/export function ([A-Z][A-Za-z0-9]*)\(/g),
  ].map((match) => match[1]);
  if (
    actualExports.length !== components.length ||
    actualExports.some((name) => !components.some((item) => item.name === name))
  )
    fail("every exported web component needs owned metadata");
  const exampleIds = new Set();
  for (const component of components) {
    if (
      !actualExports.includes(component.name) ||
      !component.summary ||
      !component.usage ||
      !component.accessibility ||
      !Array.isArray(component.props) ||
      !component.props.length ||
      !Array.isArray(component.states) ||
      !component.states.length ||
      !Array.isArray(component.examples) ||
      !component.examples.length
    )
      fail(`incomplete metadata for ${component.name}`);
    if (
      component.props.some(
        (prop) => !prop.name || !prop.type || !prop.meaning,
      ) ||
      component.states.some(
        (state) => typeof state !== "string" || !state.trim(),
      )
    )
      fail(`incomplete prop or state metadata for ${component.name}`);
    for (const example of component.examples) {
      if (
        !example.id ||
        !example.label ||
        !example.description ||
        exampleIds.has(example.id)
      )
        fail(`missing or duplicate example metadata for ${component.name}`);
      if (!portalSource.includes(`case "${example.id}":`))
        fail(`missing live example renderer for ${example.id}`);
      exampleIds.add(example.id);
    }
  }

  const componentMarkdown = [
    "# Web Component Reference",
    "",
    "<!-- Generated from apps/web/src/components.docs.json and verified against components.tsx. Do not edit. -->",
    "",
    "[Living documentation](../../architecture/living-documentation.md) · [Component source](../../../apps/web/src/components.tsx)",
    "",
    ...components.flatMap((component) => [
      `## ${component.name}`,
      "",
      component.summary,
      "",
      "### Props",
      "",
      "| Name | Type | Meaning |",
      "| --- | --- | --- |",
      ...component.props.map(
        (prop) =>
          `| \`${prop.name.replaceAll("|", "\\|")}\` | \`${prop.type.replaceAll("|", "\\|")}\` | ${prop.meaning.replaceAll("|", "\\|")} |`,
      ),
      "",
      "### States",
      "",
      ...component.states.map((state) => `- ${state}`),
      "",
      `Accessibility: ${component.accessibility}`,
      "",
      `Usage: ${component.usage}`,
      "",
      "### Examples",
      "",
      ...component.examples.map(
        (example) =>
          `- **${example.label}** (\`${example.id}\`): ${example.description}`,
      ),
      "",
    ]),
  ].join("\n");

  const entries = [];
  const records = [];
  const entryIds = new Set();
  const formatJson = (data) =>
    prettier.format(JSON.stringify(data), { parser: "json" });
  async function addEntry(entry, detail, searchable) {
    if (!entry.id || entryIds.has(entry.id))
      fail(`missing or duplicate page id ${entry.id}`);
    if (
      !/^[A-Za-z0-9_./-]+$/.test(entry.id) ||
      entry.id.split("/").includes("..")
    )
      fail(`unsafe page id ${entry.id}`);
    entryIds.add(entry.id);
    const file = `pages/${entry.id}.json`;
    entries.push({ ...entry, file });
    outputs.set(`apps/web/src/generated/${file}`, await formatJson(detail));
    for (const section of searchable) {
      // Keep one section's records contiguous across shards. The search worker
      // combines term coverage without retaining the section; a 200-character
      // overlap preserves terms at chunk boundaries up to the query limit.
      const chunkSize = 12_000;
      const overlap = 200;
      for (
        let start = 0;
        start < section.text.length;
        start += chunkSize - overlap
      ) {
        const text = section.text.slice(start, start + chunkSize);
        records.push({
          id: entry.id,
          title: entry.title,
          group: entry.group,
          kind: entry.kind,
          ...section,
          text,
        });
        if (start + chunkSize >= section.text.length) break;
      }
    }
  }
  for (const operation of operations.sort((a, b) =>
    a.operationId.localeCompare(b.operationId, "en"),
  )) {
    await addEntry(
      {
        id: `api/${operation.operationId}`,
        kind: "api",
        title: operation.summary || operation.operationId,
        group: operation.tags[0] ?? "Operations",
        source: "docs/generated/api/openapi.json",
        summary: `${operation.method} ${operation.path}`,
        method: operation.method,
        path: operation.path,
        tags: operation.tags,
        headings: [
          { id: "parameters", text: "Parameters", level: 2 },
          ...(operation.request
            ? [{ id: "request", text: "Request body", level: 2 }]
            : []),
          { id: "responses", text: "Responses", level: 2 },
          { id: "explorer", text: "Try this operation", level: 2 },
        ],
      },
      operation,
      [{ text: JSON.stringify(operation) }],
    );
  }
  for (const table of tables.sort((a, b) =>
    a.name.localeCompare(b.name, "en"),
  )) {
    await addEntry(
      {
        id: `database/${table.name}`,
        kind: "database",
        title: table.name,
        group: table.owner,
        source: "docs/generated/database/schema.md",
        summary: table.description,
        headings: [],
      },
      { kind: "database", ...table },
      [{ text: JSON.stringify(table) }],
    );
  }
  for (const component of components.toSorted((a, b) =>
    a.name.localeCompare(b.name, "en"),
  )) {
    await addEntry(
      {
        id: `components/${component.name}`,
        kind: "component",
        title: component.name,
        group: "Web components",
        source: "apps/web/src/components.tsx",
        summary: component.summary,
        headings: [],
      },
      { kind: "component", ...component },
      [{ text: JSON.stringify(component) }],
    );
  }
  outputs.set("docs/generated/components/web.md", componentMarkdown);
  const documents = new Map(
    [...sources].filter(([name]) => name.endsWith(".md")),
  );
  documents.set("docs/generated/components/web.md", componentMarkdown);
  const available = new Set(documents.keys());
  for (const [source, text] of [...documents].sort(([a], [b]) =>
    a.localeCompare(b, "en"),
  )) {
    const rendered = renderDocument(
      source,
      text.replaceAll("\r\n", "\n"),
      available,
      sourceBase,
    );
    const { title, headings, html, sections, summary } = rendered;
    await addEntry(
      {
        id: documentId(source),
        kind: "repository",
        title,
        group: documentGroup(source),
        source,
        summary,
        headings: [],
      },
      { kind: "repository", source, title, html, headings },
      sections,
    );
  }
  const shards = [];
  let batch = [];
  let size = 0;
  async function flush() {
    if (!batch.length) return;
    const file = `search/${String(shards.length).padStart(4, "0")}.json`;
    outputs.set(`apps/web/src/generated/${file}`, await formatJson(batch));
    shards.push({
      file,
      count: batch.length,
      kinds: [...new Set(batch.map((record) => record.kind))].sort(),
    });
    batch = [];
    size = 0;
  }
  for (const record of records) {
    const recordSize = Buffer.byteLength(JSON.stringify(record), "utf8");
    if (size + recordSize > 128 * 1024) await flush();
    batch.push(record);
    size += recordSize;
  }
  await flush();
  outputs.set(
    "apps/web/src/generated/manifest.json",
    await formatJson({
      version: 1,
      title: `${projectName} Living Documentation`,
      api: { title: openapi.info.title, version: openapi.info.version },
      entries,
      search: { shards, count: records.length },
    }),
  );
  for (const [name, value] of [...outputs, ...sources]) {
    if (
      /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----|eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|postgres(?:ql)?:\/\/[^\s/@]+:[^\s/@]+@/i.test(
        value,
      )
    )
      fail(`sensitive content detected in ${name}`);
  }
  return outputs;
}
