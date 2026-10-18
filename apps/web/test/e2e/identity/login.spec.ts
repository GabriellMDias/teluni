import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { startIdentityStack, type IdentityStack } from "./stack.ts";

// Browser journeys through the real Keycloak pages and the API session
// boundary. Copy is Portuguese, the initial market's default locale.
test.use({ locale: "pt-BR" });
test.describe.configure({ mode: "serial", timeout: 120_000 });

let stack: IdentityStack;
test.beforeAll(async () => {
  test.setTimeout(300_000);
  stack = await startIdentityStack();
});
test.afterAll(async () => {
  await stack?.stop();
});

async function signInAtProvider(page: Page) {
  await page.locator("#username").fill(stack.user.email);
  await page.locator("#password").fill(stack.user.password);
  await page.locator("#kc-login").click();
}

test("signs in through Keycloak, manages sessions and signs out", async ({
  page,
  context,
}) => {
  await page.goto(`${stack.webUrl}/account/sessions`);
  await expect(page.getByText("Entre para ver suas sessões.")).toBeVisible();
  await page.getByRole("link", { name: "Entrar", exact: true }).last().click();
  await expect(page).toHaveURL(
    /\/realms\/teluni\/protocol\/openid-connect\/auth/,
  );
  await signInAtProvider(page);

  await expect(page).toHaveURL(`${stack.webUrl}/account/sessions`);
  await expect(
    page.getByRole("heading", { name: "Suas sessões" }),
  ).toBeVisible();
  await expect(page.getByText("Esta sessão")).toBeVisible();
  const [cookie] = (await context.cookies(stack.webUrl)).filter(
    (item) => item.name === "teluni_session",
  );
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Strict" });
  expect(cookie.expires).toBe(-1);
  // The panel keeps no credentials or tokens in browser storage.
  expect(
    await page.evaluate(() => [localStorage.length, sessionStorage.length]),
  ).toEqual([0, 0]);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(`${stack.webUrl}/sign-in`);
  await expect(
    page.getByRole("heading", { name: "Entrar no Teluni" }),
  ).toBeVisible();
  expect(
    (await context.cookies(stack.webUrl)).some(
      (item) => item.name === "teluni_session",
    ),
  ).toBe(false);
  await page.goto(`${stack.webUrl}/account/sessions`);
  await expect(page.getByText("Entre para ver suas sessões.")).toBeVisible();
});

test("ending the current session from the list signs the browser out", async ({
  page,
}) => {
  await page.goto(`${stack.webUrl}/sign-in`);
  await page.getByRole("link", { name: "Entrar com segurança" }).click();
  await signInAtProvider(page);
  await expect(page).toHaveURL(`${stack.webUrl}/`);
  await page.getByRole("link", { name: "Sessões" }).first().click();
  await page.getByRole("button", { name: /^Encerrar: Esta sessão/ }).click();
  await expect(page).toHaveURL(`${stack.webUrl}/sign-in`);
  await page.goto(`${stack.webUrl}/account/sessions`);
  await expect(page.getByText("Entre para ver suas sessões.")).toBeVisible();
});

test("reports a stale or forged callback with localized guidance", async ({
  page,
}) => {
  await page.goto(`${stack.webUrl}/api/auth/callback?state=forged&code=forged`);
  await expect(page).toHaveURL(`${stack.webUrl}/sign-in?error=login_expired`);
  await expect(page.getByRole("alert")).toHaveText(
    "A tentativa de entrada expirou ou já foi usada. Comece de novo.",
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test.describe("in English", () => {
  test.use({ locale: "en-US" });
  test("shows the English sign-in page", async ({ page }) => {
    await page.goto(`${stack.webUrl}/sign-in`);
    await expect(
      page.getByRole("heading", { name: "Sign in to Teluni" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Sign in securely" }),
    ).toBeVisible();
  });
});
