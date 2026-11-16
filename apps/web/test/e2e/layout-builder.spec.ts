import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { programmingMessages } from "../../src/programming/messages.js";
import type { Layout } from "../../src/programming/api.js";
import { chooseTheme } from "./theme.ts";

test.use({ locale: "pt-BR", colorScheme: "light" });
const t = programmingMessages["pt-BR"];
const l = t.layouts;
const companyId = "00000000-0000-4000-8000-000000000001";
const layoutId = "00000000-0000-4000-8000-000000000002";
const timestamp = "2026-11-15T12:00:00.000Z";
const layout: Layout = {
  id: layoutId,
  name: "Vitrine",
  branch: null,
  orientation: "landscape",
  canvas: { width: 1920, height: 1080 },
  audioMixConfirmed: false,
  areas: [
    {
      key: "main",
      name: "Principal",
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      z: 0,
      background: "#000000",
      fit: "contain",
      muted: true,
      volume: 100,
      kind: "media",
      pageControlled: false,
      view: null,
    },
  ],
  pages: [],
  fit: [],
  version: 1,
  createdAt: timestamp,
  updatedAt: timestamp,
};
async function arrange(page: Page) {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname.slice(4);
    let json: unknown;
    if (path === "/auth/session")
      json = {
        principalId: "synthetic",
        state: "ACTIVE",
        sessionId: "synthetic-session",
        csrfToken: "synthetic-csrf",
        expiresAt: "2099-11-15T12:00:00.000Z",
        assuranceLevel: "teluni-aal1",
        authenticatedAt: timestamp,
      };
    else if (path === `/companies/${companyId}`)
      json = {
        company: { id: companyId, displayName: "Empresa sintética" },
        access: {
          roles: ["COMPANY_ADMINISTRATOR"],
          profiles: [],
          responsible: true,
          capabilities: [
            "company.view",
            "programming.view",
            "programming.edit",
            "catalogs.view",
          ],
        },
        responsibilityTransfer: null,
      };
    else if (path.endsWith(`/layouts/${layoutId}`)) json = layout;
    else if (path.endsWith("/catalogs") || path.endsWith("/branches"))
      json = { items: [], nextCursor: null };
    else {
      await route.fulfill({
        status: 404,
        json: { error: { code: "RESOURCE_NOT_FOUND" } },
      });
      return;
    }
    await route.fulfill({ json });
  });
}
async function accessible(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
}
for (const theme of ["light", "dark"] as const)
  for (const width of [1440, 320]) {
    test(`layout composition in ${theme} at ${width}px`, async ({ page }) => {
      await arrange(page);
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(
        `${process.env.ORION_E2E_WEB_URL}/companies/${companyId}/programming/layouts/${layoutId}`,
      );
      await chooseTheme(page, theme);
      await expect(
        page.getByRole("heading", { name: l.builderTitle, exact: true }),
      ).toBeVisible();
      await accessible(page);
      await page
        .getByRole("button", { name: l.splitDirections.right, exact: true })
        .click();
      await expect(page.getByLabel(l.width, { exact: true })).toHaveValue(
        "960",
      );
      await page
        .getByRole("button", { name: l.splitDirections.below, exact: true })
        .click();
      await expect(page.getByLabel(l.height, { exact: true })).toHaveValue(
        "540",
      );
      await page.getByRole("button", { name: l.undo, exact: true }).click();
      await expect(
        page.getByRole("button", {
          name: l.selectArea(l.newAreaName(3)),
          exact: true,
        }),
      ).toHaveCount(0);
      await page.getByRole("button", { name: l.redo, exact: true }).click();
      await page
        .getByRole("button", {
          name: l.selectArea(l.newAreaName(3)),
          exact: true,
        })
        .click();
      await page.getByLabel(l.width, { exact: true }).fill("640");
      await accessible(page);
      await page.screenshot({
        path: test.info().outputPath(`layout-${theme}-${width}.png`),
        fullPage: true,
      });
      await page
        .getByRole("button", { name: l.addCatalogArea, exact: true })
        .click();
      await expect(page.getByLabel(l.areaKind, { exact: true })).toHaveValue(
        "catalog",
      );
      await page.getByText(l.identifierTitle, { exact: true }).click();
      await expect(page.getByLabel(l.areaKey, { exact: true })).toBeEditable();
      await accessible(page);
    });
  }

test("drags components onto the canvas, resizes from an anchored edge and undoes the whole gesture", async ({
  page,
}) => {
  await arrange(page);
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.goto(
    `${process.env.ORION_E2E_WEB_URL}/companies/${companyId}/programming/layouts/${layoutId}`,
  );
  const canvas = page.getByRole("group", {
    name: l.canvasLabel("Vitrine"),
    exact: true,
  });
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  await page
    .getByRole("button", { name: l.addMediaArea, exact: true })
    .dragTo(canvas, {
      targetPosition: { x: box.width * 0.6, y: box.height * 0.6 },
    });
  await expect(page.getByLabel(l.areaName, { exact: true })).toHaveValue(
    l.newAreaName(2),
  );
  const oldX = Number(await page.getByLabel(l.x, { exact: true }).inputValue());
  const oldWidth = Number(
    await page.getByLabel(l.width, { exact: true }).inputValue(),
  );
  const handle = page.locator('.layout-area.selected [data-resize="w"]');
  const rect = (await handle.boundingBox())!;
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x - box.width / 10, rect.y + rect.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  await expect
    .poll(async () =>
      Number(await page.getByLabel(l.width, { exact: true }).inputValue()),
    )
    .toBeGreaterThan(oldWidth);
  const nextX = Number(
    await page.getByLabel(l.x, { exact: true }).inputValue(),
  );
  const nextWidth = Number(
    await page.getByLabel(l.width, { exact: true }).inputValue(),
  );
  expect(nextX + nextWidth).toBe(oldX + oldWidth);
  await page.getByRole("button", { name: l.undo, exact: true }).click();
  await expect(page.getByLabel(l.x, { exact: true })).toHaveValue(String(oldX));
  await expect(page.getByLabel(l.width, { exact: true })).toHaveValue(
    String(oldWidth),
  );
  await page.getByRole("button", { name: l.undo, exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: l.selectArea(l.newAreaName(2)),
      exact: true,
    }),
  ).toHaveCount(0);
});
