import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import MarkdownIt from "markdown-it";
import GithubSlugger from "github-slugger";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const markdown = new MarkdownIt({ html: false, linkify: false });
const ignoredDirectories = new Set([
  ".git",
  "node_modules",
  "coverage",
  "dist",
  "playwright-report",
  "test-results",
]);
const adrName = /^(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const errors: string[] = [];

async function markdownFiles(directory: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    // Installed tool skills are external references, not project documentation.
    const isToolSkills =
      entry.name === "skills" &&
      [".agents", ".claude", ".windsurf"].includes(path.basename(directory));
    if (
      entry.isDirectory() &&
      !ignoredDirectories.has(entry.name) &&
      !isToolSkills
    ) {
      found.push(...(await markdownFiles(absolute)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      found.push(absolute);
    }
  }
  return found;
}

function repositoryPath(absolute: string): string {
  return path.relative(root, absolute).replaceAll(path.sep, "/");
}

function isInsideRepository(absolute: string): boolean {
  const relative = path.relative(root, absolute);
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function headingText(
  children: readonly { type: string; content: string }[],
): string {
  return children
    .filter(
      (child) =>
        child.type === "text" ||
        child.type === "code_inline" ||
        child.type === "image",
    )
    .map((child) => child.content)
    .join("");
}

type Document = {
  anchors: Set<string>;
  links: string[];
  source: string;
  titleCount: number;
};
const documents = new Map<string, Document>();

for (const file of (await markdownFiles(root)).sort()) {
  const name = repositoryPath(file);
  const source = await readFile(file, "utf8");
  const tokens = markdown.parse(source, {});
  const slugger = new GithubSlugger();
  const anchors = new Set<string>();
  const links: string[] = [];
  let titleCount = 0;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type === "heading_open") {
      if (token.tag === "h1") titleCount += 1;
      const inline = tokens[index + 1];
      if (inline?.type === "inline")
        anchors.add(slugger.slug(headingText(inline.children ?? [])));
    }
    if (token.type !== "inline") continue;
    for (const child of token.children ?? []) {
      if (child.type === "link_open") {
        const href = child.attrGet("href");
        if (typeof href === "string" && href) links.push(href);
      } else if (child.type === "image") {
        const src = child.attrGet("src");
        if (typeof src === "string" && src) links.push(src);
      }
    }
  }

  if (titleCount !== 1)
    errors.push(`${name}: expected one level-one heading, found ${titleCount}`);
  documents.set(name, { anchors, links, source, titleCount });
}

const graph = new Map<string, Set<string>>();
let localLinks = 0;
for (const [name, document] of documents) {
  const targets = new Set<string>();
  graph.set(name, targets);
  for (const href of document.links) {
    if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith("//")) continue;
    localLinks += 1;
    const [beforeFragment, fragment = ""] = href.split("#", 2);
    const relativeTarget = beforeFragment.split("?", 1)[0];
    let target: string;
    let decodedFragment: string;
    try {
      target = path.resolve(
        path.dirname(path.join(root, name)),
        decodeURIComponent(relativeTarget || "."),
      );
      decodedFragment = decodeURIComponent(fragment);
    } catch {
      errors.push(`${name}: invalid local link encoding: ${href}`);
      continue;
    }
    if (!relativeTarget) target = path.join(root, name);
    if (!isInsideRepository(target)) {
      errors.push(`${name}: local link leaves repository: ${href}`);
      continue;
    }
    let targetFile: string;
    try {
      const info = await stat(target);
      targetFile = info.isDirectory() ? path.join(target, "README.md") : target;
      if (info.isDirectory()) await stat(targetFile);
    } catch {
      errors.push(`${name}: missing local target: ${href}`);
      continue;
    }
    const targetName = repositoryPath(targetFile);
    if (documents.has(targetName)) {
      targets.add(targetName);
      if (
        decodedFragment &&
        !documents.get(targetName)?.anchors.has(decodedFragment)
      ) {
        errors.push(
          `${name}: missing heading #${decodedFragment} in ${targetName}`,
        );
      }
    } else if (targetName.endsWith(".md")) {
      errors.push(`${name}: Markdown target was not indexed: ${href}`);
    }
  }
}

const adrDirectory = "docs/adr/";
const adrIds = new Set<string>();
let adrCount = 0;
for (const [name, document] of documents) {
  if (!name.startsWith(adrDirectory)) continue;
  const match = adrName.exec(path.basename(name));
  if (!match) continue;
  adrCount += 1;
  const id = match[1];
  const directory = path.posix.dirname(name);
  if (directory !== "docs/adr" && directory !== "docs/adr/orion")
    errors.push(`${name}: unsupported ADR namespace ${directory}`);
  const identity = `${directory}/${id}`;
  const adrIndex = documents.get(`${directory}/README.md`);
  if (adrIds.has(identity))
    errors.push(`${name}: duplicate ADR identifier ${id}`);
  adrIds.add(identity);
  if (!new RegExp(`^# ADR-${id}: .+`, "m").test(document.source))
    errors.push(`${name}: title does not match ADR identifier`);
  if (
    !/^\*\*Status:\*\* (proposed|accepted|rejected|superseded|deprecated)\s*$/m.test(
      document.source,
    )
  ) {
    errors.push(`${name}: missing or invalid ADR status`);
  }
  if (!/^\*\*Date:\*\* \d{4}-\d{2}-\d{2}\s*$/m.test(document.source))
    errors.push(`${name}: missing ISO ADR date`);
  for (const section of ["Context", "Decision", "Rationale", "Consequences"]) {
    if (!document.source.includes(`## ${section}`))
      errors.push(`${name}: missing ${section} section`);
  }
  if (
    !adrIndex?.links.some(
      (link) => link.split("#", 1)[0] === path.basename(name),
    )
  ) {
    errors.push(`${name}: absent from ${directory}/README.md`);
  }
}

const visited = new Set<string>();
const queue = ["README.md"];
while (queue.length > 0) {
  const current = queue.pop();
  if (!current || visited.has(current)) continue;
  visited.add(current);
  queue.push(...(graph.get(current) ?? []));
}
for (const name of documents.keys()) {
  if (!visited.has(name) && !name.endsWith("AGENTS.md"))
    errors.push(`${name}: not reachable from README.md`);
}

if (errors.length > 0) {
  for (const error of errors)
    console.error(`Documentation validation: ${error}`);
  process.exitCode = 1;
} else {
  console.log(
    `Documentation validation passed: ${documents.size} Markdown files, ${localLinks} local links, ${adrCount} ADR records.`,
  );
}
