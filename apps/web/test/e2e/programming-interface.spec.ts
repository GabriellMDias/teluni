import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { programmingMessages } from "../../src/programming/messages.js";
import { chooseTheme } from "./theme.ts";

test.use({ locale: "pt-BR", colorScheme: "light" });
const t = programmingMessages["pt-BR"];
const companyId = "00000000-0000-4000-8000-000000000001";
const branchId = "00000000-0000-4000-8000-0000000000b1";
const playlistId = "00000000-0000-4000-8000-0000000000c1";
const groupId = "00000000-0000-4000-8000-0000000000f1";
const assetId = "00000000-0000-4000-8000-0000000000e1";
const deviceId = "00000000-0000-4000-8000-0000000000d1";
const base = `/companies/${companyId}/programming`;
const name = "Campanha institucional e boas-vindas ".repeat(3).trim();
const timestamp = "2026-11-15T12:00:00.000Z";
const branch = { id: branchId, name: "Centro", timeZone: "America/Sao_Paulo" };
const playlist = {
  id: playlistId,
  name,
  branch: null,
  transition: "CUT",
  fadeMs: null,
  items: [
    {
      mediaAssetId: assetId,
      name,
      kind: "IMAGE",
      mediaStatus: "READY",
      durationMs: 10000,
    },
  ],
  durationMs: 10000,
  videoCount: 0,
  version: 1,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const group = {
  id: groupId,
  name,
  allBranches: false,
  branches: [branch],
  members: [],
  version: 1,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const output = { key: "screen", kind: "screen", name: null };

async function arrange(page: Page) {
  await page.route("**/api/**", async (route) => {
    const endpoint = new URL(route.request().url()).pathname.slice(4);
    let json: unknown;
    if (endpoint === "/auth/session")
      json = {
        principalId: "synthetic",
        sessionId: "synthetic-session",
        state: "ACTIVE",
        expiresAt: "2099-11-15T12:00:00.000Z",
        assuranceLevel: "teluni-aal1",
        authenticatedAt: timestamp,
        csrfToken: "synthetic-csrf",
      };
    else if (endpoint === `/companies/${companyId}`)
      json = {
        company: { id: companyId, displayName: "Empresa sintética" },
        access: {
          roles: ["COMPANY_ADMINISTRATOR"],
          profiles: [],
          responsible: true,
          capabilities: [
            "company.view",
            "branches.view",
            "devices.view",
            "programming.view",
            "programming.edit",
            "programming.assign",
            "publications.publish",
          ],
        },
        responsibilityTransfer: null,
      };
    else if (endpoint.endsWith("/branches"))
      json = {
        items: [{ ...branch, status: "ACTIVE", version: 1 }],
        nextCursor: null,
      };
    else if (endpoint.endsWith("/programming/playlists"))
      json = { items: [playlist], nextCursor: null };
    else if (endpoint.endsWith(`/playlists/${playlistId}`)) json = playlist;
    else if (endpoint.endsWith("/programming/groups"))
      json = { items: [group] };
    else if (endpoint.endsWith(`/groups/${groupId}`)) json = group;
    else if (endpoint.endsWith(`/devices/${deviceId}`))
      json = {
        device: { id: deviceId, name, branch, timeZone: null },
        source: "individual",
        group: null,
        version: 1,
      };
    else if (endpoint.endsWith("/program"))
      json = {
        version: 0,
        layout: null,
        outputs: [
          {
            ...output,
            defaultPlaylistId: null,
            defaultPlaylist: null,
            rules: [],
          },
        ],
      };
    else if (endpoint.endsWith("/timeline"))
      json = {
        source: { kind: "individual" },
        output,
        outputs: [output],
        timeZone: branch.timeZone,
        segments: [
          {
            start: timestamp,
            end: "2026-11-16T12:00:00.000Z",
            localStart: "2026-11-15T09:00",
            localEnd: "2026-11-16T09:00",
            source: "none",
            ruleId: null,
            playlist: null,
          },
        ],
        notes: [],
      };
    else if (endpoint.endsWith("/media"))
      json = { items: [], nextCursor: null };
    else if (endpoint.endsWith("/layouts"))
      json = { items: [], nextCursor: null };
    else if (endpoint.endsWith("/publications"))
      json = { items: [], nextCursor: null };
    else if (endpoint.endsWith("/member-states")) json = { items: [] };
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
for (const theme of ["light", "dark"] as const) {
  for (const width of [1440, 320]) {
    test(`programming tasks remain readable and accessible in ${theme} at ${width}px`, async ({
      page,
    }) => {
      await arrange(page);
      await page.setViewportSize({ width, height: 1000 });
      const origin = process.env.ORION_E2E_WEB_URL!;
      await page.goto(`${origin}${base}`);
      await chooseTheme(page, theme);
      await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
      await accessible(page);
      await page
        .locator("summary")
        .filter({ hasText: t.createPlaylistTitle })
        .click();
      await expect(
        page.getByRole("form", { name: t.createPlaylistTitle }),
      ).toBeVisible();
      await accessible(page);
      await page.getByRole("link", { name, exact: true }).click();
      await page.getByLabel(t.itemSeconds(name)).fill("25");
      await accessible(page);
      await page
        .getByRole("link", { name: t.workspace.settingsTab, exact: true })
        .click();
      await accessible(page);
      await page
        .getByRole("link", { name: t.workspace.contentTab, exact: true })
        .click();
      await expect(page.getByLabel(t.itemSeconds(name))).toHaveValue("25");
      await page.goto(`${origin}${base}/groups/${groupId}`);
      await page.getByLabel(t.defaultPlaylist).selectOption(playlistId);
      await page.getByRole("button", { name: t.addRule, exact: true }).click();
      await page
        .getByRole("button", { name: t.workspace.weekend, exact: true })
        .click();
      await accessible(page);
      await page.screenshot({
        path: test.info().outputPath(`programming-${theme}-${width}.png`),
        fullPage: true,
      });
      await page
        .getByRole("link", { name: t.workspace.previewTab, exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: t.timelineTitle, exact: true }),
      ).toBeVisible();
      await accessible(page);
      await page
        .getByRole("link", { name: t.workspace.publishTab, exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: t.publication.review }),
      ).toBeVisible();
      await accessible(page);
      await page.goto(`${origin}${base}/screens/${deviceId}?section=settings`);
      await expect(
        page.getByLabel(t.groupLabel, { exact: true }),
      ).toBeVisible();
      await accessible(page);
    });
  }
}
