import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

test.use({ locale: "pt-BR", colorScheme: "light" });
const webUrl = () => process.env.ORION_E2E_WEB_URL!;
const companyId = "00000000-0000-4000-8000-000000000001";

// Appearance tests isolate presentation from the provider. The identity and
// organization suites exercise the real session, authorization and writes.
async function signedInHome(page: Page) {
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: {
        principalId: "synthetic",
        sessionId: "synthetic-session",
        state: "ACTIVE",
        expiresAt: "2099-10-23T12:00:00.000Z",
        assuranceLevel: "teluni-aal1",
        authenticatedAt: "2026-10-23T08:00:00.000Z",
        strongAuthenticatedAt: null,
        csrfToken: "synthetic-csrf",
      },
    }),
  );
  await page.route("**/api/companies", (route) =>
    route.fulfill({
      json: {
        items: [
          { id: companyId, displayName: "Loja Aurora", roles: ["OPERATOR"] },
        ],
        nextCursor: null,
      },
    }),
  );
  await page.goto(webUrl());
  await expect(
    page.getByRole("heading", { name: "Boas-vindas ao Teluni" }),
  ).toBeVisible();
}

test("applies accessible light/dark surfaces and preserves the selected theme across routes and reloads", async ({
  page,
}) => {
  await signedInHome(page);
  const shell = page.locator(".product-shell");
  const theme = page.getByRole("combobox", { name: "Tema", exact: true });
  await expect(shell).toHaveAttribute("data-theme", "light");
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
  for (const value of ["light", "dark"]) {
    await theme.selectOption(value);
    await expect(shell).toHaveAttribute("data-theme", value);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  }
  const darkSurface = await shell.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  await page
    .getByRole("navigation", { name: "Navegação principal" })
    .getByRole("link", { name: "Empresas", exact: true })
    .click();
  await expect(page).toHaveURL(`${webUrl()}/companies`);
  await expect(
    page.getByRole("toolbar", { name: "Ações do registro" }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.reload();
  await expect(theme).toHaveValue("dark");
  expect(
    await shell.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    ),
  ).toBe(darkSurface);
  expect(await page.evaluate(() => Object.entries(localStorage))).toEqual([
    ["teluni.theme", "dark"],
  ]);
  await theme.selectOption("system");
  await expect(shell).toHaveAttribute("data-theme", "light");
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
});

test("follows live system changes and synchronizes an explicit preference across tabs", async ({
  page,
  context,
}) => {
  await signedInHome(page);
  const shell = page.locator(".product-shell");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(shell).toHaveAttribute("data-theme", "dark");
  const second = await context.newPage();
  await second.goto(`${webUrl()}/sign-in`);
  await second
    .getByRole("combobox", { name: "Tema", exact: true })
    .selectOption("light");
  await expect(shell).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "light" });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(shell).toHaveAttribute("data-theme", "light");
  await second
    .getByRole("combobox", { name: "Tema", exact: true })
    .selectOption("system");
  await expect(shell).toHaveAttribute("data-theme", "dark");
  await second.close();
});

test("ignores invalid stored themes and keeps the control usable when storage is denied", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("teluni.theme", "invalid"),
  );
  await page.goto(`${webUrl()}/sign-in`);
  await expect(
    page.getByRole("combobox", { name: "Tema", exact: true }),
  ).toHaveValue("system");
  await page.evaluate(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("Storage denied", "SecurityError");
      },
    });
  });
  await page
    .getByRole("combobox", { name: "Tema", exact: true })
    .selectOption("dark");
  await expect(page.locator(".product-shell")).toHaveAttribute(
    "data-theme",
    "dark",
  );
  await page.goto(`${webUrl()}/docs`);
  await expect(page.locator(".docs-workspace")).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Tema", exact: true }),
  ).toHaveCount(0);

  const blocked = await page.context().newPage();
  await blocked.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("Storage denied", "SecurityError");
      },
    });
  });
  await blocked.goto(`${webUrl()}/sign-in`);
  await expect(
    blocked.getByRole("combobox", { name: "Tema", exact: true }),
  ).toHaveValue("system");
  await blocked
    .getByRole("combobox", { name: "Tema", exact: true })
    .selectOption("dark");
  await expect(blocked.locator(".product-shell")).toHaveAttribute(
    "data-theme",
    "dark",
  );
  expect(
    (await new AxeBuilder({ page: blocked }).analyze()).violations,
  ).toEqual([]);
  await blocked
    .getByRole("link", { name: "Documentation", exact: true })
    .click();
  await expect(blocked.locator(".docs-workspace")).toBeVisible();
  await blocked.close();
});

test("mobile navigation closes with Escape and route selection, with no overflow in either theme", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signedInHome(page);
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Ir para o conteúdo" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  const menu = page.getByRole("button", { name: "Menu", exact: true });
  const navigation = page.getByRole("navigation", {
    name: "Navegação principal",
  });
  await expect(navigation).not.toBeVisible();
  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await expect(navigation).toBeVisible();
  await navigation.getByRole("link", { name: "Início", exact: true }).focus();
  await page.keyboard.press("Escape");
  await expect(menu).toBeFocused();
  await expect(navigation).not.toBeVisible();
  await menu.click();
  await navigation.getByRole("link", { name: "Empresas", exact: true }).click();
  await expect(
    page.getByRole("toolbar", { name: "Ações do registro" }),
  ).toBeVisible();
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("main")).toBeFocused();
  for (const width of [320, 760, 800, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    for (const value of ["light", "dark"]) {
      await page
        .getByRole("combobox", { name: "Tema", exact: true })
        .selectOption(value);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("collapses the desktop sidebar to accessible icons and keeps the choice across reloads", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 844 });
  await signedInHome(page);
  const sidebar = page.locator(".product-sidebar");
  const navigation = page.getByRole("navigation", {
    name: "Navegação principal",
  });
  const expandedWidth = (await sidebar.boundingBox())!.width;
  await page
    .getByRole("button", { name: "Recolher menu", exact: true })
    .click();
  const expand = page.getByRole("button", {
    name: "Expandir menu",
    exact: true,
  });
  await expect(expand).toBeVisible();
  await expect
    .poll(async () => (await sidebar.boundingBox())!.width)
    .toBeLessThan(expandedWidth / 2);
  await expect(
    page.getByText("Todas as suas telas. Um só lugar."),
  ).toBeHidden();
  const companies = navigation.getByRole("link", {
    name: "Empresas",
    exact: true,
  });
  await expect(companies).toBeVisible();
  expect(await page.evaluate(() => Object.entries(localStorage))).toEqual([
    ["teluni.sidebar", "collapsed"],
  ]);
  for (const value of ["light", "dark"]) {
    await page
      .getByRole("combobox", { name: "Tema", exact: true })
      .selectOption(value);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  }
  await page.reload();
  await expect(expand).toBeVisible();
  await companies.click();
  await expect(
    page.getByRole("toolbar", { name: "Ações do registro" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(expand).toBeHidden();
  // The stored desktop layout never hides labels in the mobile menu.
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await expect(
    navigation.getByRole("link", { name: "Início", exact: true }),
  ).not.toHaveCSS("font-size", "0px");
  await page.setViewportSize({ width: 1280, height: 844 });
  await expand.click();
  await expect(
    page.getByRole("button", { name: "Recolher menu", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => Object.entries(localStorage))).toEqual([
    ["teluni.theme", "dark"],
  ]);
});

test("keeps denied company access explicit in the dark shell", async ({
  page,
}) => {
  await signedInHome(page);
  await page.route(`**/api/companies/${companyId}`, (route) =>
    route.fulfill({
      status: 403,
      json: {
        error: {
          code: "PERMISSION_DENIED",
          message: "Permission denied",
          requestId: "synthetic-denial",
        },
      },
    }),
  );
  await page
    .getByRole("combobox", { name: "Tema", exact: true })
    .selectOption("dark");
  await page.getByRole("link", { name: "Loja Aurora", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(
    "Você não tem permissão para esta ação.",
  );
  await expect(
    page.getByRole("heading", { level: 1, name: "Empresa indisponível" }),
  ).toBeVisible();
  await expect(page.locator(".company-navigation")).toHaveCount(0);
  await expect(page.locator(".product-shell")).toHaveAttribute(
    "data-theme",
    "dark",
  );
  await expect(page.getByRole("alert")).toHaveCSS(
    "color",
    "rgb(254, 205, 211)",
  );
  await expect(page.getByRole("alert")).toHaveCSS(
    "background-color",
    "rgb(60, 27, 42)",
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
