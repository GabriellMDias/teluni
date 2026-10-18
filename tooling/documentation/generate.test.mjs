import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { URL, fileURLToPath } from "node:url";
import test from "node:test";
import { buildDocumentation } from "./build.mjs";
import { readSources, synchronizeOutputs } from "./files.mjs";
import {
  documentationPaths,
  renderDocument,
  rewriteLink,
  sourceBaseFrom,
} from "./markdown.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const sources = await readSources(root);
const run = promisify(execFile);
const sourceBase = "https://example.test/acme/ledger/blob/main/";

async function temporaryDirectory(t) {
  const directory = await mkdtemp(
    path.join(tmpdir(), "orion-documentation-test-"),
  );
  t.after(async () => {
    assert.ok(
      path
        .resolve(directory)
        .startsWith(`${path.resolve(tmpdir())}${path.sep}`),
    );
    assert.ok(path.basename(directory).startsWith("orion-documentation-test-"));
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

test("discovery selects the scoped documentation and rejects unsafe paths", () => {
  assert.deepEqual(
    documentationPaths([
      "apps/web/README.md",
      "docs/architecture/x.md",
      "AGENTS.md",
      "README.md",
      ".env",
      "apps/web/random.md",
      "docs/api.json",
      "notes/private.md",
    ]),
    ["AGENTS.md", "README.md", "apps/web/README.md", "docs/architecture/x.md"],
  );
  assert.throws(
    () => documentationPaths(["node_modules/pkg/README.md"]),
    /Unsafe/,
  );
  assert.throws(() => documentationPaths(["docs/../../private.md"]), /Unsafe/);
});

test("new unignored docs are discovered before staging; removed sources disappear", async (t) => {
  const directory = await temporaryDirectory(t);
  await run("git", ["init", "--quiet"], { cwd: directory });
  for (const [name, text] of sources) {
    await mkdir(path.dirname(path.join(directory, name)), { recursive: true });
    await writeFile(path.join(directory, name), text);
  }
  await run("git", ["add", "."], { cwd: directory });
  await writeFile(path.join(directory, ".gitignore"), "docs/private.md\n");
  await writeFile(path.join(directory, "docs/private.md"), "# Private\n");
  await writeFile(path.join(directory, "docs/new-guide.md"), "# New guide\n");
  await rm(path.join(directory, "docs/README.md"));
  const discovered = await readSources(directory);
  assert.ok(discovered.has("docs/new-guide.md"));
  assert.ok(!discovered.has("docs/private.md"));
  assert.ok(!discovered.has("docs/README.md"));
});

test("Markdown links and duplicate heading anchors remain local and deterministic", () => {
  const available = new Set(["README.md", "docs/a.md", "docs/README.md"]);
  const rendered = renderDocument(
    "docs/a.md",
    "# Guide\n\n## Safe `code`\n\n[Home](../README.md) [Docs](.)\n\n## Safe `code`\n\n[Anchor](#safe-code-1)\n",
    available,
    sourceBase,
  );
  assert.deepEqual(
    rendered.headings.map((heading) => heading.id),
    ["guide", "safe-code", "safe-code-1"],
  );
  assert.match(rendered.html, /href="\/docs\/repository\/README"/);
  assert.match(rendered.html, /href="\/docs\/repository\/docs\/README"/);
  assert.match(rendered.html, /href="\/docs\/repository\/docs\/a#safe-code-1"/);
  assert.doesNotMatch(rendered.html, /<h1/);
  assert.equal(
    rewriteLink(
      "generated/api/openapi.json",
      "docs/README.md",
      available,
      sourceBase,
    ),
    "/docs/api#artifacts",
  );
  assert.throws(
    () => rewriteLink("absent.md", "docs/a.md", available, sourceBase),
    /absent from portal/,
  );
  assert.throws(
    () => rewriteLink("../../outside", "docs/a.md", available, sourceBase),
    /escapes repository/,
  );
});

test("source-only links open the repository recorded in the project manifest", async () => {
  const available = new Set(["docs/a.md"]);
  assert.equal(
    rewriteLink(
      "../apps/api/src/app.ts#L1",
      "docs/a.md",
      available,
      sourceBase,
    ),
    "https://example.test/acme/ledger/blob/main/apps/api/src/app.ts#L1",
  );
  // The checkout is Orion or a derived project; links follow its manifest.
  const { repository } = JSON.parse(sources.get(".orion/project.json"));
  const ownBase = `${repository.url}/blob/${repository.defaultBranch}/`;
  assert.equal(sourceBaseFrom(sources.get(".orion/project.json")), ownBase);
  // An explicit non-default port is part of the recorded repository identity.
  assert.equal(
    sourceBaseFrom(
      JSON.stringify({
        repository: {
          url: "https://git.example.test:8443/acme/ledger",
          defaultBranch: "main",
        },
      }),
    ),
    "https://git.example.test:8443/acme/ledger/blob/main/",
  );
  for (const manifest of [
    "{",
    JSON.stringify({
      repository: { url: "http://example.test/a/b", defaultBranch: "main" },
    }),
    JSON.stringify({
      repository: { url: "https://example.test/a/b", defaultBranch: "../x" },
    }),
  ])
    assert.throws(() => sourceBaseFrom(manifest), /Invalid/);
  // Parse every generated source link and compare its repository identity
  // exactly, rather than searching output text for URL fragments. Absolute
  // links written in the Markdown, such as links pinned to a release tag,
  // are authored content rather than generated source links.
  const authored = new Set(
    [...sources.values()].flatMap((text) =>
      [...text.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map(([, url]) => url),
    ),
  );
  const sourceLinks = (outputs) => {
    const links = [];
    for (const [name, value] of outputs) {
      if (!name.startsWith("apps/web/src/generated/pages/repository/"))
        continue;
      for (const [, href] of JSON.parse(value).html.matchAll(
        / href="([^"]+)"/g,
      )) {
        if (!/^https?:\/\//.test(href)) continue;
        if (authored.has(href.replaceAll("&amp;", "&"))) continue;
        const url = new URL(href.replaceAll("&amp;", "&"));
        const [owner, repo, kind, branch] = url.pathname.split("/").slice(1);
        if (kind === "blob")
          links.push({ repository: `${url.origin}/${owner}/${repo}`, branch });
      }
    }
    return links;
  };
  const current = sourceLinks(await buildDocumentation(sources));
  assert.ok(current.length > 0);
  for (const link of current)
    assert.deepEqual(link, {
      repository: repository.url,
      branch: repository.defaultBranch,
    });

  const derivedRepository = "https://example.test/orion-derived-fixture/ledger";
  assert.notEqual(derivedRepository, repository.url);
  const derived = new Map(sources);
  derived.set(
    ".orion/project.json",
    JSON.stringify({
      name: "Acme Ledger",
      repository: { url: derivedRepository, defaultBranch: "main" },
    }),
  );
  const derivedOutputs = await buildDocumentation(derived);
  // The portal is titled after the repository it documents.
  assert.equal(
    JSON.parse(derivedOutputs.get("apps/web/src/generated/manifest.json"))
      .title,
    "Acme Ledger Living Documentation",
  );
  const retargeted = sourceLinks(derivedOutputs);
  // The same source links now open the derived repository, and none keeps
  // the repository of the checkout that generated the committed portal.
  assert.equal(retargeted.length, current.length);
  for (const link of retargeted)
    assert.deepEqual(link, { repository: derivedRepository, branch: "main" });
});

test("catalog summaries omit navigation and Markdown link syntax", () => {
  const available = new Set(["docs/a.md", "docs/b.md"]);
  const rendered = renderDocument(
    "docs/a.md",
    "# Title\n\n[Home](b.md) · [Related](b.md)\n\n**Status:** accepted\n\nRead the [canonical policy](b.md) for the requirements and rationale governing this implementation.\n",
    available,
    sourceBase,
  );
  assert.equal(
    rendered.summary,
    "Read the canonical policy for the requirements and rationale governing this implementation.",
  );
});

test("Markdown cannot execute raw HTML, unsafe URLs, or automatic image requests", () => {
  const available = new Set(["docs/a.md"]);
  const rendered = renderDocument(
    "docs/a.md",
    "# Title\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n![Diagram](https://example.test/tracker.png)\n",
    available,
    sourceBase,
  );
  assert.doesNotMatch(rendered.html, /<script|<img/);
  assert.match(rendered.html, /&lt;script&gt;/);
  assert.match(rendered.html, /<a href="https:\/\/example.test\/tracker.png"/);
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,test",
    "file:///secret",
    "//example.test/path",
  ])
    assert.throws(
      () =>
        renderDocument(
          "docs/a.md",
          `# Title\n\n[Unsafe](${url})\n`,
          available,
          sourceBase,
        ),
      /Unsafe documentation URL/,
    );
});

test("generation is deterministic and preserves full contracts with bounded per-page output", async () => {
  const first = await buildDocumentation(sources);
  const second = await buildDocumentation(new Map([...sources].reverse()));
  assert.deepEqual([...first], [...second]);
  const manifest = JSON.parse(
    first.get("apps/web/src/generated/manifest.json"),
  );
  assert.equal(
    new Set(manifest.entries.map((entry) => entry.id)).size,
    manifest.entries.length,
  );
  assert.equal(
    manifest.entries.filter((entry) => entry.kind === "repository").length,
    [...sources.keys()].filter((name) => name.endsWith(".md")).length,
  );
  assert.ok(!first.has("apps/web/src/generated/documentation.json"));
  const openapi = JSON.parse(sources.get("docs/generated/api/openapi.json"));
  const operations = Object.values(openapi.paths).flatMap((methods) =>
    Object.values(methods),
  );
  assert.ok(operations.length > 0);
  for (const operation of operations) {
    const page = JSON.parse(
      first.get(
        `apps/web/src/generated/pages/api/${operation.operationId}.json`,
      ),
    );
    assert.ok(
      page.responses.every(
        (response) => "description" in response && "content" in response,
      ),
    );
    if (operation.requestBody) assert.equal(page.request.schema.type, "object");
    for (const requirement of operation.security ?? [])
      for (const name of Object.keys(requirement))
        assert.ok(
          ["http", "apiKey"].includes(
            page.components.securitySchemes[name].type,
          ),
        );
  }
  assert.ok(manifest.search.shards.every((shard) => shard.kinds.length));
});

test("missing or duplicate operation IDs and unowned components fail generation", async () => {
  for (const invalid of ["missing", "duplicate"]) {
    const changed = new Map(sources);
    const openapi = JSON.parse(changed.get("docs/generated/api/openapi.json"));
    const operations = Object.values(openapi.paths).flatMap((methods) =>
      Object.values(methods),
    );
    if (invalid === "missing") delete operations[0].operationId;
    else operations[1].operationId = operations[0].operationId;
    changed.set("docs/generated/api/openapi.json", JSON.stringify(openapi));
    await assert.rejects(buildDocumentation(changed), /operationId/);
  }
  const changed = new Map(sources);
  changed.set(
    "apps/web/src/components.tsx",
    `${changed.get("apps/web/src/components.tsx")}\nexport function Unowned() {}`,
  );
  await assert.rejects(
    buildDocumentation(changed),
    /every exported web component/,
  );
});

test("new documentation is covered by sensitive-content checks", async () => {
  const changed = new Map(sources);
  changed.set(
    "docs/unsafe-example.md",
    "# Unsafe example\n\npostgresql://example-user:example-password@invalid.test/example\n",
  );
  await assert.rejects(
    buildDocumentation(changed),
    /sensitive content detected/,
  );
});

test("checks detect missing, stale, and orphaned output; generation removes deleted pages", async (t) => {
  const directory = await temporaryDirectory(t);
  const file = "apps/web/src/generated/pages/current.json";
  const outputs = new Map([[file, '{"current":true}\n']]);
  await assert.rejects(
    synchronizeOutputs(directory, outputs, "--check"),
    /Missing or stale/,
  );
  await synchronizeOutputs(directory, outputs, "--write");
  await synchronizeOutputs(directory, outputs, "--check");
  await writeFile(path.join(directory, file), "stale");
  await assert.rejects(
    synchronizeOutputs(directory, outputs, "--check"),
    /Missing or stale/,
  );
  await synchronizeOutputs(directory, outputs, "--write");
  await writeFile(
    path.join(directory, "apps/web/src/generated/orphan.json"),
    "{}",
  );
  await assert.rejects(
    synchronizeOutputs(directory, outputs, "--check"),
    /Orphaned/,
  );
  await synchronizeOutputs(directory, outputs, "--write");
  await assert.rejects(
    readFile(path.join(directory, "apps/web/src/generated/orphan.json")),
    { code: "ENOENT" },
  );
});

test("output roots, ancestors, and component destinations reject symlinks before mutation", async (t) => {
  const directory = await temporaryDirectory(t);
  for (const [index, link] of [
    "apps",
    "apps/web/src/generated",
    "docs/generated/components",
    "docs/generated/components/web.md",
  ].entries()) {
    const checkout = path.join(directory, String(index), "checkout");
    const outside = path.join(directory, String(index), "outside");
    const linkPath = path.join(checkout, link);
    await mkdir(path.dirname(linkPath), { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(path.join(outside, "sentinel.json"), "preserve");
    // Junctions require no Windows symlink privilege and exercise the same
    // lstat boundary as ordinary directory symlinks on the other CI hosts.
    await symlink(outside, linkPath, "junction");
    const linkedOutput = link.startsWith("apps")
      ? "apps/web/src/generated/new.json"
      : "docs/generated/components/web.md";
    const safeOutput = link.startsWith("apps")
      ? "docs/generated/components/web.md"
      : "apps/web/src/generated/new.json";
    const outputs = new Map([
      [safeOutput, "must not be written"],
      [linkedOutput, "must not escape"],
    ]);
    for (const mode of ["--check", "--write"])
      await assert.rejects(
        synchronizeOutputs(checkout, outputs, mode),
        /Symlink in generated documentation output/,
      );
    assert.equal(
      await readFile(path.join(outside, "sentinel.json"), "utf8"),
      "preserve",
    );
    await assert.rejects(readFile(path.join(checkout, safeOutput)), {
      code: "ENOENT",
    });
    await assert.rejects(readFile(path.join(outside, "new.json")), {
      code: "ENOENT",
    });
  }
});

test("long searchable sections preserve boundary terms in bounded overlapping records", async () => {
  const enlarged = new Map(sources);
  const needle = "uniqueneedleboundary";
  enlarged.set(
    "docs/search-boundary.md",
    `# Search probe\n\n${"x".repeat(11980)} ${needle} ${"y".repeat(13000)}\n`,
  );
  const outputs = await buildDocumentation(enlarged);
  const records = [...outputs]
    .filter(([name]) => name.startsWith("apps/web/src/generated/search/"))
    .flatMap(([, body]) => JSON.parse(body))
    .filter((record) => record.id === "repository/docs/search-boundary");
  assert.ok(records.length > 1);
  assert.ok(records.some((record) => record.text.includes(needle)));
  for (let index = 1; index < records.length; index++)
    assert.equal(
      records[index].text.slice(0, 200),
      records[index - 1].text.slice(-200),
    );
  assert.ok(records.every((record) => record.text.length <= 12000));
  assert.equal(new Set(records.map((record) => record.anchor)).size, 1);
});

test("large documentation sets produce separate pages and bounded searchable shards", async () => {
  const enlarged = new Map(sources);
  for (let index = 0; index < 1000; index += 1)
    enlarged.set(
      `docs/future/guide-${index}.md`,
      `# Future guide ${index}\n\n## Design\n\n${"Searchable architectural meaning. ".repeat(100)}\n\n## Usage\n\nUnique example ${index}.\n`,
    );
  const outputs = await buildDocumentation(enlarged);
  const manifest = JSON.parse(
    outputs.get("apps/web/src/generated/manifest.json"),
  );
  // Relative to this checkout, which may be Orion or a smaller derived project.
  const baseline = JSON.parse(
    (await buildDocumentation(sources)).get(
      "apps/web/src/generated/manifest.json",
    ),
  );
  assert.equal(manifest.entries.length, baseline.entries.length + 1000);
  assert.ok(manifest.search.shards.length > 20);
  for (const shard of manifest.search.shards) {
    const records = JSON.parse(
      outputs.get(`apps/web/src/generated/${shard.file}`),
    );
    assert.ok(JSON.stringify(records).length <= 140 * 1024);
  }
  const entry = manifest.entries.find(
    (page) => page.id === "repository/docs/future/guide-599",
  );
  assert.ok(entry);
  assert.match(
    outputs.get(`apps/web/src/generated/${entry.file}`),
    /Unique example 599/,
  );
  assert.ok(!("html" in entry));
  assert.deepEqual(entry.headings, []);
});
