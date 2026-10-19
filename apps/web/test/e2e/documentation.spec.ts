import { readFileSync } from "node:fs";
import { test, expect, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { expectNoStoredUserData, isRouterReloadMarker } from "./storage.ts";

// Shared journeys use only content every Orion-based repository has; module
// suites check their own operations, tables, and components.
const projectName = (
  JSON.parse(
    readFileSync(new URL("../../../../.orion/project.json", import.meta.url), {
      encoding: "utf8",
    }),
  ) as { name: string }
).name;
const overviewTitle = `${projectName} documentation`;

const webUrl = () => process.env.ORION_E2E_WEB_URL!;
const sections = (page: Page) =>
  page.getByRole("navigation", { name: "Documentation sections" });

async function openDocument(page: Page, path: string, title: string) {
  await page.goto(`${webUrl()}${path}`);
  await expect(
    page.getByRole("heading", { level: 1, name: title, exact: true }),
  ).toBeVisible();
}

test("documentation sections isolate details and preserve deep links and browser history", async ({
  page,
}) => {
  await openDocument(page, "/docs", overviewTitle);
  for (const selector of [".docs-brand-symbol", ".brand img"]) {
    const mark = page.locator(selector);
    await expect(mark).toBeVisible();
    await expect(mark).toHaveJSProperty("complete", true);
    expect(
      await mark.evaluate((image: HTMLImageElement) => image.naturalWidth),
    ).toBeGreaterThan(0);
  }
  const favicon = page.locator('link[rel="icon"]');
  const iconResponse = await page.request.get(
    new URL((await favicon.getAttribute("href"))!, page.url()).href,
  );
  expect(iconResponse.ok()).toBe(true);
  expect(iconResponse.headers()["content-type"]).toContain("image/svg+xml");
  const touchIcon = page.locator('link[rel="apple-touch-icon"]');
  const touchUrl = new URL((await touchIcon.getAttribute("href"))!, page.url())
    .href;
  const touchResponse = await page.request.get(touchUrl);
  expect(touchResponse.ok()).toBe(true);
  expect(touchResponse.headers()["content-type"]).toContain("image/png");
  expect(
    await page.evaluate(async (url) => {
      const image = new Image();
      image.src = url;
      await image.decode();
      return [image.naturalWidth, image.naturalHeight];
    }, touchUrl),
  ).toEqual([180, 180]);
  await expect(page.locator(".docs-foundation-version")).toBeVisible();
  await expect(page.locator(".docs-foundation-version")).toContainText(
    "Orion foundation:",
  );
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  await sections(page)
    .getByRole("link", { name: "API reference", exact: true })
    .click();
  await expect(page).toHaveURL(/\/docs\/api$/);
  await page.locator('a[href="/docs/api/getReadiness"]').first().click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "getReadiness",
  );
  await expect(
    page.getByRole("heading", { name: "getLiveness", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("navigation", { name: "Breadcrumbs" }),
  ).toContainText("API");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "getReadiness",
  );
  await page.goBack();
  await expect(page).toHaveURL(/\/docs\/api$/);
  await page.goForward();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "getReadiness",
  );
  await sections(page)
    .getByRole("link", { name: "Data dictionary", exact: true })
    .click();
  await expect(page).toHaveURL(/\/docs\/database$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Data dictionary",
  );
});

test("the application shell presents the project identity and the development portal", async ({
  page,
}) => {
  // Teluni's entry sends a visitor to sign-in. The portal is a development
  // aid that only the development server mounts (owner direction).
  await page.goto(webUrl());
  await expect(page).toHaveURL(`${webUrl()}/sign-in`);
  await expect(page).toHaveTitle(projectName);
  await expect(page.locator(".brand")).toContainText(projectName);
  await expect(
    page.getByRole("heading", { level: 1, name: `Sign in to ${projectName}` }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Documentation", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    overviewTitle,
  );
  await expect(page).toHaveTitle(`${overviewTitle} · ${projectName}`);
  // The portal returns to this repository's application, not to a module.
  await page.getByRole("link", { name: "Application ↗" }).click();
  await expect(page).toHaveURL(
    (url) =>
      url.origin === new URL(webUrl()).origin &&
      url.pathname === "/sign-in" &&
      !url.search,
  );
});

test("repository documentation reads locally with heading links and unknown-page recovery", async ({
  page,
}) => {
  await openDocument(page, "/docs/repository/docs/setup", "Development Setup");
  const toc = page.getByRole("navigation", { name: "On this page" });
  await toc
    .getByRole("link", { name: "Prepare a clean checkout", exact: true })
    .click();
  await expect(page).toHaveURL(/#prepare-a-clean-checkout$/);
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "Prepare a clean checkout",
      exact: true,
    }),
  ).toBeVisible();
  const validationLink = page
    .locator('a[href="/docs/repository/docs/validation"]')
    .first();
  await expect(validationLink).toBeVisible();
  await validationLink.click();
  await expect(page).toHaveURL(/\/docs\/repository\/docs\/validation$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  await page.goto(`${webUrl()}/docs/repository/docs/not-a-real-document`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    /not found/i,
  );
  await sections(page)
    .getByRole("link", { name: "Overview", exact: true })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    overviewTitle,
  );
  // Every Orion-based repository routes newcomers to the derivation guide.
  await page.getByRole("link", { name: "Start or upgrade from Orion" }).click();
  await expect(page).toHaveURL(/\/docs\/repository\/docs\/project-derivation$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Start and Upgrade a Project from Orion",
  );
});

test("full-text search finds authored policy and generated operation, column, and component content", async ({
  page,
}) => {
  await openDocument(page, "/docs", overviewTitle);
  for (const [query, path] of [
    [
      "destructive integration suites",
      "/docs/repository/docs/architecture/testing-strategy",
    ],
    ["getReadiness", "/docs/api/getReadiness"],
    ["onReload", "/docs/components/ErrorNotice"],
  ]) {
    await page
      .getByRole("searchbox", { name: "Search documentation" })
      .fill(query);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page).toHaveURL(/\/docs\/search\?/);
    await expect(page.locator(`a[href^="${path}"]`).first()).toBeVisible();
  }
  await page.reload();
  await expect(
    page.getByRole("searchbox", { name: "Search documentation" }),
  ).toHaveValue("onReload");
  await expect(
    page.locator('a[href="/docs/components/ErrorNotice"]').first(),
  ).toBeVisible();
  await page
    .getByRole("searchbox", { name: "Search documentation" })
    .fill("no-documentation-matches-this-synthetic-query");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByText(/no results|no matching/i)).toBeVisible();
});

test("canonical artifacts are available locally from relevant sections", async ({
  page,
}) => {
  for (const [path, title, label, expected] of [
    ["/docs/api", "API reference", "OpenAPI 3.1 JSON", '"openapi": "3.1.'],
    [
      "/docs/database",
      "Data dictionary",
      "AI-readable database reference",
      "# Database Reference",
    ],
    [
      "/docs/components",
      "Components",
      "AI-readable component reference",
      "## ErrorNotice",
    ],
  ]) {
    await openDocument(page, path, title);
    const href = await page
      .getByRole("link", { name: label })
      .first()
      .getAttribute("href");
    expect(href).toBeTruthy();
    const url = new URL(href!, webUrl());
    expect(url.origin).toBe(webUrl());
    const response = await page.request.get(url.toString());
    expect(response.ok()).toBe(true);
    expect(await response.text()).toContain(expected);
  }
});

test("a transient portal chunk failure recovers without storing user data", async ({
  page,
}) => {
  // A load spike can make the lazy portal chunk fail once, as in a post-merge
  // CI run. The router reloads once and leaves only its non-sensitive marker.
  let failed = 0;
  await page.route(
    /\/(src\/documentation\.tsx|assets\/documentation-[^/]+\.js)(\?|$)/,
    async (route) => {
      if (failed++ === 0) return route.abort("connectionreset");
      return route.continue();
    },
  );
  await openDocument(page, "/docs/components/ErrorNotice", "ErrorNotice");
  expect(failed).toBeGreaterThan(1);
  const keys = await page.evaluate(() => Object.keys(sessionStorage));
  expect(keys).toHaveLength(1);
  expect(isRouterReloadMarker(keys[0], new URL(page.url()).origin)).toBe(true);
  await expectNoStoredUserData(page);
});

test("the storage check rejects anything but the router reload marker", async ({
  page,
}) => {
  await openDocument(page, "/docs/components/ErrorNotice", "ErrorNotice");
  const origin = new URL(page.url()).origin;
  const prefix =
    "tanstack_router_reload:Failed to fetch dynamically imported module: ";
  const marker = `${prefix}${origin}/src/documentation.tsx`;
  const token = "eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.sig";
  for (const [storage, key, value] of [
    ["session", "draft", "user input"],
    ["local", "anything", "1"],
    ["session", marker, token],
    ["session", "tanstack_router_reload:other", "1"],
    // A valid prefix followed by arbitrary data or a token is not a marker.
    ["session", `${prefix}user typed this`, "1"],
    ["session", `${prefix}${token}`, "1"],
    ["session", `${marker} user typed this`, "1"],
    ["session", `${marker}?draft=user-input`, "1"],
    ["session", `${marker}#${token}`, "1"],
    ["session", `${prefix}https://attacker.example/src/documentation.tsx`, "1"],
    ["session", `${prefix}${origin}/src/other.tsx`, "1"],
    ["session", `${prefix}${origin}/assets/documentation-a.js/${token}`, "1"],
    [
      "session",
      "tanstack_router_reload:Importing a module script failed. user input",
      "1",
    ],
    ["session", "tanstack_router_reload:Importing a module script failed", "1"],
  ] as const) {
    await page.evaluate(
      ([kind, k, v]) =>
        (kind === "local" ? localStorage : sessionStorage).setItem(k, v),
      [storage, key, value] as const,
    );
    await expect(expectNoStoredUserData(page)).rejects.toThrow();
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  }
  // The real error forms for the portal chunk remain accepted.
  for (const accepted of [
    marker,
    `${marker}?t=1759312345678`,
    `${prefix}${origin}/assets/documentation-C0bf_PFV.js`,
    `tanstack_router_reload:error loading dynamically imported module: ${origin}/src/documentation.tsx`,
    "tanstack_router_reload:Importing a module script failed.",
  ]) {
    await page.evaluate((k) => sessionStorage.setItem(k, "1"), accepted);
    await expectNoStoredUserData(page);
    await page.evaluate(() => sessionStorage.clear());
  }
});

test("mobile navigation and real component previews stay local", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const sent: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/"))
      sent.push(request.url());
  });
  await openDocument(page, "/docs/components/ErrorNotice", "ErrorNotice");
  await expect(page.locator(".docs-foundation-version")).toBeVisible();
  await page.getByRole("button", { name: "Browse documentation" }).click();
  await expect(
    sections(page).getByRole("link", { name: "Components", exact: true }),
  ).toBeVisible();
  await sections(page)
    .getByRole("link", { name: "Components", exact: true })
    .click();
  await page.locator('a[href="/docs/components/ErrorNotice"]').first().click();
  const preview = page.locator(".docs-preview").first();
  await preview.getByRole("button", { name: "Reload", exact: true }).click();
  await expect(preview.getByRole("status")).toContainText(
    "Demonstration reload selected",
  );
  await expectNoStoredUserData(page);
  expect(sent).toEqual([]);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await openDocument(page, "/docs/database", "Data dictionary");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});

test("API explorer waits for an explicit request and returns the real health response", async ({
  page,
}) => {
  const sent: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/"))
      sent.push(request.url());
  });
  await openDocument(page, "/docs/api/getReadiness", "getReadiness");
  const explorer = page.getByRole("region", { name: "Try this operation" });
  await expect(
    explorer.getByRole("button", { name: "Send request", exact: true }),
  ).toBeVisible();
  expect(sent).toEqual([]);
  await explorer
    .getByRole("button", { name: "Send request", exact: true })
    .click();
  await expect(explorer.getByText("HTTP 200", { exact: false })).toBeVisible();
  await expect(explorer.locator("pre").last()).toContainText('"status": "ok"');
  expect(sent).toHaveLength(1);
  expect(new URL(sent[0]).pathname).toBe("/api/health/ready");
});

test("API explorer cancellation discards late responses and response markup stays inert", async ({
  page,
}) => {
  let pending: Route | undefined;
  await page.route("**/api/health/ready", (route) => {
    pending = route;
  });
  await openDocument(page, "/docs/api/getReadiness", "getReadiness");
  const explorer = page.getByRole("region", { name: "Try this operation" });
  await explorer
    .getByRole("button", { name: "Send request", exact: true })
    .click();
  await expect.poll(() => Boolean(pending)).toBe(true);
  await explorer
    .getByRole("button", { name: "Cancel request", exact: true })
    .click();
  await expect(
    explorer.getByRole("button", { name: "Send request", exact: true }),
  ).toBeEnabled();
  if (pending) {
    await pending
      .fulfill({
        status: 200,
        contentType: "application/json",
        body: '{"status":"late synthetic response"}',
      })
      .catch(() => undefined);
  }
  await expect(
    explorer.getByRole("heading", { name: "Response", exact: true }),
  ).toHaveCount(0);
  await page.unroute("**/api/health/ready");
  await page.route("**/api/health/ready", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: '<img src="x" onerror="alert(1)">' }),
    }),
  );
  await explorer
    .getByRole("button", { name: "Send request", exact: true })
    .click();
  await expect(explorer.getByText("HTTP 200", { exact: false })).toBeVisible();
  await expect(explorer.locator("pre").last()).toContainText("<img");
  await expect(explorer.locator("img")).toHaveCount(0);
});

for (const [path, title] of [
  ["/docs", overviewTitle],
  ["/docs/api/getReadiness", "getReadiness"],
  ["/docs/database", "Data dictionary"],
  ["/docs/components/ErrorNotice", "ErrorNotice"],
  ["/docs/repository/docs/setup", "Development Setup"],
  [
    "/docs/repository/docs/project-derivation",
    "Start and Upgrade a Project from Orion",
  ],
]) {
  test(`documentation has no automated WCAG A/AA violations at ${path}`, async ({
    page,
  }) => {
    await openDocument(page, path, title);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  });
}
