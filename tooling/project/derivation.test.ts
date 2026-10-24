import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, posix, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import GithubSlugger from "github-slugger";
import MarkdownIt from "markdown-it";
import {
  DerivationError,
  checkProvenance,
  configureUpstream,
  defaultPackageScope,
  fetchOnlyPushUrl,
  initializeProject,
  parseDerivationContract,
  projectHumanActionsPath,
  projectPlanPath,
  projectStatus,
  pruneProject,
  readDerivationContract,
  recordBaseline,
  renderProjectFiles,
  type ProjectStatus,
} from "./derivation.ts";
import {
  type ProjectManifest,
  mayBeSameRepository,
  normalizeRepositoryUrl,
  parseManifest,
  readManifest,
  sameRepository,
} from "./manifest.ts";

const repositoryRoot = process.cwd();
const sandbox = mkdtempSync(join(tmpdir(), "orion-derivation-"));
const remotes = join(sandbox, "remotes");
const remoteBase = `${pathToFileURL(remotes).href}/`;
const canonicalUrl = "https://example.test/orion/core";
const projectUrl = "git@example.test:acme/ledger.git";

// Isolate Git from user/system configuration and resolve the synthetic
// https/ssh repository identities to local bare repositories.
const gitConfig: [string, string][] = [
  [`url.${remoteBase}.insteadOf`, "https://example.test/"],
  [`url.${remoteBase}.insteadOf`, "git@example.test:"],
  ["init.defaultBranch", "main"],
  ["commit.gpgSign", "false"],
  ["core.autocrlf", "false"],
  ["protocol.file.allow", "always"],
  ["advice.detachedHead", "false"],
];
const emptyGlobalConfig = join(sandbox, "gitconfig");
writeFileSync(emptyGlobalConfig, "");
Object.assign(process.env, {
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: emptyGlobalConfig,
  GIT_CONFIG_COUNT: String(gitConfig.length),
  GIT_AUTHOR_NAME: "Orion Test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "Orion Test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
});
gitConfig.forEach(([key, value], index) => {
  process.env[`GIT_CONFIG_KEY_${index}`] = key;
  process.env[`GIT_CONFIG_VALUE_${index}`] = value;
});
test.after(() => {
  if (!sandbox.startsWith(`${resolve(tmpdir())}${sep}`))
    throw new Error("Test directory escaped the temporary root");
  rmSync(sandbox, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function write(root: string, path: string, content: string) {
  mkdirSync(dirname(resolve(root, path)), { recursive: true });
  writeFileSync(resolve(root, path), content);
}

// A miniature foundation exercising every part of the derivation contract.
const fixtureContract = {
  schemaVersion: 1,
  foundationOnly: [
    "apps/api/src/features/sample-reference",
    "docs/implementation-plan.md",
  ],
  foundationOnlyTerms: ["sample reference"],
  isolationExempt: [".orion", "tooling/project"],
  projectFiles: {
    "README.md": "tooling/project/templates/README.md.tmpl",
    "apps/api/src/modules.ts": "tooling/project/templates/modules.ts.tmpl",
    "apps/web/src/assets/mark.bin": "tooling/project/templates/mark.bin",
    "docs/project/implementation-plan.md":
      "tooling/project/templates/plan.md.tmpl",
    "docs/project/human-actions.md":
      "tooling/project/templates/actions.md.tmpl",
  },
  workspaceScope: "@orion",
};
const fixtureFiles: Record<string, string> = {
  "README.md": "# Orion\n\nFoundation introduction.\n",
  "package.json": '{\n  "name": "orion",\n  "private": true\n}\n',
  "apps/web/package.json":
    '{\n  "name": "@orion/web",\n  "dependencies": { "@orion/sdk": "workspace:*" }\n}\n',
  "pnpm-lock.yaml":
    "importers:\n  apps/web:\n    dependencies:\n      '@orion/sdk':\n        version: link:../../packages/sdk\n",
  "apps/web/src/api-client.ts":
    'import { createApiClient } from "@orion/sdk";\nexport const client = createApiClient;\n',
  "apps/api/src/modules.ts":
    'import { referenceModule } from "./features/sample-reference/module.js";\nexport const apiModules = [referenceModule];\n',
  "apps/api/src/features/sample-reference/module.ts":
    "// Sample reference module.\nexport const referenceModule = {};\n",
  "docs/implementation-plan.md": "# Orion Implementation Plan\n",
  "docs/policy.md": "# Policy\n\nVersion 1. The SDK package is `@orion/sdk`.\n",
  "tooling/project/templates/README.md.tmpl":
    "# {{NAME}}\n\nInitialized from {{FOUNDATION_NAME}} commit `{{BASELINE}}` on {{DATE}}.\n",
  "tooling/project/templates/modules.ts.tmpl":
    "export const apiModules = [];\n",
  "tooling/project/templates/mark.bin": "\u0000binary {{NAME}}\u0000",
  "tooling/project/templates/plan.md.tmpl": "# {{NAME}} Implementation Plan\n",
  "tooling/project/templates/actions.md.tmpl":
    "# {{NAME}} Human Actions\n\n{{PROJECT_URL}} uses {{PACKAGE_SCOPE}}.\n",
};

let fixtureCount = 0;
function fixture(options: { releases?: unknown[] } = {}) {
  const base = join(sandbox, `case-${(fixtureCount += 1)}`);
  const canonicalBare = join(remotes, `orion${fixtureCount}`, "core");
  const productBare = join(remotes, `acme${fixtureCount}`, "ledger.git");
  const canonical = canonicalUrl.replace("/orion/", `/orion${fixtureCount}/`);
  const product = projectUrl.replace(":acme/", `:acme${fixtureCount}/`);
  const fork = `https://example.test/fork${fixtureCount}/ledger`;
  const forkBare = join(remotes, `fork${fixtureCount}`, "ledger");
  for (const bare of [canonicalBare, productBare]) {
    mkdirSync(bare, { recursive: true });
    git(bare, "init", "--quiet", "--bare");
  }
  const seed = join(base, "seed");
  mkdirSync(seed, { recursive: true });
  git(seed, "init", "--quiet");
  write(
    seed,
    ".orion/project.json",
    `${JSON.stringify(
      {
        schemaVersion: 2,
        kind: "foundation",
        name: "Orion",
        repository: { url: canonical, defaultBranch: "main" },
      },
      null,
      2,
    )}\n`,
  );
  write(
    seed,
    ".orion/derivation.json",
    `${JSON.stringify(fixtureContract, null, 2)}\n`,
  );
  for (const [path, content] of Object.entries(fixtureFiles))
    write(seed, path, content);
  write(
    seed,
    "apps/api/prisma/release-history.json",
    JSON.stringify({
      schemaVersion: 1,
      recordedDurableReleases: options.releases ?? [],
    }),
  );
  git(seed, "add", "--all");
  git(seed, "commit", "--quiet", "--message", "Foundation");
  git(seed, "remote", "add", "origin", canonical);
  git(seed, "push", "--quiet", "origin", "main");
  const work = join(base, "work");
  git(base, "clone", "--quiet", canonical, work);
  const materialized: string[] = [];
  const materialize = (root: string) => {
    materialized.push(root);
    write(root, "apps/web/src/generated/manifest.json", "{}\n");
  };
  return {
    base,
    seed,
    work,
    canonical,
    product,
    canonicalBare,
    productBare,
    fork,
    forkBare,
    materialized,
    init(overrides: Partial<Parameters<typeof initializeProject>[1]> = {}) {
      return initializeProject(work, {
        name: "Acme Ledger",
        repository: product,
        apply: true,
        date: "2026-09-29",
        materialize,
        ...overrides,
      });
    },
    advanceFoundation(message: string) {
      write(seed, "docs/policy.md", `# Policy\n\n${message}.\n`);
      git(seed, "commit", "--quiet", "--all", "--message", message);
      git(seed, "push", "--quiet", "origin", "main");
      return git(seed, "rev-parse", "HEAD");
    },
  };
}

function refusal(action: () => unknown, pattern: RegExp) {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof DerivationError, String(error));
    assert.match(error.message, pattern);
    return true;
  });
}

void test("repository URLs normalize to a credential-free identity", () => {
  for (const url of [
    "git@github.com:Acme/Ledger.git",
    "ssh://git@github.com/Acme/Ledger.git",
    "https://github.com/Acme/Ledger.git",
    "https://github.com/Acme/Ledger/",
  ])
    assert.equal(normalizeRepositoryUrl(url), "https://github.com/Acme/Ledger");
  assert.ok(
    sameRepository(
      "git@GitHub.com:GabriellMDias/Orion.git",
      "https://github.com/GabriellMDias/Orion",
    ),
  );
  assert.throws(
    () => normalizeRepositoryUrl("https://user:token@github.com/acme/ledger"),
    /credentials/,
  );
  for (const url of [
    "file:///tmp/orion",
    "../orion",
    "https://github.com/acme",
  ])
    assert.throws(() => normalizeRepositoryUrl(url));
});

void test("explicit ports are preserved or refused, never discarded", () => {
  const custom = "https://git.example.com:8443/acme/ledger";
  assert.equal(normalizeRepositoryUrl(`${custom}.git`), custom);
  assert.equal(normalizeRepositoryUrl(`${custom}/`), custom);
  // The default HTTPS port is the same endpoint as no port.
  assert.equal(
    normalizeRepositoryUrl("https://git.example.com:443/acme/ledger.git"),
    "https://git.example.com/acme/ledger",
  );
  assert.ok(
    sameRepository(
      "https://GIT.example.com:443/acme/ledger",
      "https://git.example.com/acme/ledger",
    ),
  );
  for (const [left, right] of [
    [custom, "https://git.example.com/acme/ledger"],
    [custom, "https://git.example.com:9443/acme/ledger"],
    [custom, "git@git.example.com:acme/ledger.git"],
  ])
    assert.equal(sameRepository(left, right), false, `${left} vs ${right}`);

  // The default SSH port maps to the HTTPS identity like the scp-like form.
  assert.equal(
    normalizeRepositoryUrl("ssh://git@git.example.com:22/acme/ledger.git"),
    "https://git.example.com/acme/ledger",
  );
  assert.throws(
    () =>
      normalizeRepositoryUrl("ssh://git@git.example.com:2222/acme/ledger.git"),
    /SSH port 2222 does not identify the repository's HTTPS endpoint/,
  );
  // scp-like syntax has no port; a leading number is a path segment.
  assert.equal(
    normalizeRepositoryUrl("git@git.example.com:8443/acme/ledger.git"),
    "https://git.example.com/8443/acme/ledger",
  );
  assert.throws(
    () =>
      normalizeRepositoryUrl(
        "https://user:secret@git.example.com:8443/acme/ledger",
      ),
    /credentials/,
  );
  assert.throws(() =>
    normalizeRepositoryUrl("https://git.example.com:0/acme/ledger"),
  );

  const manifest = {
    schemaVersion: 2,
    kind: "foundation",
    name: "Orion",
    repository: { url: custom, defaultBranch: "main" },
  };
  assert.equal(parseManifest(JSON.stringify(manifest)).repository.url, custom);
  assert.throws(
    () =>
      parseManifest(
        JSON.stringify({
          ...manifest,
          repository: {
            url: "https://git.example.com:443/acme/ledger",
            defaultBranch: "main",
          },
        }),
      ),
    /normalized https repository URL/,
  );
});

void test("host case is normalized while repository path case is preserved", () => {
  assert.equal(
    normalizeRepositoryUrl("https://GIT.Example.COM/Acme/Ledger.git"),
    "https://git.example.com/Acme/Ledger",
  );
  for (const url of [
    "git@GIT.example:acme/Ledger.git",
    "ssh://git@Git.Example:22/acme/Ledger.git",
    "https://git.EXAMPLE:443/acme/Ledger/",
  ])
    assert.ok(sameRepository(url, "https://git.example/acme/Ledger"), url);
  // Case-sensitive servers may host both; exact identity keeps them apart.
  assert.equal(
    sameRepository(
      "https://git.example/acme/Ledger",
      "https://git.example/acme/ledger",
    ),
    false,
  );
  // Refusals stay conservative for hosts that ignore path case.
  assert.ok(
    mayBeSameRepository(
      "https://git.example/acme/Ledger",
      "https://git.example/acme/ledger",
    ),
  );
  for (const [left, right] of [
    ["https://git.example:8443/acme/ledger", "https://git.example/acme/ledger"],
    ["https://git.example/acme/ledger", "https://git.example/acme/ledgers"],
  ]) {
    assert.equal(sameRepository(left, right), false);
    assert.equal(mayBeSameRepository(left, right), false);
  }
  assert.throws(
    () => normalizeRepositoryUrl("https://user:secret@GIT.example/acme/Ledger"),
    /credentials/,
  );
  assert.throws(
    () => normalizeRepositoryUrl("ssh://git@GIT.example:2222/acme/Ledger.git"),
    /SSH port 2222/,
  );

  const project = {
    schemaVersion: 2,
    kind: "project",
    name: "Acme Ledger",
    packageScope: "@acme",
    repository: {
      url: "https://git.example/acme/Ledger",
      defaultBranch: "main",
    },
    foundation: {
      name: "Orion",
      repository: {
        url: "https://git.example/acme/ledger",
        defaultBranch: "main",
      },
      remote: "orion-upstream",
      initializedFromCommit: "a".repeat(40),
      baselineCommit: "a".repeat(40),
    },
  };
  assert.throws(
    () => parseManifest(JSON.stringify(project)),
    /must not claim the foundation/,
  );
  project.repository.url = "https://git.example/acme/Ledger-app";
  assert.equal(
    parseManifest(JSON.stringify(project)).repository.url,
    project.repository.url,
  );
});

// This checkout is Orion itself or a project derived from it; both must pass.
void test("this repository's manifest and provenance are valid", () => {
  const manifest = readManifest(repositoryRoot);
  assert.ok(["foundation", "project"].includes(manifest.kind));
  assert.deepEqual(checkProvenance(repositoryRoot).errors, []);
});

void test("project templates render complete documents whose local links resolve without foundation-only content", () => {
  const contract = readDerivationContract(repositoryRoot);
  const manifest = parseManifest(
    JSON.stringify({
      schemaVersion: 2,
      kind: "project",
      name: "Acme Ledger",
      packageScope: "@acme-ledger",
      repository: {
        url: "https://github.com/acme/ledger",
        defaultBranch: "main",
      },
      foundation: {
        name: "Orion",
        repository: readManifest(repositoryRoot).repository,
        remote: "orion-upstream",
        initializedFromCommit: "a".repeat(40),
        baselineCommit: "a".repeat(40),
      },
    }),
  ) as ProjectManifest;
  const rendered = renderProjectFiles(
    repositoryRoot,
    contract,
    manifest,
    "2026-09-29",
  );
  for (const path of [projectPlanPath, projectHumanActionsPath, "README.md"])
    assert.ok(rendered.has(path), `${path} is project-owned`);
  for (const path of [
    "apps/web/src/documentation.tsx",
    "apps/web/src/generated/manifest.json",
    "apps/web/scripts/documentation-build.ts",
    "tooling/documentation/generate.mjs",
    "docs/architecture/living-documentation.md",
    "docs/generated/api/openapi.json",
  ])
    assert.ok(
      !contract.foundationOnly.some(
        (entry) => path === entry || path.startsWith(`${entry}/`),
      ),
      `${path} remains available to developers and agents`,
    );
  const documents = new Map<string, string>(
    [...rendered].flatMap(([path, content]) =>
      path.endsWith(".md") && typeof content === "string"
        ? [[path, content]]
        : [],
    ),
  );
  const removed = (path: string) =>
    contract.foundationOnly.some(
      (entry) => path === entry || path.startsWith(`${entry}/`),
    );
  const markdown = new MarkdownIt();
  const source = (name: string) =>
    documents.get(name) ?? readFileSync(resolve(repositoryRoot, name), "utf8");
  const anchors = (name: string) => {
    const slugger = new GithubSlugger();
    const tokens = markdown.parse(source(name), {});
    return new Set(
      tokens.flatMap((token, index) =>
        token.type === "heading_open"
          ? [slugger.slug(tokens[index + 1]?.content ?? "")]
          : [],
      ),
    );
  };
  for (const [name, text] of documents) {
    assert.doesNotMatch(
      text,
      /\{\{|\}\}/,
      `${name} has unresolved placeholders`,
    );
    for (const term of contract.foundationOnlyTerms)
      assert.ok(!text.toLowerCase().includes(term), `${name} mentions ${term}`);
    const links = markdown
      .parse(text, {})
      .flatMap((token) => token.children ?? [])
      .filter((token) => token.type === "link_open")
      .map((token) => String(token.attrGet("href") ?? ""))
      .filter((href) => !/^https?:/.test(href));
    assert.ok(links.length > 0);
    for (const href of links) {
      const [path, fragment] = href.split("#", 2);
      const target = path
        ? posix.normalize(posix.join(posix.dirname(name), path))
        : name;
      assert.ok(
        documents.has(target) ||
          (existsSync(resolve(repositoryRoot, target)) && !removed(target)),
        `${name}: missing ${href}`,
      );
      if (fragment)
        assert.ok(anchors(target).has(fragment), `${name}: missing ${href}`);
    }
  }
});

void test("a dry run verifies preconditions and changes nothing", () => {
  const repo = fixture();
  const before = git(repo.work, "rev-parse", "HEAD");
  const result = repo.init({ apply: false });
  assert.equal(result.applied, false);
  assert.deepEqual(result.removed, fixtureContract.foundationOnly);
  assert.equal(result.manifest.packageScope, "@acme-ledger");
  assert.equal(result.manifest.foundation.initializedFromCommit, before);
  assert.equal(git(repo.work, "status", "--porcelain"), "");
  assert.equal(git(repo.work, "remote"), "origin");
  assert.equal(repo.materialized.length, 0);
});

void test("initialization preserves ancestry, records provenance, and protects the foundation", () => {
  const repo = fixture();
  const orionHead = git(repo.work, "rev-parse", "HEAD");
  const result = repo.init();
  assert.equal(result.applied, true);

  const manifest = readManifest(repo.work);
  assert.equal(manifest.kind, "project");
  if (manifest.kind !== "project") return;
  assert.equal(manifest.name, "Acme Ledger");
  assert.equal(manifest.repository.url, normalizeRepositoryUrl(repo.product));
  assert.equal(manifest.foundation.repository.url, repo.canonical);
  assert.equal(manifest.foundation.initializedFromCommit, orionHead);
  assert.equal(manifest.foundation.baselineCommit, orionHead);
  assert.equal(manifest.packageScope, "@acme-ledger");

  assert.equal(git(repo.work, "rev-parse", "HEAD^"), orionHead);
  assert.equal(
    git(repo.work, "log", "-1", "--format=%s"),
    `Initialize Acme Ledger from Orion ${orionHead.slice(0, 12)}`,
  );
  assert.equal(git(repo.work, "status", "--porcelain"), "");
  assert.deepEqual(repo.materialized, [repo.work]);
  assert.ok(
    git(repo.work, "ls-files")
      .split("\n")
      .includes("apps/web/src/generated/manifest.json"),
  );
  const read = (path: string) => readFileSync(join(repo.work, path), "utf8");
  assert.equal(
    read("README.md"),
    `# Acme Ledger\n\nInitialized from Orion commit \`${orionHead}\` on 2026-09-29.\n`,
  );
  for (const path of [projectPlanPath, projectHumanActionsPath])
    assert.match(read(path), /^# Acme Ledger /);
  assert.match(
    read(projectHumanActionsPath),
    new RegExp(`${normalizeRepositoryUrl(repo.product)} uses @acme-ledger\\.`),
  );
  // The foundation's reference implementation and history are gone, and the
  // project-owned composition no longer refers to them.
  for (const path of fixtureContract.foundationOnly)
    assert.ok(!existsSync(join(repo.work, path)), path);
  assert.equal(
    read("apps/api/src/modules.ts"),
    "export const apiModules = [];\n",
  );
  // Non-template assets are copied byte for byte.
  assert.equal(
    read("apps/web/src/assets/mark.bin"),
    fixtureFiles["tooling/project/templates/mark.bin"],
  );
  // Workspace identity follows the project; authored prose is not rewritten.
  assert.equal(
    (JSON.parse(read("package.json")) as { name: string }).name,
    "acme-ledger",
  );
  assert.match(read("apps/web/package.json"), /"@acme-ledger\/web"/);
  assert.match(read("apps/web/package.json"), /"@acme-ledger\/sdk"/);
  assert.match(read("pnpm-lock.yaml"), /'@acme-ledger\/sdk':/);
  assert.match(read("apps/web/src/api-client.ts"), /from "@acme-ledger\/sdk"/);
  assert.match(read("docs/policy.md"), /`@orion\/sdk`/);

  const config = (key: string) => git(repo.work, "config", "--get", key);
  assert.equal(config("remote.origin.url"), repo.product);
  assert.equal(config("remote.orion-upstream.url"), repo.canonical);
  assert.equal(config("remote.orion-upstream.pushurl"), fetchOnlyPushUrl);
  assert.equal(config("remote.orion-upstream.tagOpt"), "--no-tags");
  assert.throws(() => config("branch.main.remote"));

  const canonicalMain = git(repo.canonicalBare, "rev-parse", "main");
  assert.throws(() => git(repo.work, "push", "orion-upstream", "main"));
  assert.throws(() => git(repo.work, "push"));
  assert.equal(git(repo.canonicalBare, "rev-parse", "main"), canonicalMain);
  git(repo.work, "push", "--quiet", "-u", "origin", "main");
  assert.equal(
    git(repo.productBare, "rev-parse", "main"),
    git(repo.work, "rev-parse", "HEAD"),
  );
  assert.deepEqual(checkProvenance(repo.work).errors, []);
  refusal(() => repo.init(), /already describes the derived project/);
});

void test("initialization refuses ambiguous or unsafe starting states", () => {
  const dirty = fixture();
  refusal(
    () =>
      initializeProject(join(dirty.work, "docs"), {
        name: "Acme Ledger",
        repository: dirty.product,
        apply: true,
      }),
    /from the repository root/,
  );
  write(dirty.work, "docs/policy.md", "# Policy\n\nLocal edit.\n");
  refusal(() => dirty.init(), /uncommitted or untracked changes/);
  git(dirty.work, "checkout", "--", "docs/policy.md");
  write(dirty.work, "notes.txt", "untracked\n");
  refusal(() => dirty.init(), /notes\.txt/);
  rmSync(join(dirty.work, "notes.txt"));

  refusal(
    () =>
      dirty.init({
        repository: dirty.canonical.replace(
          "https://example.test/",
          "git@example.test:",
        ),
      }),
    /must be the new project's repository/,
  );
  refusal(() => dirty.init({ name: "Bad`Name" }), /--name must be/);
  refusal(
    () =>
      dirty.init({
        repository: "https://user:secret@example.test/acme/ledger",
      }),
    /credentials/,
  );

  git(
    dirty.work,
    "remote",
    "set-url",
    "origin",
    "https://example.test/fork/core",
  );
  refusal(
    () => dirty.init(),
    /Every origin URL must identify the canonical Orion repository/,
  );
  git(dirty.work, "remote", "set-url", "origin", dirty.canonical);

  git(dirty.work, "commit", "--quiet", "--allow-empty", "--message", "local");
  refusal(() => dirty.init(), /not published on origin\/main/);
  git(dirty.work, "reset", "--quiet", "--hard", "origin/main");

  git(dirty.work, "switch", "--quiet", "-c", "feature");
  refusal(() => dirty.init(), /Check out the main branch/);
  git(dirty.work, "switch", "--quiet", "main");

  git(dirty.work, "remote", "add", "orion-upstream", dirty.canonical);
  refusal(() => dirty.init(), /orion-upstream remote already exists/);
  git(dirty.work, "remote", "remove", "orion-upstream");
  assert.equal(git(dirty.work, "status", "--porcelain"), "");
  assert.equal(readManifest(dirty.work).kind, "foundation");

  const released = fixture({
    releases: [
      {
        id: "r1",
        environment: "prod",
        gitCommit: "a".repeat(40),
        migrations: [],
      },
    ],
  });
  refusal(() => released.init(), /records durable releases/);

  const shallow = fixture();
  const shallowWork = join(shallow.base, "shallow");
  git(
    shallow.base,
    "clone",
    "--quiet",
    "--depth",
    "1",
    `${shallow.canonical}`.replace("https://example.test/", remoteBase),
    shallowWork,
  );
  git(shallowWork, "remote", "set-url", "origin", shallow.canonical);
  refusal(
    () =>
      initializeProject(shallowWork, {
        name: "Acme Ledger",
        repository: shallow.product,
        apply: true,
      }),
    /Shallow clones/,
  );
});

void test("a failed initialization restores the clean foundation checkout", () => {
  const repo = fixture();
  assert.throws(
    () =>
      repo.init({
        materialize: () => {
          throw new Error("generation failed");
        },
      }),
    /restored to [0-9a-f]{40}.*\n[\s\S]*generation failed/,
  );
  for (const path of fixtureContract.foundationOnly)
    assert.ok(existsSync(join(repo.work, path)), path);
  assert.equal(
    readFileSync(join(repo.work, "package.json"), "utf8"),
    fixtureFiles["package.json"],
  );
  assert.equal(
    git(repo.work, "status", "--porcelain", "--untracked-files=all"),
    "",
  );
  assert.equal(readManifest(repo.work).kind, "foundation");
  assert.equal(git(repo.work, "remote"), "origin");
});

void test("upgrades are reviewed merges whose baseline is recorded only after integration", () => {
  const repo = fixture();
  const initial = git(repo.work, "rev-parse", "HEAD");
  repo.init();
  git(repo.work, "push", "--quiet", "-u", "origin", "main");

  const next = repo.advanceFoundation("Version 2");
  git(repo.work, "fetch", "--quiet", "orion-upstream");
  let status = projectStatus(repo.work) as ProjectStatus;
  assert.equal(status.pushDisabled, true);
  assert.equal(status.upstreamCommit, next);
  assert.equal(status.upstreamCommitsAfterBaseline, 1);
  assert.equal(status.unrecordedIntegratedCommits, 0);
  refusal(() => recordBaseline(repo.work, next), /not integrated into HEAD/);

  git(repo.work, "switch", "--quiet", "-c", "orion-upgrade");
  git(
    repo.work,
    "merge",
    "--quiet",
    "--no-ff",
    "--no-edit",
    "orion-upstream/main",
  );
  status = projectStatus(repo.work) as ProjectStatus;
  assert.equal(status.unrecordedIntegratedCommits, 1);
  assert.deepEqual(recordBaseline(repo.work, "orion-upstream/main"), {
    previous: initial,
    next,
  });
  refusal(
    () => recordBaseline(repo.work, next),
    /Commit the validated upgrade/,
  );
  git(
    repo.work,
    "commit",
    "--quiet",
    "--all",
    "--message",
    "Record Orion baseline",
  );
  const manifest = readManifest(repo.work) as ProjectManifest;
  assert.equal(manifest.foundation.baselineCommit, next);
  assert.equal(manifest.foundation.initializedFromCommit, initial);
  assert.deepEqual(checkProvenance(repo.work).errors, []);
  refusal(
    () => recordBaseline(repo.work, next),
    /already the recorded baseline/,
  );
  refusal(() => recordBaseline(repo.work, initial), /does not descend/);

  git(repo.work, "commit", "--quiet", "--allow-empty", "--message", "product");
  refusal(
    () => recordBaseline(repo.work, "HEAD"),
    /not on the canonical Orion main/,
  );

  const squashed = repo.advanceFoundation("Version 3");
  git(repo.work, "fetch", "--quiet", "orion-upstream");
  git(repo.work, "merge", "--quiet", "--squash", "orion-upstream/main");
  git(repo.work, "commit", "--quiet", "--message", "Squashed upgrade");
  refusal(
    () => recordBaseline(repo.work, squashed),
    /not integrated into HEAD/,
  );
  write(
    repo.work,
    ".orion/project.json",
    `${JSON.stringify({ ...manifest, foundation: { ...manifest.foundation, baselineCommit: squashed } }, null, 2)}\n`,
  );
  assert.match(
    checkProvenance(repo.work).errors.join("\n"),
    /not an ancestor of HEAD/,
  );
});

void test("other clones configure the fetch-only foundation remote from the manifest", () => {
  const repo = fixture();
  repo.init();
  git(repo.work, "push", "--quiet", "-u", "origin", "main");
  const teammate = join(repo.base, "teammate");
  git(repo.base, "clone", "--quiet", repo.product, teammate);
  assert.equal(git(teammate, "remote"), "origin");
  assert.equal(
    (projectStatus(teammate) as ProjectStatus).upstreamConfigured,
    false,
  );
  // A normal clone has no orion-upstream until a developer configures it.
  assert.deepEqual(checkProvenance(teammate).errors, []);
  configureUpstream(teammate);
  configureUpstream(teammate);
  assert.equal(
    git(teammate, "config", "--get", "remote.orion-upstream.url"),
    repo.canonical,
  );
  assert.equal(
    git(teammate, "config", "--get", "remote.orion-upstream.pushurl"),
    fetchOnlyPushUrl,
  );
  git(teammate, "fetch", "--quiet", "orion-upstream");
  assert.deepEqual(checkProvenance(teammate).errors, []);

  git(
    teammate,
    "remote",
    "set-url",
    "orion-upstream",
    "https://example.test/other/core",
  );
  refusal(() => configureUpstream(teammate), /points at/);
  git(teammate, "remote", "remove", "orion-upstream");
  git(teammate, "remote", "set-url", "origin", repo.canonical);
  refusal(
    () => configureUpstream(teammate),
    /origin identifies the Orion foundation repository/,
  );
});

void test("provenance validation rejects remotes that push to or fetch the wrong foundation", () => {
  const repo = fixture();
  repo.init();
  git(repo.work, "push", "--quiet", "-u", "origin", "main");
  const errors = () => checkProvenance(repo.work).errors.join("\n");
  assert.equal(errors(), "");

  const canonicalSsh = repo.canonical.replace(
    "https://example.test/",
    "git@example.test:",
  );
  for (const url of [repo.canonical, `${canonicalSsh}.git`]) {
    git(repo.work, "remote", "set-url", "origin", url);
    assert.match(
      errors(),
      /origin identifies the Orion foundation repository .*git remote set-url origin <url>.*pnpm orion:upstream/,
    );
  }
  git(repo.work, "remote", "set-url", "origin", repo.product);
  git(repo.work, "remote", "set-url", "--push", "origin", repo.canonical);
  assert.match(errors(), /origin identifies the Orion foundation repository/);
  git(repo.work, "config", "--unset-all", "remote.origin.pushurl");
  assert.equal(errors(), "");

  git(
    repo.work,
    "remote",
    "set-url",
    "orion-upstream",
    "https://example.test/other/core",
  );
  assert.match(
    errors(),
    /orion-upstream fetches https:\/\/example\.test\/other\/core, not the recorded foundation/,
  );
  git(repo.work, "remote", "set-url", "orion-upstream", repo.canonical);
  assert.equal(errors(), "");

  const pushable = /orion-upstream is pushable; run pnpm orion:upstream/;
  git(repo.work, "config", "--unset-all", "remote.orion-upstream.pushurl");
  assert.match(errors(), pushable);
  configureUpstream(repo.work);
  assert.equal(errors(), "");
  git(
    repo.work,
    "remote",
    "set-url",
    "--push",
    "orion-upstream",
    repo.canonical,
  );
  assert.match(errors(), pushable);
  configureUpstream(repo.work);
  git(
    repo.work,
    "config",
    "--add",
    "remote.orion-upstream.pushurl",
    repo.canonical,
  );
  assert.match(errors(), pushable);
  configureUpstream(repo.work);
  assert.equal(
    git(repo.work, "config", "--get-all", "remote.orion-upstream.pushurl"),
    fetchOnlyPushUrl,
  );
  assert.equal(errors(), "");
  const canonicalMain = git(repo.canonicalBare, "rev-parse", "main");
  assert.throws(() => git(repo.work, "push", "orion-upstream", "main"));
  assert.equal(git(repo.canonicalBare, "rev-parse", "main"), canonicalMain);
});

void test("a contributor working through a project fork remains valid", () => {
  const repo = fixture();
  repo.init();
  git(repo.work, "push", "--quiet", "-u", "origin", "main");
  // The fork is neither the foundation nor the canonical project repository.
  git(repo.base, "clone", "--quiet", "--bare", repo.productBare, repo.forkBare);
  const contributor = join(repo.base, "contributor");
  git(repo.base, "clone", "--quiet", repo.fork, contributor);
  assert.equal(
    git(contributor, "config", "--get", "remote.origin.url"),
    repo.fork,
  );
  assert.deepEqual(checkProvenance(contributor).errors, []);

  configureUpstream(contributor);
  git(contributor, "fetch", "--quiet", "orion-upstream");
  assert.deepEqual(checkProvenance(contributor).errors, []);
  git(contributor, "remote", "add", "project", repo.product);
  assert.deepEqual(checkProvenance(contributor).errors, []);

  git(contributor, "switch", "--quiet", "-c", "feature");
  git(
    contributor,
    "commit",
    "--quiet",
    "--allow-empty",
    "--message",
    "product work",
  );
  git(contributor, "push", "--quiet", "origin", "feature");
  assert.equal(
    git(repo.forkBare, "rev-parse", "feature"),
    git(contributor, "rev-parse", "HEAD"),
  );
});

void test("no local branch may track the foundation remote", () => {
  const repo = fixture();
  repo.init();
  git(repo.work, "push", "--quiet", "-u", "origin", "main");
  git(repo.work, "fetch", "--quiet", "orion-upstream");
  assert.deepEqual(checkProvenance(repo.work).errors, []);

  // Track the foundation from the checked-out branch and a non-current one.
  git(repo.work, "branch", "--quiet", "--set-upstream-to=orion-upstream/main");
  git(repo.work, "branch", "--quiet", "side", "orion-upstream/main");
  git(
    repo.work,
    "branch",
    "--quiet",
    "--set-upstream-to=orion-upstream/main",
    "side",
  );
  git(repo.work, "branch", "--quiet", "product", "main");
  git(
    repo.work,
    "branch",
    "--quiet",
    "--set-upstream-to=origin/main",
    "product",
  );
  const [error, ...others] = checkProvenance(repo.work).errors;
  assert.deepEqual(others, []);
  assert.match(
    error,
    /^Local branch\(es\) main, side track orion-upstream, so git pull could merge foundation changes outside a reviewed upgrade; run pnpm orion:upstream/,
  );

  configureUpstream(repo.work);
  assert.deepEqual(checkProvenance(repo.work).errors, []);
  for (const branch of ["main", "side"])
    assert.throws(() =>
      git(repo.work, "config", "--get", `branch.${branch}.remote`),
    );
  // Tracking of other remotes is untouched, and repair is idempotent.
  assert.equal(
    git(repo.work, "config", "--get", "branch.product.remote"),
    "origin",
  );
  configureUpstream(repo.work);
  assert.deepEqual(checkProvenance(repo.work).errors, []);
});

void test("explicit ports stay part of repository identity through initialization and remote checks", () => {
  const repo = fixture();
  const withPort = (url: string, port: string) =>
    url.replace("https://example.test/", `https://example.test:${port}/`);
  const productPath = repo.product
    .replace(/^git@example\.test:/, "")
    .replace(/\.git$/, "");
  const productWithPort = `https://example.test:8443/${productPath}`;
  assert.equal(
    repo.init({ apply: false, repository: `${productWithPort}.git` }).manifest
      .repository.url,
    productWithPort,
  );
  // The foundation's host on another port is a different endpoint, not the
  // foundation itself, while the explicit default port is the same endpoint.
  assert.equal(
    repo.init({ apply: false, repository: withPort(repo.canonical, "8443") })
      .manifest.repository.url,
    withPort(repo.canonical, "8443"),
  );
  refusal(
    () =>
      repo.init({ apply: false, repository: withPort(repo.canonical, "443") }),
    /must be the new project's repository/,
  );
  refusal(
    () =>
      repo.init({
        apply: false,
        repository: "ssh://git@example.test:2222/acme/ledger.git",
      }),
    /SSH port 2222/,
  );

  repo.init();
  const errors = () => checkProvenance(repo.work).errors.join("\n");
  git(
    repo.work,
    "remote",
    "set-url",
    "origin",
    withPort(repo.canonical, "8443"),
  );
  assert.equal(errors(), "");
  git(
    repo.work,
    "remote",
    "set-url",
    "origin",
    withPort(repo.canonical, "443"),
  );
  assert.match(errors(), /origin identifies the Orion foundation repository/);
  git(repo.work, "remote", "set-url", "origin", repo.product);
  git(
    repo.work,
    "remote",
    "set-url",
    "orion-upstream",
    withPort(repo.canonical, "8443"),
  );
  assert.match(
    errors(),
    /orion-upstream fetches .*:8443.*, not the recorded foundation/,
  );
  refusal(() => configureUpstream(repo.work), /not the recorded foundation/);
  git(
    repo.work,
    "remote",
    "set-url",
    "orion-upstream",
    withPort(repo.canonical, "443"),
  );
  assert.equal(errors(), "");
});

void test("initialization refuses an origin that also lists another repository", () => {
  const repo = fixture();
  const other = "https://example.test/other/core";
  git(repo.work, "config", "--add", "remote.origin.url", other);
  const head = git(repo.work, "rev-parse", "HEAD");
  const before = git(repo.work, "config", "--get-all", "remote.origin.url");
  assert.equal(before, `${repo.canonical}\n${other}`);
  for (const apply of [false, true])
    refusal(
      () => repo.init({ apply }),
      /Every origin URL must identify the canonical Orion repository .*git config --replace-all remote\.origin\.url .*Found: https:\/\/example\.test\/other\/core/,
    );
  // Nothing was mutated: no commit, no files, and remotes as they were.
  assert.equal(git(repo.work, "rev-parse", "HEAD"), head);
  assert.equal(
    git(repo.work, "status", "--porcelain", "--untracked-files=all"),
    "",
  );
  assert.equal(readManifest(repo.work).kind, "foundation");
  assert.equal(git(repo.work, "remote"), "origin");
  assert.equal(
    git(repo.work, "config", "--get-all", "remote.origin.url"),
    before,
  );
  assert.equal(repo.materialized.length, 0);

  git(
    repo.work,
    "config",
    "--replace-all",
    "remote.origin.url",
    repo.canonical,
  );
  assert.equal(repo.init({ apply: false }).applied, false);
});

void test("path case is exact when accepting a remote and conservative when refusing one", () => {
  const repo = fixture();
  repo.init();
  const errors = () => checkProvenance(repo.work).errors.join("\n");
  const recased = repo.canonical
    .replace("/orion", "/Orion")
    .replace("/core", "/Core");
  assert.notEqual(recased, repo.canonical);
  git(repo.work, "remote", "set-url", "orion-upstream", recased);
  assert.match(
    errors(),
    /orion-upstream fetches .*\/Core, not the recorded foundation/,
  );
  refusal(() => configureUpstream(repo.work), /not the recorded foundation/);
  git(repo.work, "remote", "set-url", "orion-upstream", repo.canonical);
  git(repo.work, "remote", "set-url", "origin", recased);
  assert.match(errors(), /origin identifies the Orion foundation repository/);
  git(repo.work, "remote", "set-url", "origin", repo.product);
  assert.equal(errors(), "");
});

void test("a wrong orion-upstream with plausible ancestry cannot become the baseline", () => {
  const repo = fixture();
  repo.init();
  git(repo.work, "push", "--quiet", "-u", "origin", "main");
  const baseline = (readManifest(repo.work) as ProjectManifest).foundation
    .baselineCommit;

  // Another repository that shares Orion's history and adds a descendant.
  const impostorName = `impostor-${basename(repo.base)}`;
  const impostorUrl = `https://example.test/${impostorName}/core`;
  git(
    repo.base,
    "clone",
    "--quiet",
    "--bare",
    repo.canonicalBare,
    join(remotes, impostorName, "core"),
  );
  const impostorWork = join(repo.base, "impostor-work");
  git(repo.base, "clone", "--quiet", impostorUrl, impostorWork);
  git(
    impostorWork,
    "commit",
    "--quiet",
    "--allow-empty",
    "--message",
    "Not Orion",
  );
  git(impostorWork, "push", "--quiet", "origin", "main");
  const impostor = git(impostorWork, "rev-parse", "HEAD");
  // git() throws unless the impostor commit really descends from the baseline.
  git(impostorWork, "merge-base", "--is-ancestor", baseline, impostor);

  git(repo.work, "switch", "--quiet", "-c", "orion-upgrade");
  git(repo.work, "fetch", "--quiet", impostorUrl, "main");
  git(repo.work, "merge", "--quiet", "--no-ff", "--no-edit", "FETCH_HEAD");
  git(repo.work, "remote", "set-url", "orion-upstream", impostorUrl);
  git(repo.work, "fetch", "--quiet", "orion-upstream");
  assert.equal(git(repo.work, "rev-parse", "orion-upstream/main"), impostor);
  refusal(
    () => recordBaseline(repo.work, impostor),
    /foundation remote must be verified first:\n- orion-upstream fetches https:\/\/example\.test\/impostor-.*, not the recorded foundation/,
  );

  // Correcting the URL without refetching leaves stale impostor refs, which
  // recording refreshes from the verified foundation before trusting them.
  git(repo.work, "remote", "set-url", "orion-upstream", repo.canonical);
  assert.equal(git(repo.work, "rev-parse", "orion-upstream/main"), impostor);
  // The refreshed foundation branch resolves to the real Orion tip, which is
  // still the recorded baseline, not the impostor commit.
  refusal(
    () => recordBaseline(repo.work, "orion-upstream/main"),
    new RegExp(`${baseline} is already the recorded baseline`),
  );
  assert.equal(
    git(repo.work, "rev-parse", "orion-upstream/main"),
    git(repo.canonicalBare, "rev-parse", "main"),
  );
  refusal(
    () => recordBaseline(repo.work, impostor),
    /is not on the canonical Orion main branch/,
  );

  git(repo.work, "remote", "remove", "orion-upstream");
  refusal(
    () => recordBaseline(repo.work, impostor),
    /orion-upstream is not configured; run pnpm orion:upstream/,
  );
  assert.equal(
    (readManifest(repo.work) as ProjectManifest).foundation.baselineCommit,
    baseline,
  );
});

void test("upgrade merges are pruned of reintroduced foundation-only content and scope", () => {
  const repo = fixture();
  repo.init();
  git(repo.work, "push", "--quiet", "-u", "origin", "main");
  // The foundation evolves its reference implementation and shared source.
  write(
    repo.seed,
    "apps/api/src/features/sample-reference/module.ts",
    "export const referenceModule = { version: 2 };\n",
  );
  write(
    repo.seed,
    "apps/api/src/features/sample-reference/routes.ts",
    "export {};\n",
  );
  write(
    repo.seed,
    "apps/web/src/extra.ts",
    'export type { paths } from "@orion/sdk";\n',
  );
  git(repo.seed, "add", "--all");
  git(repo.seed, "commit", "--quiet", "--message", "Version 2");
  git(repo.seed, "push", "--quiet", "origin", "main");

  git(repo.work, "fetch", "--quiet", "orion-upstream");
  git(repo.work, "switch", "--quiet", "-c", "orion-upgrade");
  // The project deleted what the foundation modified: a modify/delete conflict.
  assert.throws(() =>
    git(repo.work, "merge", "--no-ff", "--no-edit", "orion-upstream/main"),
  );
  const actions = pruneProject(repo.work).join("\n");
  assert.match(
    actions,
    /Removed foundation-only paths: apps\/api\/src\/features\/sample-reference/,
  );
  assert.match(actions, /apps\/web\/src\/extra\.ts/);
  assert.equal(git(repo.work, "diff", "--name-only", "--diff-filter=U"), "");
  git(repo.work, "commit", "--quiet", "--no-edit");
  assert.ok(
    !existsSync(join(repo.work, "apps/api/src/features/sample-reference")),
  );
  assert.match(
    readFileSync(join(repo.work, "apps/web/src/extra.ts"), "utf8"),
    /"@acme-ledger\/sdk"/,
  );
  recordBaseline(repo.work, "orion-upstream/main");
  git(repo.work, "commit", "--quiet", "--all", "--message", "Record baseline");
  assert.deepEqual(checkProvenance(repo.work).errors, []);
  assert.deepEqual(pruneProject(repo.work), [
    "No foundation-only paths were present",
    "No @orion references remained",
  ]);
});

void test("pruning preserves unresolved shared files and project-owned files for review", () => {
  const repo = fixture();
  repo.init();
  write(
    repo.work,
    "apps/api/src/modules.ts",
    'import "@orion/product-module";\nexport const apiModules = [];\n',
  );
  git(
    repo.work,
    "commit",
    "--quiet",
    "--all",
    "--message",
    "Project composition",
  );
  write(
    repo.seed,
    "apps/web/src/api-client.ts",
    'import { createApiClient } from "@orion/sdk";\nexport const client = createApiClient({});\n',
  );
  write(
    repo.seed,
    "package.json",
    '{\n  "name": "orion-foundation",\n  "private": true\n}\n',
  );
  write(repo.seed, "apps/web/src/new-client.ts", 'import "@orion/sdk";\n');
  git(repo.seed, "add", "--all");
  git(repo.seed, "commit", "--quiet", "--message", "Shared client upgrade");
  git(repo.seed, "push", "--quiet", "origin", "main");
  git(repo.work, "fetch", "--quiet", "orion-upstream");
  assert.throws(() =>
    git(repo.work, "merge", "--no-ff", "--no-edit", "orion-upstream/main"),
  );
  const conflicts = git(repo.work, "ls-files", "--unmerged");
  assert.match(conflicts, /apps\/web\/src\/api-client\.ts/);
  assert.match(conflicts, /package\.json/);
  const preservedPaths = [
    "package.json",
    "apps/web/src/api-client.ts",
    "apps/api/src/modules.ts",
  ];
  const before = preservedPaths.map((path) =>
    readFileSync(join(repo.work, path), "utf8"),
  );
  const actions = pruneProject(repo.work).join("\n");
  assert.equal(git(repo.work, "ls-files", "--unmerged"), conflicts);
  assert.deepEqual(
    preservedPaths.map((path) => readFileSync(join(repo.work, path), "utf8")),
    before,
  );
  assert.match(actions, /Skipped unresolved.*package\.json/);
  assert.equal(
    git(repo.work, "show", ":apps/web/src/new-client.ts"),
    'import "@acme-ledger/sdk";',
  );
  write(repo.work, "apps/web/src/api-client.ts", 'import "@orion/sdk";\n');
  write(
    repo.work,
    "package.json",
    '{\n  "name": "acme-ledger",\n  "private": true\n}\n',
  );
  git(repo.work, "add", "package.json", "apps/web/src/api-client.ts");
  pruneProject(repo.work);
  assert.equal(
    git(repo.work, "show", ":apps/web/src/api-client.ts"),
    'import "@acme-ledger/sdk";',
  );
});

void test("pruning refuses to delete a recorded durable migration before changing files", () => {
  const repo = fixture();
  repo.init();
  const migration = "20260924000000_example";
  const migrationPath = `apps/api/prisma/migrations/${migration}`;
  write(
    repo.work,
    ".orion/derivation.json",
    JSON.stringify({
      ...fixtureContract,
      foundationOnly: [...fixtureContract.foundationOnly, migrationPath],
    }),
  );
  write(
    repo.work,
    `${migrationPath}/migration.sql`,
    "CREATE TABLE example (id integer);\n",
  );
  write(
    repo.work,
    "docs/implementation-plan.md",
    "# Reintroduced foundation plan\n",
  );
  write(
    repo.work,
    "apps/api/prisma/release-history.json",
    JSON.stringify({
      schemaVersion: 1,
      recordedDurableReleases: [
        {
          id: "durable-1",
          environment: "test",
          gitCommit: "a".repeat(40),
          migrations: [{ directory: migration, sha256: "b".repeat(64) }],
        },
      ],
    }),
  );
  git(repo.work, "add", "--all");
  const index = git(repo.work, "write-tree");
  refusal(() => pruneProject(repo.work), /recorded durable migration/);
  assert.equal(git(repo.work, "write-tree"), index);
  assert.ok(existsSync(join(repo.work, `${migrationPath}/migration.sql`)));
  assert.ok(existsSync(join(repo.work, "docs/implementation-plan.md")));
});

void test("pruning refuses linked paths before deleting outside the checkout", () => {
  const repo = fixture();
  repo.init();
  const outside = join(repo.base, "outside");
  write(outside, "content/keep.txt", "outside data\n");
  symlinkSync(
    outside,
    join(repo.work, "linked"),
    process.platform === "win32" ? "junction" : "dir",
  );
  write(
    repo.work,
    ".orion/derivation.json",
    JSON.stringify({
      ...fixtureContract,
      foundationOnly: [...fixtureContract.foundationOnly, "linked/content"],
    }),
  );
  refusal(() => pruneProject(repo.work), /linked repository path/);
  assert.equal(
    readFileSync(join(outside, "content/keep.txt"), "utf8"),
    "outside data\n",
  );
});

void test("project validation rejects foundation-only content and the foundation package scope", () => {
  const repo = fixture();
  repo.init();
  write(repo.work, "docs/implementation-plan.md", "# Orion plan\n");
  write(repo.work, "apps/web/src/extra.ts", 'import "@orion/sdk";\n');
  write(repo.work, "package.json", '{"name":"orion","private":true}\n');
  git(repo.work, "add", "--all");
  const errors = checkProvenance(repo.work).errors.join("\n");
  assert.match(errors, /package\.json name must be acme-ledger/);
  assert.match(
    errors,
    /Foundation-only paths are present: docs\/implementation-plan\.md; .*pnpm orion:prune/,
  );
  assert.match(
    errors,
    /apps\/web\/src\/extra\.ts still reference the foundation package scope @orion; run pnpm orion:prune to rename them to @acme-ledger/,
  );
  rmSync(join(repo.work, projectPlanPath));
  assert.match(
    checkProvenance(repo.work).errors.join("\n"),
    /implementation-plan\.md: missing project-owned document/,
  );
  git(repo.work, "checkout", "--", projectPlanPath);
  pruneProject(repo.work);
  assert.deepEqual(checkProvenance(repo.work).errors, []);
});

void test("foundation validation keeps shared files independent of foundation-only content", () => {
  const repo = fixture();
  assert.deepEqual(checkProvenance(repo.work).errors, []);
  write(
    repo.work,
    "docs/guide.md",
    "# Guide\n\nSee the [plan](implementation-plan.md#phase-1).\n",
  );
  write(
    repo.work,
    "apps/api/src/app.ts",
    'import { referenceModule } from "./features/sample-reference/module.js";\nexport const app = referenceModule;\n',
  );
  write(
    repo.work,
    "docs/other.md",
    "# Other\n\nThe Sample Reference example.\n",
  );
  git(repo.work, "add", "--all");
  const errors = checkProvenance(repo.work).errors.join("\n");
  assert.match(
    errors,
    /docs\/guide\.md references docs\/implementation-plan\.md/,
  );
  assert.match(
    errors,
    /apps\/api\/src\/app\.ts references apps\/api\/src\/features\/sample-reference/,
  );
  assert.match(errors, /docs\/other\.md mentions "sample reference"/);
  git(repo.work, "reset", "--quiet", "--hard");
  git(repo.work, "clean", "-fdq");
  write(
    repo.work,
    ".orion/derivation.json",
    JSON.stringify({
      ...fixtureContract,
      foundationOnly: [...fixtureContract.foundationOnly, "docs/missing.md"],
    }),
  );
  assert.match(
    checkProvenance(repo.work).errors.join("\n"),
    /foundation-only docs\/missing\.md does not exist/,
  );
});

void test("the derivation contract rejects unsafe or contradictory entries", () => {
  assert.doesNotThrow(() =>
    parseDerivationContract(JSON.stringify(fixtureContract)),
  );
  assert.ok(readDerivationContract(repositoryRoot).foundationOnly.length > 0);
  const cases: [Record<string, unknown>, RegExp][] = [
    [{ foundationOnly: ["../outside"] }, /repository-relative paths/],
    [{ foundationOnly: [".git"] }, /repository-relative paths/],
    [{ foundationOnly: ["tooling"] }, /shared derivation tooling/],
    [
      { foundationOnly: ["tooling/project/cli.ts"] },
      /shared derivation tooling/,
    ],
    [
      { foundationOnly: ["README.md"] },
      /both foundation-only and project-owned/,
    ],
    [
      { projectFiles: { "README.md": "docs/template.md" } },
      /must be under tooling\/project\/templates/,
    ],
    [{ workspaceScope: "orion" }, /npm scope/],
    [{ foundationOnlyTerms: ["Sample"] }, /lowercase terms/],
    [{ extra: true }, /must contain exactly/],
    [{ schemaVersion: 2 }, /unsupported schemaVersion/],
  ];
  for (const [change, pattern] of cases)
    assert.throws(
      () =>
        parseDerivationContract(
          JSON.stringify({ ...fixtureContract, ...change }),
        ),
      pattern,
    );
});

void test("project identity yields a package scope, and earlier project manifests require migration", () => {
  assert.equal(defaultPackageScope("Acme Ledger"), "@acme-ledger");
  assert.equal(defaultPackageScope("Ação Clínica 2"), "@acao-clinica-2");
  const repo = fixture();
  assert.equal(
    repo.init({ apply: false, packageScope: "@ledger" }).manifest.packageScope,
    "@ledger",
  );
  refusal(
    () => repo.init({ apply: false, packageScope: "@orion" }),
    /must differ from the foundation scope @orion/,
  );
  refusal(
    () => repo.init({ apply: false, packageScope: "Ledger" }),
    /--package-scope must be an npm scope/,
  );
  refusal(
    () => repo.init({ apply: false, name: "日本" }),
    /package scope derived from --name \(@\) must be an npm scope/,
  );
  assert.throws(
    () =>
      parseManifest(
        JSON.stringify({
          schemaVersion: 1,
          kind: "project",
          name: "Acme Ledger",
        }),
      ),
    /schemaVersion 1 records the earlier derivation contract.*migrate-a-project-from-schema-version-1/,
  );
});
