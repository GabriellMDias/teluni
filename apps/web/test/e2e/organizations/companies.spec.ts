import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { enrollAuthenticator, enterCredentials } from "../identity/provider.ts";
import { startIdentityStack, type IdentityStack } from "../identity/stack.ts";

// Company and branch administration through the real sign-in, two-step
// verification and session boundary. Copy is Portuguese.
test.use({ locale: "pt-BR" });
test.describe.configure({ mode: "serial", timeout: 120_000 });
const afterNavigation = expect.configure({ timeout: 20_000 });

let stack: IdentityStack;
test.beforeAll(async () => {
  test.setTimeout(300_000);
  stack = await startIdentityStack();
});
test.afterAll(async () => {
  await stack?.stop();
});

test("creates a company, verifies in two steps and manages branches, settings and history", async ({
  page,
}) => {
  await page.goto(`${stack.webUrl}/companies`);
  await afterNavigation(
    page.getByText("Entre para ver suas empresas."),
  ).toBeVisible();
  await page.getByRole("link", { name: "Entrar", exact: true }).last().click();
  await enterCredentials(page, stack.user);
  await afterNavigation(page).toHaveURL(`${stack.webUrl}/companies`);
  await afterNavigation(
    page.getByText("Você ainda não participa de nenhuma empresa.", {
      exact: false,
    }),
  ).toBeVisible();

  await page.getByLabel("Nome da empresa").fill("Lanchonete Central");
  await page.getByLabel("Fuso horário").selectOption("America/Sao_Paulo");
  await page.getByRole("button", { name: "Criar empresa" }).click();
  await afterNavigation(page).toHaveURL(/\/companies\/[0-9a-f-]{36}$/);
  const companyUrl = page.url();

  // Administration requires two-step verification (P12).
  await expect(page.getByRole("status")).toContainText(
    "verificação em duas etapas",
  );
  await page.getByRole("link", { name: "Verificar em duas etapas" }).click();
  await enrollAuthenticator(page);
  await afterNavigation(page).toHaveURL(companyUrl);
  await afterNavigation(
    page.getByRole("heading", { name: "Lanchonete Central" }),
  ).toBeVisible();
  await expect(
    page.getByText("Responsável pela empresa", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Filiais" })).toBeVisible();
  await expect(page.getByText("Nenhuma filial ainda.")).toBeVisible();

  await page.getByLabel("Nome da filial").fill("Centro");
  await page.getByRole("button", { name: "Adicionar filial" }).click();
  await expect(page.getByText("Centro", { exact: true })).toBeVisible();
  // A second active branch cannot reuse the name, whatever the case.
  await page.getByLabel("Nome da filial").fill("centro");
  await page.getByRole("button", { name: "Adicionar filial" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    /Já existe uma filial ativa com esse nome\./,
  );

  await page.getByRole("button", { name: "Renomear: Centro" }).click();
  await page.getByLabel("Nome da filial").first().fill("Centro Histórico");
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(
    page.getByText("Centro Histórico", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Arquivar: Centro Histórico" })
    .click();
  await expect(page.getByText("Arquivada", { exact: false })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByRole("link", { name: "Configurações da empresa" }).click();
  await page.getByRole("button", { name: "Editar configurações" }).click();
  await page.getByLabel("Nome da empresa").fill("Lanchonete Central Renovada");
  await page.getByLabel("Fuso horário").selectOption("America/Manaus");
  await page.getByLabel("Idioma padrão").selectOption("en-US");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(page.getByText("Configurações salvas.")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Lanchonete Central Renovada" }),
  ).toBeVisible();
  await page.reload();
  await afterNavigation(
    page.getByRole("button", { name: "Editar configurações" }),
  ).toBeVisible();
  await expect(page.getByText("America/Manaus", { exact: true })).toBeVisible();
  await expect(
    page.getByText("English (United States)", { exact: true }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Histórico de alterações" }).click();
  await expect(
    page.getByText("Configurações da empresa alteradas", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Empresa criada", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Filial arquivada", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".audit-list > li").filter({ hasText: "Filial arquivada" }),
  ).toContainText("Centro Histórico");
  await expect(page.locator(".audit-list > li").first()).toContainText(
    "Por você",
  );
  await expect(page.locator(".audit-list > li").first()).toContainText(
    "Idioma padrão",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByRole("link", { name: "Suas empresas" }).click();
  await expect(
    page.getByRole("link", { name: "Lanchonete Central Renovada" }),
  ).toBeVisible();
  await expect(page.getByText("Administrador")).toBeVisible();
});

test("does not reveal a company the person does not belong to", async ({
  page,
}) => {
  const foreign = `${stack.webUrl}/companies/00000000-0000-4000-8000-000000000000`;
  await page.goto(foreign);
  await page.getByRole("link", { name: "Entrar", exact: true }).last().click();
  await enterCredentials(page, stack.user);
  await afterNavigation(page).toHaveURL(foreign);
  await afterNavigation(page.getByRole("alert")).toContainText(
    "Empresa ou filial não encontrada.",
  );
});

test("shows the company workflow in English", async ({ browser }) => {
  const context = await browser.newContext({ locale: "en-US" });
  try {
    const page = await context.newPage();
    await page.goto(`${stack.webUrl}/companies`);
    await afterNavigation(
      page.getByRole("heading", { name: "Your companies" }),
    ).toBeVisible();
    await page
      .getByRole("link", { name: "Sign in", exact: true })
      .last()
      .click();
    await enterCredentials(page, stack.user);
    await afterNavigation(
      page.getByRole("link", { name: "Lanchonete Central Renovada" }),
    ).toBeVisible();
    await expect(page.getByLabel("Company name")).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  } finally {
    await context.close();
  }
});
