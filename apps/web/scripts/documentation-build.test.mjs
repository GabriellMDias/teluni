import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { URL } from "node:url";
import test from "node:test";
import { chromium } from "@playwright/test";
import { build, preview } from "vite";
import {
  internalDocumentationEnabled,
  isInternalDocumentationModule,
} from "./documentation-build.ts";

const root = resolve(import.meta.dirname, "..");

test("documentation selection keeps local compatibility and fails closed for builds", () => {
  assert.equal(internalDocumentationEnabled("serve", {}), true);
  assert.equal(internalDocumentationEnabled("build", {}), false);
  for (const command of ["serve", "build"]) {
    assert.equal(
      internalDocumentationEnabled(command, {
        ORION_WEB_DOCUMENTATION: "disabled",
      }),
      false,
    );
    assert.throws(
      () =>
        internalDocumentationEnabled(command, {
          ORION_WEB_DOCUMENTATION: "public",
        }),
      /disabled or internal/,
    );
    assert.throws(
      () =>
        internalDocumentationEnabled(command, { ORION_WEB_DOCUMENTATION: "" }),
      /disabled or internal/,
    );
  }
  assert.equal(
    internalDocumentationEnabled("serve", {
      ORION_WEB_DOCUMENTATION: "internal",
    }),
    true,
  );
  assert.throws(
    () =>
      internalDocumentationEnabled("build", {
        ORION_WEB_DOCUMENTATION: "internal",
      }),
    /entire artifact/,
  );
  assert.equal(
    internalDocumentationEnabled("build", {
      ORION_WEB_DOCUMENTATION: "internal",
      ORION_WEB_INTERNAL_DOCS_ACCESS: "external",
    }),
    true,
  );
  for (const path of [
    "/apps/web/src/documentation.tsx",
    "/apps/web/src/documentation/search-worker.ts",
    "/apps/web/src/generated/manifest.json",
    "/apps/web/src/components.docs.json",
    "/apps/web/src/contacts/components.docs.json",
    "/docs/generated/api/openapi.json?url",
    "C:\\repo\\apps\\web\\src\\documentation.css",
  ]) {
    assert.equal(isInternalDocumentationModule(path), true, path);
  }
  assert.equal(
    isInternalDocumentationModule("/apps/web/src/components.tsx"),
    false,
  );
});

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map(async (entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? files(path) : [path];
      }),
    )
  ).flat();
}

test(
  "real product and internal builds isolate assets and preserve portal behavior",
  { timeout: 120_000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "orion-documentation-"));
    const keys = [
      "ORION_WEB_DOCUMENTATION",
      "ORION_WEB_INTERNAL_DOCS_ACCESS",
      "NODE_ENV",
    ];
    const original = Object.fromEntries(
      keys.map((key) => [key, process.env[key]]),
    );
    let browser;
    try {
      browser = await chromium.launch();
      const projectComposition = await readFile(
        new URL(
          "../../../tooling/project/templates/web-modules.tsx.tmpl",
          import.meta.url,
        ),
        "utf8",
      );
      const { foundationOnly } = JSON.parse(
        await readFile(resolve(root, "../../.orion/derivation.json"), "utf8"),
      );
      const foundationModules = foundationOnly
        .filter((path) => path.startsWith("apps/web/src/"))
        .map((path) => resolve(root, "../..", path).replaceAll("\\", "/"));
      const internalAssets = [
        ...(await files(join(root, "src/generated/pages"))),
        ...(await files(join(root, "src/generated/search"))),
        ...[
          "api/openapi.json",
          "api/errors.md",
          "database/schema.md",
          "components/web.md",
        ].map((path) => resolve(root, "../../docs/generated", path)),
      ];
      const fingerprint = (bytes) =>
        createHash("sha256").update(bytes).digest("hex");
      const expectedAssets = await Promise.all(
        internalAssets.map(async (path) => [
          path,
          fingerprint(await readFile(path)),
        ]),
      );
      // The manifest is bundled as an object in internal builds. Check its
      // original bytes separately to catch accidental public-directory copies.
      const catalogHash = fingerprint(
        await readFile(join(root, "src/generated/manifest.json")),
      );
      for (const { name, internal, derived, productHelp } of [
        { name: "foundation", internal: false, derived: false },
        { name: "project", internal: false, derived: true },
        {
          name: "product-help",
          internal: false,
          derived: true,
          productHelp: true,
        },
        { name: "internal", internal: true, derived: true },
      ]) {
        delete process.env.ORION_WEB_DOCUMENTATION;
        delete process.env.ORION_WEB_INTERNAL_DOCS_ACCESS;
        if (internal) {
          process.env.ORION_WEB_DOCUMENTATION = "internal";
          process.env.ORION_WEB_INTERNAL_DOCS_ACCESS = "external";
        }
        const outDir = join(directory, name);
        const result = await build({
          root,
          logLevel: "silent",
          plugins: derived
            ? [
                {
                  name: "derived-project-composition",
                  enforce: "pre",
                  transform(_code, id) {
                    if (id.replaceAll("\\", "/").endsWith("/src/modules.tsx"))
                      return productHelp
                        ? `import { createRoute, Link } from '@tanstack/react-router';\n${projectComposition
                            .replace(
                              "export const routeTree = rootRoute.addChildren([\n  ...coreRoutes,",
                              "const helpRoute = createRoute({ getParentRoute: () => rootRoute, path: '/docs', component: () => <h1>Approved product help</h1> });\nexport const routeTree = rootRoute.addChildren([\n  ...coreRoutes, helpRoute,",
                            )
                            .replace(
                              "  ...(developerPortal ? [developerPortal.DocumentationNavigation] : []),",
                              '  () => <Link to="/docs">Product help</Link>,',
                            )}`
                        : projectComposition;
                  },
                },
              ]
            : [],
          build: { outDir, emptyOutDir: true },
        });
        assert.ok("output" in result);
        const modules = result.output.flatMap((item) =>
          item.type === "chunk" ? Object.keys(item.modules) : [],
        );
        assert.equal(modules.some(isInternalDocumentationModule), internal);
        if (derived && !internal)
          assert.equal(
            modules.some((id) => {
              const path = id.replaceAll("\\", "/").split("?")[0];
              return foundationModules.some(
                (prefix) => path === prefix || path.startsWith(`${prefix}/`),
              );
            }),
            false,
          );
        const emitted = await files(outDir);
        const content = (
          await Promise.all(
            emitted
              .filter((path) => /\.(js|css|json|md)$/.test(path))
              .map((path) => readFile(path, "utf8")),
          )
        ).join("\n");
        assert.equal(content.includes(".docs-workspace"), internal);
        const emittedHashes = new Set(
          await Promise.all(
            emitted.map(async (path) => fingerprint(await readFile(path))),
          ),
        );
        for (const [path, hash] of expectedAssets)
          assert.equal(emittedHashes.has(hash), internal, path);
        if (!internal)
          assert.equal(
            emittedHashes.has(catalogHash),
            false,
            "internal manifest",
          );
        const server = await preview({
          root,
          logLevel: "silent",
          build: { outDir },
          preview: { host: "127.0.0.1", port: 0, open: false },
        });
        const context = await browser.newContext();
        try {
          const address = server.httpServer.address();
          assert.ok(address && typeof address === "object");
          const url = `http://127.0.0.1:${address.port}`;
          const page = await context.newPage();
          if (productHelp) {
            await page.goto(`${url}/docs`);
            await page
              .getByRole("heading", { name: "Approved product help" })
              .waitFor();
            assert.equal(await page.locator(".docs-workspace").count(), 0);
          }
          await page.goto(`${url}/docs/api/getReadiness`);
          if (internal) {
            await page.waitForSelector(".docs-workspace h1");
            assert.equal(
              await page.locator("h1").textContent(),
              "getReadiness",
            );
            assert.equal(await page.locator(".site-header").count(), 0);
            await page.goto(`${url}/docs/search?q=onReload`);
            await page.waitForSelector(
              'a[href="/docs/components/ErrorNotice"]',
            );
            await page.goto(`${url}/docs/components/ErrorNotice`);
            await page.waitForSelector(".docs-preview");
          } else {
            // Product-owned documentation may use this URL; module/asset
            // inspection proves isolation independently of its route response.
            await page.locator("#root").filter({ hasText: /\S/ }).waitFor();
            if (derived)
              await page.getByText("Not Found", { exact: true }).waitFor();
            assert.equal(await page.locator(".docs-workspace").count(), 0);
          }
        } finally {
          await context.close();
          await new Promise((done, fail) =>
            server.httpServer.close((error) => (error ? fail(error) : done())),
          );
        }
      }
      delete process.env.ORION_WEB_DOCUMENTATION;
      delete process.env.ORION_WEB_INTERNAL_DOCS_ACCESS;
      for (const injection of [
        "import catalog from './generated/manifest.json'; console.log(catalog);",
        "import catalog from './components.docs.json'; console.log(catalog);",
        "import download from '../../../docs/generated/api/openapi.json?url'; console.log(download);",
      ])
        await assert.rejects(
          () =>
            build({
              root,
              logLevel: "silent",
              build: { write: false },
              plugins: [
                {
                  name: "accidental-product-catalog-import",
                  transform(code, id) {
                    if (id.replaceAll("\\", "/").endsWith("/src/home.tsx"))
                      return `${injection}\n${code}`;
                  },
                },
              ],
            }),
          /Internal documentation reached a product build/,
        );
    } finally {
      await browser?.close();
      for (const key of keys) {
        if (original[key] === undefined) delete process.env[key];
        else process.env[key] = original[key];
      }
      assert.ok(directory.startsWith(`${resolve(tmpdir())}${sep}`));
      await rm(directory, { recursive: true, force: true });
    }
  },
);
