import path from "node:path";
import ts from "typescript";

export const componentCategories = [
  "Actions",
  "Inputs",
  "Forms",
  "Data Display",
  "Feedback",
  "Navigation",
  "Overlays",
  "Layout",
  "Uncategorized",
];
const rootSource = "apps/web/src/components.tsx";
const exampleSource = "apps/web/src/documentation/examples.tsx";
const fail = (message) => {
  throw new Error(`Component documentation: ${message}`);
};
const text = (value) => typeof value === "string" && value.trim().length > 0;
export const isComponentMetadata = (name) =>
  /^apps\/web\/src\/(?:[^/]+\/)*components\.docs\.json$/.test(name);

export function componentSourcePath(name) {
  if (
    typeof name !== "string" ||
    !/^apps\/web\/src\/.+\.[jt]sx?$/.test(name) ||
    name.startsWith("apps/web/src/generated/") ||
    name.includes("\\") ||
    name.split("/").some((part) => part === "." || part === "..")
  )
    fail(`invalid component source: ${name}`);
  return name;
}

function syntax(name, content) {
  const file = ts.createSourceFile(
    name,
    content,
    ts.ScriptTarget.Latest,
    true,
    name.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  if (file.parseDiagnostics.length) fail(`invalid component syntax: ${name}`);
  return file;
}

export function resolveComponentModule(from, specifier, available) {
  if (!specifier.startsWith("."))
    fail(`component re-export must reference an owned local source: ${from}`);
  const base = path.posix.normalize(
    path.posix.join(path.posix.dirname(from), specifier),
  );
  const stem = base.replace(/\.[jt]sx?$/, "");
  for (const candidate of [
    base,
    ...[".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts"].map(
      (extension) => stem + extension,
    ),
  ]) {
    if (available.has(candidate)) return componentSourcePath(candidate);
  }
  fail(`broken component re-export in ${from}: ${specifier}`);
}

function imports(file) {
  const result = new Map();
  for (const node of file.statements) {
    if (
      !ts.isImportDeclaration(node) ||
      !node.importClause ||
      node.importClause.isTypeOnly
    )
      continue;
    const module = node.moduleSpecifier.text;
    if (node.importClause.name)
      result.set(node.importClause.name.text, { module, name: "default" });
    const bindings = node.importClause.namedBindings;
    if (bindings && ts.isNamedImports(bindings))
      for (const item of bindings.elements) {
        if (!item.isTypeOnly)
          result.set(item.name.text, {
            module,
            name: item.propertyName?.text ?? item.name.text,
          });
      }
  }
  return result;
}

function runtimeExport(node) {
  return (
    ts.isExportDeclaration(node) &&
    !node.isTypeOnly &&
    (!node.exportClause ||
      !ts.isNamedExports(node.exportClause) ||
      node.exportClause.elements.some((item) => !item.isTypeOnly))
  );
}

function bindingNames(binding) {
  if (ts.isIdentifier(binding)) return [binding.text];
  return binding.elements.flatMap((item) =>
    ts.isOmittedExpression(item) ? [] : bindingNames(item.name),
  );
}

/** Read only metadata-selected sources and the re-exports needed to verify them. */
export function componentDependencies(name, content, available) {
  if (isComponentMetadata(name)) {
    const metadata = JSON.parse(content);
    if (!metadata || !Array.isArray(metadata.components))
      fail(`component metadata is missing: ${name}`);
    return metadata.components.map((item) =>
      componentSourcePath(
        item?.source ??
          metadata.source ??
          `${path.posix.dirname(name)}/components.tsx`,
      ),
    );
  }
  const file = syntax(name, content);
  const imported = imports(file);
  return file.statements.flatMap((node) => {
    if (!runtimeExport(node)) return [];
    if (node.moduleSpecifier)
      return [
        resolveComponentModule(name, node.moduleSpecifier.text, available),
      ];
    if (!node.exportClause || !ts.isNamedExports(node.exportClause)) return [];
    return node.exportClause.elements
      .filter((item) => !item.isTypeOnly)
      .flatMap((item) => {
        const reference = imported.get(
          item.propertyName?.text ?? item.name.text,
        );
        return reference
          ? [resolveComponentModule(name, reference.module, available)]
          : [];
      });
  });
}

export function componentExports(
  name,
  sources,
  visiting = new Set(),
  cache = new Map(),
) {
  if (visiting.has(name)) fail(`cyclic component re-export: ${name}`);
  if (cache.has(name)) return cache.get(name);
  if (!sources.has(name)) fail(`missing component source: ${name}`);
  const file = syntax(name, sources.get(name));
  const imported = imports(file);
  const locals = new Set();
  const result = new Map();
  const next = new Set([...visiting, name]);
  const referenced = (module, exported) => {
    const target = resolveComponentModule(name, module, sources);
    const values = componentExports(target, sources, next, cache);
    if (!values.has(exported))
      fail(`missing component export ${exported} in ${target}`);
    return values.get(exported);
  };
  for (const node of file.statements) {
    if (ts.isExportAssignment(node) && !node.isExportEquals)
      result.set("default", `${name}#default`);
    if (
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
      !node.name &&
      node.modifiers?.some((item) => item.kind === ts.SyntaxKind.DefaultKeyword)
    )
      result.set("default", `${name}#default`);
    const names = ts.isVariableStatement(node)
      ? node.declarationList.declarations.flatMap((item) =>
          bindingNames(item.name),
        )
      : (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
          node.name
        ? [node.name.text]
        : [];
    for (const local of names) {
      locals.add(local);
      if (
        node.modifiers?.some(
          (item) => item.kind === ts.SyntaxKind.ExportKeyword,
        )
      ) {
        const exported = node.modifiers.some(
          (item) => item.kind === ts.SyntaxKind.DefaultKeyword,
        )
          ? "default"
          : local;
        result.set(exported, `${name}#${local}`);
      }
    }
  }
  for (const node of file.statements) {
    if (!runtimeExport(node)) continue;
    const module = node.moduleSpecifier?.text;
    if (!node.exportClause) {
      for (const [exported, identity] of componentExports(
        resolveComponentModule(name, module, sources),
        sources,
        next,
        cache,
      )) {
        if (exported !== "default") {
          if (result.has(exported) && result.get(exported) !== identity)
            fail(`ambiguous component export ${exported} in ${name}`);
          result.set(exported, identity);
        }
      }
    } else if (ts.isNamedExports(node.exportClause)) {
      for (const item of node.exportClause.elements) {
        if (item.isTypeOnly) continue;
        const original = item.propertyName?.text ?? item.name.text;
        const reference = imported.get(original);
        if (!module && !reference && !locals.has(original))
          fail(`missing local component export ${original} in ${name}`);
        result.set(
          item.name.text,
          module
            ? referenced(module, original)
            : reference
              ? referenced(reference.module, reference.name)
              : `${name}#${original}`,
        );
      }
    }
  }
  cache.set(name, result);
  return result;
}

export function readComponents(sources) {
  const metadataFiles = [...sources.keys()].filter(isComponentMetadata).sort();
  const categories = new Set(componentCategories);
  const inventories = metadataFiles.map((file) => {
    const metadata = JSON.parse(sources.get(file));
    if (!metadata || !Array.isArray(metadata.components))
      fail(`component metadata is missing: ${file}`);
    if (
      metadata.categories !== undefined &&
      (!Array.isArray(metadata.categories) ||
        metadata.categories.some((value) => !text(value)) ||
        new Set(metadata.categories).size !== metadata.categories.length)
    )
      fail(`invalid component categories: ${file}`);
    for (const category of metadata.categories ?? []) categories.add(category);
    return { file, metadata };
  });
  const ids = new Set();
  const examples = new Set();
  const components = [];
  const definitions = new Map();
  const exportCache = new Map();
  const sharedExports = componentExports(
    rootSource,
    sources,
    new Set(),
    exportCache,
  );
  if (sharedExports.has("default"))
    fail("shared components must use explicit named exports");
  for (const { file, metadata } of inventories)
    for (const item of metadata.components) {
      if (
        !item ||
        !/^[A-Z][A-Za-z0-9]*$/.test(item.name) ||
        !text(item.summary) ||
        !text(item.usage) ||
        !text(item.accessibility) ||
        !Array.isArray(item.props) ||
        !Array.isArray(item.states) ||
        !item.states.length ||
        item.states.some((state) => !text(state)) ||
        !Array.isArray(item.examples) ||
        !item.examples.length
      )
        fail(`incomplete metadata in ${file}`);
      const source = componentSourcePath(
        item.source ??
          metadata.source ??
          `${path.posix.dirname(file)}/components.tsx`,
      );
      const exported = componentExports(
        source,
        sources,
        new Set(),
        exportCache,
      );
      const exportName = item.exportName ?? item.name;
      if (!exported.has(exportName))
        fail(`missing component export ${exportName} in ${source}`);
      const shared =
        sharedExports.has(item.name) &&
        sharedExports.get(item.name) === exported.get(exportName);
      const component = {
        ...item,
        id: item.id ?? item.name,
        exportName,
        category: item.category ?? "Uncategorized",
        scope: item.scope ?? (shared ? "shared" : "feature-specific"),
        owner: item.owner ?? source,
        source,
        metadataSource: file,
      };
      if (
        !/^[A-Za-z][A-Za-z0-9._-]{0,99}$/.test(component.id) ||
        ids.has(component.id)
      )
        fail(`invalid or duplicate component id: ${component.id}`);
      if (
        !categories.has(component.category) ||
        !["shared", "composed", "feature-specific"].includes(component.scope) ||
        !text(component.owner)
      )
        fail(`invalid category, scope or owner for ${component.name}`);
      ids.add(component.id);
      if (
        item.props.some(
          (prop) =>
            !prop ||
            !text(prop.name) ||
            !text(prop.type) ||
            !text(prop.meaning) ||
            (prop.required !== undefined &&
              typeof prop.required !== "boolean") ||
            (prop.default !== undefined && !text(prop.default)),
        ) ||
        new Set(item.props.map((prop) => prop.name)).size !== item.props.length
      )
        fail(`incomplete or duplicate prop metadata for ${component.name}`);
      definitions.set(component.id, exported.get(component.exportName));
      component.examples = item.examples.map((example) => {
        if (
          !example ||
          !/^[A-Za-z][A-Za-z0-9._-]*$/.test(example.id) ||
          !text(example.label) ||
          !text(example.description) ||
          examples.has(example.id) ||
          (example.code !== undefined && !text(example.code)) ||
          (example.live !== undefined && typeof example.live !== "boolean")
        )
          fail(`missing or duplicate example metadata for ${component.name}`);
        examples.add(example.id);
        const live = example.live ?? example.code === undefined;
        if (
          live &&
          !sources.get(exampleSource)?.includes(`case "${example.id}":`)
        )
          fail(`missing live example renderer for ${example.id}`);
        if (!live && !text(example.code))
          fail(`static example needs code: ${example.id}`);
        return { ...example, live };
      });
      components.push(component);
    }
  for (const [name, definition] of sharedExports) {
    if (
      /^[A-Z]/.test(name) &&
      !components.some(
        (item) =>
          item.name === name &&
          item.scope !== "feature-specific" &&
          definitions.get(item.id) === definition,
      )
    )
      fail(`every exported web component needs owned metadata: ${name}`);
  }
  return { components, categories: [...categories] };
}

export function componentMarkdown(components) {
  return [
    "# Web Component Reference",
    "",
    "<!-- Generated from owned components.docs.json files and verified against named component exports. Do not edit. -->",
    "",
    "[Component architecture](../../architecture/web-components.md) · [Living documentation](../../architecture/living-documentation.md)",
    "",
    ...components.flatMap((component) => [
      `## ${component.name}`,
      "",
      component.summary,
      "",
      `Category: ${component.category}. Scope: ${component.scope}. Owner: ${component.owner}.`,
      "",
      `Source: [${component.source}](../../../${component.source}) (export \`${component.exportName}\`). Metadata: [${component.metadataSource}](../../../${component.metadataSource}).`,
      "",
      "### Props",
      "",
      "| Name | Type | Meaning | Required | Default |",
      "| --- | --- | --- | --- | --- |",
      ...component.props.map(
        (prop) =>
          `| \`${prop.name.replaceAll("|", "\\|")}\` | \`${prop.type.replaceAll("|", "\\|")}\` | ${prop.meaning.replaceAll("|", "\\|")} | ${prop.required === undefined ? "See type" : prop.required ? "Yes" : "No"} | ${(prop.default ?? "—").replaceAll("|", "\\|")} |`,
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
      ...component.examples.flatMap((example) => [
        `- **${example.label}** (\`${example.id}\`): ${example.description}`,
        ...(example.code ? ["", "```tsx", example.code, "```", ""] : []),
      ]),
      "",
    ]),
  ].join("\n");
}
