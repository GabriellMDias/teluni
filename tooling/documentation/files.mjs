import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { documentationPaths } from "./markdown.mjs";
import { componentDependencies, isComponentMetadata } from "./components.mjs";

const run = promisify(execFile);
const generatedRoot = "apps/web/src/generated";
const fixedSources = [
  ".orion/project.json",
  "docs/generated/api/openapi.json",
  "docs/generated/api/errors.md",
  "docs/generated/database/schema.md",
  "apps/web/src/components.docs.json",
  "apps/web/src/components.tsx",
  "apps/web/src/documentation/examples.tsx",
];

export async function readSources(root) {
  const { stdout } = await run(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, maxBuffer: 32 * 1024 * 1024 },
  );
  const names = new Set([
    ...documentationPaths(stdout.split("\0").filter(Boolean)),
    ...stdout.split("\0").filter(isComponentMetadata),
    ...fixedSources,
  ]);
  const sources = new Map();
  async function readSource(name) {
    try {
      await lstat(path.join(root, name));
    } catch (error) {
      if (error.code === "ENOENT" && !fixedSources.includes(name)) return;
      throw error;
    }
    // Git symlinks must never let publication read files outside the checkout.
    for (
      let parent = name;
      parent !== ".";
      parent = path.posix.dirname(parent)
    ) {
      if ((await lstat(path.join(root, parent))).isSymbolicLink())
        throw new Error(`Symlink is not a documentation input: ${name}`);
    }
    sources.set(name, await readFile(path.join(root, name), "utf8"));
  }
  for (const name of [...names].sort()) await readSource(name);
  const available = new Set(stdout.split("\0").filter(Boolean));
  const pending = [...sources.keys()].filter(isComponentMetadata).sort();
  pending.push("apps/web/src/components.tsx");
  const visited = new Set();
  while (pending.length) {
    const name = pending.shift();
    if (visited.has(name)) continue;
    visited.add(name);
    if (!available.has(name) && !fixedSources.includes(name))
      throw new Error(`Component source is not Git-discovered: ${name}`);
    if (!sources.has(name)) await readSource(name);
    if (!sources.has(name))
      throw new Error(`Missing component source: ${name}`);
    pending.push(...componentDependencies(name, sources.get(name), available));
  }
  return sources;
}

async function existingFiles(root, directory) {
  let entries;
  try {
    entries = await readdir(path.join(root, directory), {
      withFileTypes: true,
    });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const result = [];
  for (const entry of entries) {
    const name = `${directory}/${entry.name}`;
    if (entry.isSymbolicLink())
      throw new Error(`Symlink in generated documentation: ${name}`);
    if (entry.isDirectory()) result.push(...(await existingFiles(root, name)));
    else result.push(name);
  }
  return result.sort();
}

async function rejectOutputSymlinks(root, name) {
  // Checking directory entries alone misses a symlink at the traversal root
  // (including Windows junctions) or at an ancestor of a generated output.
  let current = path.resolve(root);
  for (const segment of ["", ...name.split("/")]) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = await lstat(current);
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    if (stat.isSymbolicLink())
      throw new Error(`Symlink in generated documentation output: ${name}`);
  }
}

export async function synchronizeOutputs(root, outputs, mode) {
  if (!["--write", "--check"].includes(mode))
    throw new Error("Use --write or --check.");
  // Validate every output before performing any reads, writes, or deletions.
  for (const name of outputs.keys()) {
    if (
      (!name.startsWith(`${generatedRoot}/`) &&
        name !== "docs/generated/components/web.md") ||
      name.includes("\\") ||
      name.split("/").includes("..")
    )
      throw new Error(`Invalid generated output path: ${name}`);
    await rejectOutputSymlinks(root, name);
  }
  await rejectOutputSymlinks(root, generatedRoot);
  const existing = await existingFiles(root, generatedRoot);
  const orphaned = existing.filter((name) => !outputs.has(name));
  if (mode === "--check" && orphaned.length)
    throw new Error(
      `Orphaned generated documentation: ${orphaned.join(", ")}; run pnpm docs:references:write`,
    );
  for (const [name, value] of outputs) {
    if (mode === "--write") {
      await mkdir(path.dirname(path.join(root, name)), { recursive: true });
      await writeFile(path.join(root, name), value);
    } else {
      let current;
      try {
        current = await readFile(path.join(root, name), "utf8");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      if (current !== value)
        throw new Error(
          `Missing or stale generated artifact ${name}; run pnpm docs:references:write`,
        );
    }
  }
  // The complete generated subtree is owned by this generator. Remove only
  // individual verified files in it, including pages for deleted source docs.
  for (const name of orphaned) {
    const absolute = path.resolve(root, name);
    const boundary = `${path.resolve(root, generatedRoot)}${path.sep}`;
    if (!absolute.startsWith(boundary))
      throw new Error(`Output escapes generated directory: ${name}`);
    await rm(absolute);
  }
}
