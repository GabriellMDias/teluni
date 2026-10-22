import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { teluniThemeFiles } from "../../scripts/keycloak.js";

// The pilot's Keycloak image (infra/pilot/Dockerfile) installs the login
// theme the qualified realm uses; both must name the same files.
const repositoryRoot = resolve(import.meta.dirname, "../../../..");

describe("pilot Keycloak image", () => {
  it("copies exactly the login theme files of the qualified realm", async () => {
    const dockerfile = await readFile(
      resolve(repositoryRoot, "infra/pilot/Dockerfile"),
      "utf8",
    );
    const copies = [
      ...dockerfile.matchAll(
        /^COPY --chown=1000:0 (\S+) (\/opt\/keycloak\/themes\/\S+)$/gm,
      ),
    ].map(([, source, target]) => ({ source, target }));
    expect(copies).toEqual(
      teluniThemeFiles().map(({ source, target }) => ({
        source: relative(repositoryRoot, source),
        target,
      })),
    );
  });
});
