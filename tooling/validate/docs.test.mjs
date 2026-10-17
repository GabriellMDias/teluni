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
