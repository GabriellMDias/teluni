import AxeBuilder from "@axe-core/playwright";
import { randomBytes } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { actionLink, mailedLink } from "./mail.ts";
import {
  choosePassword,
  enrollAuthenticator,
  enterCredentials,
  registerAccount,
  totp,
} from "./provider.ts";
import { startIdentityStack, type IdentityStack } from "./stack.ts";

// Browser journeys through the real Keycloak pages and the API session
// boundary. Copy is Portuguese, the initial market's default locale.
test.use({ locale: "pt-BR" });
// Pages reached by a full navigation through the provider can be the first
// requests a freshly started dev server compiles; allow for that cold start.
const afterNavigation = expect.configure({ timeout: 20_000 });
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
  await enterCredentials(page, stack.user);
}

test("signs in through Keycloak, manages sessions and signs out", async ({
  page,
  context,
}) => {
  await page.goto(`${stack.webUrl}/account/sessions`);
  await afterNavigation(
    page.getByText("Entre para ver suas sessões."),
  ).toBeVisible();
  await page
    .getByRole("main")
    .getByRole("link", { name: "Entrar", exact: true })
    .click();
  await afterNavigation(page).toHaveURL(
    /\/realms\/teluni\/protocol\/openid-connect\/auth/,
  );
  await signInAtProvider(page);

  await afterNavigation(page).toHaveURL(`${stack.webUrl}/account/sessions`);
  await afterNavigation(
    page.getByRole("heading", { name: "Suas sessões" }),
  ).toBeVisible();
  await expect(page.getByText("Esta sessão", { exact: true })).toBeVisible();
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
  await afterNavigation(page).toHaveURL(`${stack.webUrl}/sign-in`);
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
  await afterNavigation(page).toHaveURL(`${stack.webUrl}/`);
  await page.getByRole("link", { name: "Sessões" }).first().click();
  await page.getByRole("button", { name: /^Encerrar: Esta sessão/ }).click();
  await afterNavigation(page).toHaveURL(`${stack.webUrl}/sign-in`);
  await page.goto(`${stack.webUrl}/account/sessions`);
  await expect(page.getByText("Entre para ver suas sessões.")).toBeVisible();
});

/** Waits for the next TOTP period so Keycloak does not reject a reused code. */
async function freshCode(secret: string, previous: string): Promise<string> {
  let code = totp(secret);
  while (code === previous) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    code = totp(secret);
  }
  return code;
}

/** Keycloak may ask for the password again before an account action. */
async function passwordIfAsked(page: Page, password: string): Promise<void> {
  await page.locator("#password, #totp, #otp, #kc-accept").first().waitFor();
  if ((await page.locator("#password").count()) > 0) {
    await page.locator("#password").fill(password);
    await page.locator("#kc-login").click();
  }
}

test("enables optional two-step verification, asks for the code at sign-in and disables it", async ({
  page,
}) => {
  await page.goto(`${stack.webUrl}/sign-in?returnTo=%2Faccount%2Fsessions`);
  await page.getByRole("link", { name: "Entrar com segurança" }).click();
  await signInAtProvider(page);
  await afterNavigation(page).toHaveURL(`${stack.webUrl}/account/sessions`);
  await expect(page.getByText("Desativada.", { exact: false })).toBeVisible();
  await page
    .getByRole("link", { name: "Ativar verificação em duas etapas" })
    .click();
  await passwordIfAsked(page, stack.user.password);
  // Keycloak asks this user to register an authenticator app.
  const secret = await enrollAuthenticator(page);
  expect(secret).not.toBe("");
  let code = totp(secret);
  await afterNavigation(page).toHaveURL(`${stack.webUrl}/account/sessions`);
  await afterNavigation(
    page.getByText("Ativada.", { exact: false }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  // Every sign-in now asks for the code after the password.
  await page.getByRole("button", { name: "Sair" }).click();
  await afterNavigation(page).toHaveURL(`${stack.webUrl}/sign-in`);
  await page.getByRole("link", { name: "Entrar com segurança" }).click();
  await enterCredentials(page, stack.user, "stay");
  await expect(page.locator("#otp")).toBeVisible({ timeout: 20_000 });
  code = await freshCode(secret, code);
  await page.locator("#otp").fill(code);
  await page.locator("#kc-login").click();
  await afterNavigation(page).toHaveURL(`${stack.webUrl}/`);

  // Turning it off asks for the password and the current code again.
  await page.goto(`${stack.webUrl}/account/sessions`);
  await page
    .getByRole("link", { name: "Desativar verificação em duas etapas" })
    .click();
  await passwordIfAsked(page, stack.user.password);
  await expect(page.locator("#otp")).toBeVisible({ timeout: 20_000 });
  code = await freshCode(secret, code);
  await page.locator("#otp").fill(code);
  await page.locator("#kc-login").click();
  await page.locator("#kc-accept").click();
  await afterNavigation(page).toHaveURL(`${stack.webUrl}/account/sessions`);
  await afterNavigation(
    page.getByText("Desativada.", { exact: false }),
  ).toBeVisible();
});

test("creates an account, confirms the email, chooses a password and creates a company", async ({
  page,
}) => {
  // IA-01: public signup with email verification before any access (P06,
  // P07); the new person then creates an isolated company of their own.
  const email = `new-${randomBytes(4).toString("hex")}@example.test`;
  const password = `nova-senha-${randomBytes(6).toString("hex")}`;
  await page.goto(`${stack.webUrl}/sign-in?returnTo=%2Fcompanies`);
  await page.getByRole("link", { name: "Criar conta" }).click();
  const since = new Date(Date.now() - 1000);
  await registerAccount(page, email);
  await page.goto(await mailedLink(stack.mailUrl, email, actionLink, since));
  await choosePassword(page, password);

  // The first sign-in suggests two-step verification, which stays optional.
  await afterNavigation(
    page.getByRole("heading", { name: "Proteja sua conta" }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("link", { name: "Configurar agora" }).click();
  await passwordIfAsked(page, password);
  await enrollAuthenticator(page);
  await afterNavigation(page).toHaveURL(`${stack.webUrl}/companies`);
  await afterNavigation(
    page.getByText("Você ainda não participa de nenhuma empresa.", {
      exact: false,
    }),
  ).toBeVisible();
  await page.getByLabel("Nome da empresa").fill("Empresa da Nova Pessoa");
  await page.getByLabel("Fuso horário").selectOption("America/Sao_Paulo");
  await page.getByRole("button", { name: "Criar empresa" }).click();
  await afterNavigation(page).toHaveURL(/\/companies\/[0-9a-f-]{36}$/);
  await afterNavigation(
    page.getByText("Responsável pela empresa", { exact: false }),
  ).toBeVisible();
});

test("recovers a forgotten password through a single-use link that ends other sessions", async ({
  browser,
}) => {
  // IA-06: the reset link works once, and the new password ends the
  // person's earlier sessions through back-channel logout.
  const person = stack.guest;
  const earlier = await browser.newContext({ locale: "pt-BR" });
  const recovering = await browser.newContext({ locale: "pt-BR" });
  try {
    const earlierPage = await earlier.newPage();
    await earlierPage.goto(
      `${stack.webUrl}/sign-in?returnTo=%2Faccount%2Fsessions`,
    );
    await earlierPage
      .getByRole("link", { name: "Entrar com segurança" })
      .click();
    await enterCredentials(earlierPage, person);
    await afterNavigation(
      earlierPage.getByRole("heading", { name: "Suas sessões" }),
    ).toBeVisible();

    const page = await recovering.newPage();
    await page.goto(`${stack.webUrl}/sign-in?returnTo=%2Faccount%2Fsessions`);
    await page.getByRole("link", { name: "Entrar com segurança" }).click();
    await page.locator('a[href*="login-actions/reset-credentials"]').click();
    await page.locator("#username").fill(person.email);
    const since = new Date(Date.now() - 1000);
    await page.locator("button#kc-form-buttons").click();
    const link = await mailedLink(
      stack.mailUrl,
      person.email,
      actionLink,
      since,
    );
    await page.goto(link);
    await choosePassword(page, `outra-senha-${randomBytes(6).toString("hex")}`);
    await afterNavigation(page).toHaveURL(`${stack.webUrl}/account/sessions`);
    await expect(page.getByText("Esta sessão", { exact: true })).toBeVisible();

    // The session from before the reset ends.
    await expect
      .poll(
        async () => {
          await earlierPage.reload();
          return earlierPage
            .getByText("Entre para ver suas sessões.")
            .isVisible();
        },
        { timeout: 30_000 },
      )
      .toBe(true);

    // The link cannot be used again.
    const reused = await recovering.newPage();
    await reused.goto(link);
    await expect(reused.locator("#password-new")).toHaveCount(0);
  } finally {
    await earlier.close();
    await recovering.close();
  }
});

test("reports a stale or forged callback with localized guidance", async ({
  page,
}) => {
  await page.goto(`${stack.webUrl}/api/auth/callback?state=forged&code=forged`);
  await afterNavigation(page).toHaveURL(
    `${stack.webUrl}/sign-in?error=login_expired`,
  );
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
    await expect(
      page.getByRole("link", { name: "Create an account" }),
    ).toBeVisible();
  });
});
