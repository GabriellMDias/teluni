import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const repository = path.resolve(import.meta.dirname, "../..");

test("installed tool skills are excluded while project documentation stays validated", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "teluni-docs-test-"));
  const write = async (name, content) => {
    const destination = path.join(root, name);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, content);
  };
  const check = () =>
    spawnSync(process.execPath, ["tooling/validate/docs.ts"], {
      cwd: root,
      encoding: "utf8",
    });
  try {
    await write("package.json", '{"type":"module"}');
    await write("README.md", "# Project\n\n[Guide](docs/guide.md)\n");
    await write("docs/guide.md", "# Guide\n");
    await mkdir(path.join(root, "tooling/validate"), { recursive: true });
    await copyFile(
      path.join(repository, "tooling/validate/docs.ts"),
      path.join(root, "tooling/validate/docs.ts"),
    );
    await symlink(
      path.join(repository, "node_modules"),
      path.join(root, "node_modules"),
      "junction",
    );
    for (const tool of [".agents", ".claude", ".windsurf"]) {
      await write(
        `apps/api/${tool}/skills/example/SKILL.md`,
        "[External reference](missing.md)\n",
      );
    }
    let result = check();
    assert.equal(result.status, 0, result.stderr);

    const decision = (id) =>
      `# ADR-${id}: Preserve Published Identity\n\n**Status:** accepted\n\n**Date:** 2026-10-23\n\n## Context\n\nIndependent histories.\n\n## Decision\n\nRetain identifiers.\n\n## Rationale\n\nStable references.\n\n## Consequences\n\nSeparate indexes.\n`;
    await write("docs/guide.md", "# Guide\n\n[Decisions](adr/README.md)\n");
    await write(
      "docs/adr/README.md",
      "# Decisions\n\n[Project](0018-project.md)\n\n[Orion](orion/README.md)\n",
    );
    await write("docs/adr/0018-project.md", decision("0018"));
    await write(
      "docs/adr/orion/README.md",
      "# Orion decisions\n\n[Foundation](0018-foundation.md)\n",
    );
    await write("docs/adr/orion/0018-foundation.md", decision("0018"));
    result = check();
    assert.equal(result.status, 0, result.stderr);

    await write("docs/adr/orion/0018-duplicate.md", decision("0018"));
    await write("docs/adr/orion/0019-invalid.md", "# Invalid record\n");
    await write("docs/adr/other/0018-project.md", decision("0018"));
    result = check();
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /duplicate ADR identifier 0018/);
    assert.match(result.stderr, /absent from docs\/adr\/orion\/README.md/);
    assert.match(result.stderr, /title does not match ADR identifier/);
    assert.match(result.stderr, /missing or invalid ADR status/);
    assert.match(result.stderr, /missing ISO ADR date/);
    assert.match(result.stderr, /missing Context section/);
    assert.match(result.stderr, /unsupported ADR namespace docs\/adr\/other/);
    await rm(path.join(root, "docs/adr/orion/0018-duplicate.md"));
    await rm(path.join(root, "docs/adr/orion/0019-invalid.md"));
    await rm(path.join(root, "docs/adr/other/0018-project.md"));

    await write("docs/orphan.md", "# Orphan\n");
    await write("docs/guide.md", "# Guide\n\n[Missing](missing.md)\n");
    await write("apps/api/.agents/notes.md", "# Notes\n");
    await write("docs/skills/example.md", "# Project skills guide\n");
    result = check();
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /docs\/orphan.md: not reachable/);
    assert.match(result.stderr, /docs\/guide.md: missing local target/);
    assert.match(result.stderr, /\.agents\/notes.md: not reachable/);
    assert.match(result.stderr, /docs\/skills\/example.md: not reachable/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
