import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import type { Media } from "../../src/media/api.js";
import { chooseTheme } from "./theme.ts";

test.use({ locale: "pt-BR", colorScheme: "light" });
const companyId = "00000000-0000-4000-8000-000000000001";
const folderId = "00000000-0000-4000-8000-0000000000f1";
const assetId = "00000000-0000-4000-8000-0000000000e1";
const name = "Campanha de divulgação ".repeat(5).trim();
const folderName = "Campanhas e comunicação ".repeat(4).trim();
const path = `/companies/${companyId}/media`;

// Synthetic presentation coverage complements the real identity/media journey.
async function arrange(page: Page) {
  const asset: Media = {
    id: assetId,
    name,
    tags: [],
    kind: "VIDEO",
    status: "PROCESSING",
    rejectionReason: null,
    branch: null,
    folderId: null,
    declaredContentType: "video/mp4",
    declaredSize: 6_000_000,
    width: null,
    height: null,
    durationMs: null,
    hasAudio: null,
    processing: { stage: "converting", progress: 40 },
    createdAt: "2026-11-15T12:00:00.000Z",
    readyAt: null,
    archivedAt: null,
    deletedAt: null,
    purgeAfter: null,
    version: 2,
  };
  const folder = {
    id: folderId,
    name: folderName,
    parentId: null,
    branch: null,
    version: 1,
    createdAt: asset.createdAt,
    updatedAt: asset.createdAt,
  };
  await page.route("**/api/**", async (route) => {
    const endpoint = new URL(route.request().url()).pathname.slice(4);
    if (endpoint === "/auth/session")
      await route.fulfill({
        json: {
          principalId: "synthetic",
          sessionId: "synthetic-session",
          state: "ACTIVE",
          expiresAt: "2099-11-15T12:00:00.000Z",
          assuranceLevel: "teluni-aal1",
          authenticatedAt: asset.createdAt,
          csrfToken: "synthetic-csrf",
        },
      });
    else if (endpoint === `/companies/${companyId}`)
      await route.fulfill({
        json: {
          company: { id: companyId, displayName: "Empresa sintética" },
          access: {
            roles: ["COMPANY_ADMINISTRATOR"],
            profiles: [],
            responsible: true,
            capabilities: [
              "company.view",
              "branches.view",
              "media.view",
              "media.upload",
              "media.archive",
              "media.delete",
            ],
          },
          responsibilityTransfer: null,
        },
      });
    else if (endpoint.endsWith("/branches"))
      await route.fulfill({ json: { items: [], nextCursor: null } });
    else if (endpoint.endsWith("/media-folders"))
      await route.fulfill({ json: { items: [folder], nextCursor: null } });
    else if (endpoint.endsWith(`/media-folders/${folderId}`))
      await route.fulfill({ json: { folder, ancestors: [] } });
    else if (endpoint.endsWith("/media"))
      await route.fulfill({ json: { items: [asset], nextCursor: null } });
    else if (endpoint.endsWith(`/media/${assetId}`))
      await route.fulfill({ json: asset });
    else
      await route.fulfill({
        status: 404,
        json: { error: { code: "RESOURCE_NOT_FOUND", message: "Not found" } },
      });
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
    test(`media manager, list and dialogs remain usable in ${theme} at ${width}px`, async ({
      page,
    }) => {
      await arrange(page);
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`${process.env.ORION_E2E_WEB_URL!}${path}`);
      await chooseTheme(page, theme);
      await expect(
        page.getByRole("button", { name, exact: true }),
      ).toBeVisible();
      await accessible(page);
      await page.screenshot({
        path: test.info().outputPath(`media-${theme}-${width}.png`),
        fullPage: true,
      });
      await page
        .getByRole("button", { name: "Nova pasta", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "Nova pasta",
        exact: true,
      });
      await expect(dialog.getByLabel("Nome da pasta")).toBeFocused();
      await dialog.getByLabel("Nome da pasta").fill(folderName);
      await accessible(page);
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("button", { name: "Nova pasta", exact: true }),
      ).toBeFocused();
      await page.getByRole("button", { name: "Modo lista" }).click();
      await expect(
        page.getByRole("grid", { name: "Mídia", exact: true }),
      ).toBeVisible();
      await accessible(page);
      await page
        .getByRole("button", { name: "Ações de " + name, exact: true })
        .click();
      await page
        .getByRole("menuitem", { name: "Renomear", exact: true })
        .click();
      await expect(
        page.getByRole("dialog", { name: "Renomear", exact: true }),
      ).toBeVisible();
      await accessible(page);
    });
  }
