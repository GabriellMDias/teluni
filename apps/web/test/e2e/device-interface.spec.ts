import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import type { Device, ScreenState } from "../../src/devices/api.js";
import { chooseTheme } from "./theme.ts";

test.use({ locale: "pt-BR", colorScheme: "light" });
const companyId = "00000000-0000-4000-8000-000000000001";
const branchId = "00000000-0000-4000-8000-0000000000b1";
const deviceId = "00000000-0000-4000-8000-0000000000d1";
const name = "Vitrine".repeat(11);
const branchName = "Centro".repeat(12);
const path = `/companies/${companyId}/screens`;
const webUrl = () => process.env.ORION_E2E_WEB_URL!;

// Presentation uses synthetic wire responses. The devices/screens journey
// separately qualifies the real identity, pairing, check-in and erasure flow.
async function arrange(page: Page) {
  let screen: Device = {
    id: deviceId,
    name,
    branch: { id: branchId, name: branchName, timeZone: "America/Sao_Paulo" },
    timeZone: null,
    rotation: 0,
    status: "ACTIVE",
    erasure: "NONE",
    version: 1,
    pairedAt: "2026-10-24T12:00:00.000Z",
    revokedAt: null,
    erasureRecordedAt: null,
    lastSeenAt: null,
    report: {
      appVersion: "0.0.0-synthetic",
      protocolVersion: 1,
      manufacturer: "Synthetic",
      model: "Player".repeat(12),
      osVersion: "14",
      display: { width: 1920, height: 1080 },
      rotations: [0, 90],
    },
  };
  const sync: ScreenState = {
    deviceId,
    connection: "never",
    lastContactAt: null,
    source: "individual",
    desired: null,
    publication: "unknown",
    reported: null,
  };
  const writes: string[] = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const endpoint = new URL(request.url()).pathname.slice(4);
    if (request.method() !== "GET")
      writes.push(`${request.method()} ${endpoint}`);
    if (endpoint === "/auth/session") {
      await route.fulfill({
        json: {
          principalId: "synthetic",
          sessionId: "synthetic-session",
          state: "ACTIVE",
          expiresAt: "2099-10-24T12:00:00.000Z",
          assuranceLevel: "teluni-aal1",
          authenticatedAt: "2026-10-24T12:00:00.000Z",
          csrfToken: "synthetic-csrf",
        },
      });
    } else if (endpoint === `/companies/${companyId}`) {
      await route.fulfill({
        json: {
          company: { id: companyId, displayName: "Loja Aurora" },
          access: {
            roles: ["COMPANY_ADMINISTRATOR"],
            profiles: [],
            responsible: true,
            capabilities: [
              "company.view",
              "branches.view",
              "devices.view",
              "devices.manage",
            ],
          },
          responsibilityTransfer: null,
        },
      });
    } else if (endpoint === `/companies/${companyId}/branches`) {
      await route.fulfill({
        json: {
          items: [
            {
              id: branchId,
              name: branchName,
              timeZone: "America/Sao_Paulo",
              status: "ACTIVE",
              version: 1,
            },
            {
              id: "00000000-0000-4000-8000-0000000000b2",
              name: "Bairro",
              timeZone: "UTC",
              status: "ACTIVE",
              version: 1,
            },
          ],
          nextCursor: null,
        },
      });
    } else if (endpoint.endsWith("/publications/screen-states")) {
      await route.fulfill({ json: { items: [sync] } });
    } else if (endpoint.endsWith("/sync-state")) {
      await route.fulfill({ json: sync });
    } else if (
      endpoint === `/companies/${companyId}/devices` &&
      request.method() === "POST"
    ) {
      await route.fulfill({
        status: 409,
        json: { error: { code: "PAIRING_CODE_INVALID", message: "Invalid" } },
      });
    } else if (endpoint === `/companies/${companyId}/devices`) {
      await route.fulfill({ json: { items: [screen], nextCursor: null } });
    } else if (endpoint.endsWith(`/${deviceId}/unlink`)) {
      screen = {
        ...screen,
        status: "REVOKED",
        erasure: "PENDING",
        version: 2,
        revokedAt: "2026-10-24T12:00:00.000Z",
      };
      await route.fulfill({ json: screen });
    } else if (endpoint.endsWith(`/${deviceId}/reset-record`)) {
      screen = {
        ...screen,
        erasure: "RESET_RECORDED",
        version: 3,
        erasureRecordedAt: "2026-10-24T12:00:00.000Z",
      };
      await route.fulfill({ json: screen });
    } else if (endpoint.endsWith(`/${deviceId}`)) {
      await route.fulfill({ json: screen });
    } else {
      await route.fulfill({
        status: 404,
        json: { error: { code: "RESOURCE_NOT_FOUND", message: "Not found" } },
      });
    }
  });
  return writes;
}

async function accessibleLayout(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
}

for (const theme of ["light", "dark"] as const) {
  for (const width of [1440, 320]) {
    test(`screen pairing, details and unlink confirmation remain usable in ${theme} at ${width}px`, async ({
      page,
    }) => {
      const writes = await arrange(page);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${webUrl()}${path}`);
      await chooseTheme(page, theme);
      const pair = page.getByRole("form", { name: "Parear uma tela" });
      await expect(pair).toBeVisible();
      await expect(
        page.locator(".devices-list").getByRole("link", { name, exact: true }),
      ).toBeVisible();
      await pair.getByLabel("Código da TV").fill("bcdf-ghjk");
      await expect(pair.getByLabel("Código da TV")).toHaveValue("BCDF-GHJK");
      await pair.getByLabel("Código da TV").press("Tab");
      await expect(pair.getByLabel("Nome da tela")).toBeFocused();
      await pair.getByLabel("Nome da tela").fill("Vitrine");
      await pair
        .getByRole("button", { name: "Parear tela", exact: true })
        .click();
      await expect(pair.getByRole("alert")).toContainText(
        "Código inválido ou expirado",
      );
      await accessibleLayout(page);
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({
        path: test.info().outputPath(`screens-${theme}-${width}.png`),
        fullPage: true,
      });
      await page
        .locator(".devices-list")
        .getByRole("link", { name, exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name, exact: true }),
      ).toBeVisible();
      await expect(page.getByTestId("screen-sync")).toContainText(
        "Ainda não sincronizou",
      );
      const configuration = page.getByRole("form", {
        name: "Configurar",
        exact: true,
      });
      await expect(
        configuration.getByLabel("Fuso horário"),
      ).toHaveAccessibleDescription(/Deixe em branco/);
      await expect(
        configuration.getByRole("button", { name: "Salvar", exact: true }),
      ).toBeDisabled();
      const unlink = page.getByRole("form", {
        name: "Desvincular",
        exact: true,
      });
      const confirmation = unlink.getByRole("checkbox");
      const unlinkAction = unlink.getByRole("button", {
        name: "Desvincular tela",
        exact: true,
      });
      await expect(unlinkAction).toBeDisabled();
      expect(
        await confirmation.evaluate(
          (element) => element.getBoundingClientRect().width,
        ),
      ).toBeLessThan(24);
      await confirmation.focus();
      await confirmation.press("Space");
      await expect(unlinkAction).toBeEnabled();
      await accessibleLayout(page);
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({
        path: test.info().outputPath(`screen-detail-${theme}-${width}.png`),
        fullPage: true,
      });
      await unlinkAction.click();
      await expect(
        page.getByText(
          "Tela desvinculada. A limpeza fica pendente até a tela confirmar.",
        ),
      ).toBeVisible();
      await expect(configuration).toHaveCount(0);
      await expect(unlink).toHaveCount(0);
      await accessibleLayout(page);
      await page
        .getByRole("button", { name: "Registrar redefinição", exact: true })
        .click();
      await expect(
        page.getByText("Redefinição registrada.", { exact: true }),
      ).toBeVisible();
      expect(writes).toEqual([
        `POST /companies/${companyId}/devices`,
        `POST /companies/${companyId}/devices/${deviceId}/unlink`,
        `POST /companies/${companyId}/devices/${deviceId}/reset-record`,
      ]);
    });
  }
}
