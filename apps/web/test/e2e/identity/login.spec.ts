import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { enrollAuthenticator, enterCredentials } from "./provider.ts";
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

test("enables two-step verification from the sessions page", async ({
  page,
}) => {
  await page.goto(`${stack.webUrl}/sign-in?returnTo=%2Faccount%2Fsessions`);
  await page.getByRole("link", { name: "Entrar com segurança" }).click();
  await signInAtProvider(page);
  await afterNavigation(page).toHaveURL(`${stack.webUrl}/account/sessions`);
  await expect(
    page.getByText("Esta sessão não usou verificação em duas etapas.", {
      exact: false,
    }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Verificar em duas etapas" }).click();
  // Keycloak asks this user to register an authenticator app.
  expect(await enrollAuthenticator(page)).not.toBe("");
  await afterNavigation(page).toHaveURL(`${stack.webUrl}/account/sessions`);
  await expect(
    page.getByText("Esta sessão foi verificada em duas etapas em", {
      exact: false,
    }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
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
  });
});
