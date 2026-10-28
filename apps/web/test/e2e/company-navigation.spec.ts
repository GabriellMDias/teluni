import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

test.use({ locale: "pt-BR", colorScheme: "light" });
const webUrl = () => process.env.ORION_E2E_WEB_URL!;
const companyA = "00000000-0000-4000-8000-000000000001";
const companyB = "00000000-0000-4000-8000-000000000002";
const administrator = [
  "company.view",
  "branches.view",
  "company.settings.manage",
  "members.manage",
  "invitations.manage",
  "audit.view",
  "devices.view",
  "media.view",
  "programming.view",
  "catalogs.view",
];
const operator = ["company.view", "branches.view", "devices.view"];
const navigation = (page: Page) =>
  page.getByRole("navigation", { name: "Navegação principal" });

// These journeys qualify presentation with SDK-shaped synthetic responses.
// Existing organization journeys own real provider, authorization and writes.
async function arrange(page: Page, capabilities = administrator) {
  const requests: string[] = [];
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (!pathname.startsWith("/api/")) return route.continue();
    const path = pathname.slice(4);
    requests.push(path);
    if (path === "/auth/session") {
      await route.fulfill({
        json: {
          principalId: "synthetic",
          sessionId: "synthetic-session",
          state: "ACTIVE",
          expiresAt: "2099-10-23T12:00:00.000Z",
          assuranceLevel: "teluni-aal1",
          authenticatedAt: "2026-10-23T08:00:00.000Z",
          csrfToken: "synthetic-csrf",
        },
      });
    } else if (path === "/companies") {
      await route.fulfill({
        json: {
          items: [
            {
              id: companyA,
              displayName: "Loja Aurora",
              roles: ["COMPANY_ADMINISTRATOR"],
            },
            {
              id: companyB,
              displayName: "Loja Horizonte",
              roles: ["OPERATOR"],
            },
          ],
          nextCursor: null,
        },
      });
    } else if (
      path === `/companies/${companyA}` ||
      path === `/companies/${companyB}`
    ) {
      const isA = path.endsWith(companyA);
      await route.fulfill({
        json: {
          company: {
            id: isA ? companyA : companyB,
            displayName: isA ? "Loja Aurora" : "Loja Horizonte",
            timeZone: "America/Sao_Paulo",
            defaultLocale: "pt-BR",
            status: "ACTIVE",
            version: 1,
            createdAt: "2026-10-23T08:00:00.000Z",
            updatedAt: "2026-10-23T08:00:00.000Z",
          },
          access: {
            roles: [isA ? "COMPANY_ADMINISTRATOR" : "OPERATOR"],
            profiles: [],
            responsible: isA,
            capabilities: isA ? capabilities : operator,
          },
          responsibilityTransfer: null,
        },
      });
    } else {
      await route.fulfill({ json: { items: [], nextCursor: null } });
    }
  });
  return requests;
}

test("keeps the company context and the active section across product modules in both themes", async ({
  page,
}) => {
  await arrange(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.name));
  await page.goto(`${webUrl()}/companies/${companyA}`);
  const group = navigation(page).getByRole("group", { name: "Loja Aurora" });
  await expect(
    group.getByRole("link", { name: "Filiais", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    navigation(page).getByRole("link", { name: "Empresas", exact: true }),
  ).not.toHaveAttribute("aria-current", "page");
  for (const theme of ["light", "dark"]) {
    await page
      .getByRole("combobox", { name: "Tema", exact: true })
      .selectOption(theme);
    for (const [label, path] of [
      ["Telas", "screens"],
      ["Mídia", "media"],
      ["Programação", "programming"],
      ["Catálogos", "catalogs"],
    ]) {
      const link = group.getByRole("link", { name: label, exact: true });
      await link.click();
      await expect(page).toHaveURL(`${webUrl()}/companies/${companyA}/${path}`);
      await expect(
        page.getByRole("main").getByRole("heading", { level: 1 }),
      ).toBeVisible();
      await expect(link).toHaveAttribute("aria-current", "page");
      await expect(group.locator('[aria-current="page"]')).toHaveText([label]);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    }
    await page.screenshot({
      path: test.info().outputPath(`company-navigation-${theme}.png`),
      fullPage: true,
    });
  }
  await page.reload();
  await expect(
    group.getByRole("link", { name: "Catálogos", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  expect(errors).toEqual([]);
});

test("distinguishes company views, clears cursors and restores selection through browser history", async ({
  page,
}) => {
  await arrange(page);
  await page.goto(
    `${webUrl()}/companies/${companyA}?view=history&cursor=synthetic`,
  );
  const group = navigation(page).getByRole("group", { name: "Loja Aurora" });
  await expect(
    group.getByRole("link", { name: "Histórico de alterações" }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    group.getByRole("link", { name: "Filiais", exact: true }),
  ).not.toHaveAttribute("aria-current", "page");
  await group.getByRole("link", { name: "Configurações da empresa" }).click();
  await expect(page).toHaveURL(
    `${webUrl()}/companies/${companyA}?view=settings`,
  );
  await expect(group.locator('[aria-current="page"]')).toHaveText([
    "Configurações da empresa",
  ]);
  await group.getByRole("link", { name: "Filiais", exact: true }).click();
  await expect(page).toHaveURL(`${webUrl()}/companies/${companyA}`);
  await expect(
    group.getByRole("link", { name: "Filiais", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await page.goBack();
  await expect(
    group.getByRole("link", { name: "Configurações da empresa" }),
  ).toHaveAttribute("aria-current", "page");
  await expect(group.locator('[aria-current="page"]')).toHaveText([
    "Configurações da empresa",
  ]);
});

test("uses current capabilities rather than role names", async ({ page }) => {
  const requests = await arrange(page, operator);
  await page.goto(`${webUrl()}/companies/${companyA}?view=settings`);
  const group = navigation(page).getByRole("group", { name: "Loja Aurora" });
  await expect(
    group.getByRole("link", { name: "Telas", exact: true }),
  ).toBeVisible();
  for (const name of [
    "Membros",
    "Histórico de alterações",
    "Mídia",
    "Configurações da empresa",
  ])
    await expect(group.getByRole("link", { name, exact: true })).toHaveCount(0);
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Você não tem permissão",
  );
  expect(
    requests.filter((path) => /\/(members|audit-events|media)$/.test(path)),
  ).toEqual([]);
});

test("switches companies without showing the previous company's links while access loads", async ({
  page,
}) => {
  await arrange(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/companies/${companyB}`, async (route) => {
    await pending;
    await route.fallback();
  });
  try {
    await page.goto(`${webUrl()}/companies/${companyA}`);
    await navigation(page)
      .getByRole("link", { name: "Trocar empresa", exact: true })
      .click();
    await expect(page).toHaveURL(`${webUrl()}/companies`);
    await expect(page.locator(".company-navigation")).toHaveCount(0);
    await page
      .getByRole("link", { name: "Loja Horizonte", exact: true })
      .click();
    await expect(page).toHaveURL(`${webUrl()}/companies/${companyB}`);
    await expect(page.locator(".company-navigation")).toHaveCount(0);
    await expect(
      navigation(page).locator(`a[href*="${companyA}"]`),
    ).toHaveCount(0);
    release();
    const group = navigation(page).getByRole("group", {
      name: "Loja Horizonte",
    });
    await expect(group).toBeVisible();
    await expect(
      group.getByRole("link", { name: "Membros", exact: true }),
    ).toHaveCount(0);
    await expect(
      group.getByRole("link", { name: "Telas", exact: true }),
    ).toHaveAttribute("href", `/companies/${companyB}/screens`);
    await navigation(page)
      .getByRole("link", { name: "Sessões", exact: true })
      .click();
    await expect(page.locator(".company-navigation")).toHaveCount(0);
  } finally {
    release();
  }
});

test("mobile company navigation keeps scope, focus and contrast in both themes", async ({
  page,
}) => {
  await arrange(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${webUrl()}/companies/${companyA}`);
  const menu = page.getByRole("button", { name: "Menu", exact: true });
  for (const theme of ["light", "dark"]) {
    await page
      .getByRole("combobox", { name: "Tema", exact: true })
      .selectOption(theme);
    await menu.click();
    const group = navigation(page).getByRole("group", { name: "Loja Aurora" });
    await expect(group).toBeVisible();
    await page.setViewportSize({ width: 320, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: test.info().outputPath(`company-navigation-mobile-${theme}.png`),
      fullPage: true,
    });
    await group.getByRole("link", { name: "Configurações da empresa" }).click();
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("main")).toBeFocused();
    await expect(page).toHaveURL(
      `${webUrl()}/companies/${companyA}?view=settings`,
    );
    await page.setViewportSize({ width: 390, height: 844 });
  }
});

test("does not infer company context from documentation URLs or query parameters", async ({
  page,
}) => {
  const requests = await arrange(page);
  await page.goto(`${webUrl()}/docs?companyId=${companyA}`);
  await expect(page.locator(".docs-workspace")).toBeVisible();
  await expect(page.locator(".company-navigation")).toHaveCount(0);
  expect(requests).toEqual([]);
});
