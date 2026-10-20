import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { enrollAuthenticator, enterCredentials } from "../identity/provider.ts";
import { startIdentityStack, type IdentityStack } from "../identity/stack.ts";

// Catalogs through the real panel and API: a product catalog from the
// preset, an item with a base price, a branch price and a promotion, the
// effective prices read at two local times, and a layout whose menu area
// shows the catalog, with its fit and export. Copy is Portuguese.
test.use({ locale: "pt-BR", actionTimeout: 20_000, navigationTimeout: 30_000 });
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

test("creates a product catalog with a branch price and a promotion and reads the effective prices", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.goto(`${stack.webUrl}/companies`);
  await page
    .getByRole("main")
    .getByRole("link", { name: "Entrar", exact: true })
    .click();
  await enterCredentials(page, stack.user);
  await afterNavigation(page).toHaveURL(`${stack.webUrl}/companies`);
  await page.getByLabel("Nome da empresa").fill("Lanchonete Central");
  await page.getByRole("button", { name: "Criar empresa" }).click();
  await afterNavigation(page).toHaveURL(/\/companies\/[0-9a-f-]{36}$/);
  const companyUrl = page.url();
  await page.getByRole("link", { name: "Verificar em duas etapas" }).click();
  await enrollAuthenticator(page);
  await afterNavigation(page).toHaveURL(companyUrl);
  await page.getByLabel("Nome da filial").fill("Centro");
  await page.getByRole("button", { name: "Adicionar filial" }).click();
  await expect(page.getByText("Centro", { exact: true })).toBeVisible();

  // A company catalog from the products preset.
  await page.getByRole("link", { name: "Catálogos", exact: true }).click();
  await afterNavigation(page).toHaveURL(`${companyUrl}/catalogs`);
  await expect(page.getByText("Nenhum catálogo ainda.")).toBeVisible();
  await page.getByLabel("Nome", { exact: true }).fill("Cardápio");
  await page.getByRole("button", { name: "Criar", exact: true }).click();
  await afterNavigation(
    page.getByRole("heading", { level: 1, name: "Cardápio" }),
  ).toBeVisible();
  await expect(
    page.getByText("0 itens · 5 campos", { exact: false }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  // An item, then its prices.
  await page.getByLabel("Nome *").fill("X-Burger");
  await page.getByLabel("Categoria").selectOption("Pratos");
  await page.getByRole("button", { name: "Adicionar item" }).click();
  await afterNavigation(
    page.getByRole("heading", { level: 1, name: "X-Burger" }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "Preço base" }).fill("19,90");
  await page
    .getByRole("form", { name: "Preço base" })
    .getByRole("button", { name: "Salvar" })
    .click();
  await expect(page.getByRole("status")).toContainText("Alterações salvas.");
  await expect(
    page.getByRole("form", { name: "Preço base" }).getByText(/R\$\s19,90/),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "Preço em Centro" }).fill("17,90");
  await page
    .getByRole("form", { name: "Preço em Centro" })
    .getByRole("button", { name: "Salvar" })
    .click();
  await expect(
    page.getByRole("form", { name: "Preço em Centro" }).getByText(/R\$\s17,90/),
  ).toBeVisible();

  // A company-wide promotion on New Year's Day, local time.
  await page.getByLabel("Valor (BRL)").fill("14,90");
  await page
    .getByLabel("Início (horário local de cada tela)")
    .fill("2030-01-01T00:00");
  await page.getByLabel("Fim (não incluído)").fill("2030-01-02T00:00");
  await page.getByRole("button", { name: "Adicionar promoção" }).click();
  await expect(
    page.getByText("2030-01-01 00:00 até 2030-01-02 00:00", { exact: false }),
  ).toBeVisible();

  // Effective prices: the promotion everywhere, then the branch price.
  const effective = page.getByRole("region", { name: "Preço em vigor" });
  await page.getByLabel("Data e hora local").fill("2030-01-01T12:00");
  await expect(effective).toContainText(
    /Todas as filiais: R\$\s14,90 \(promoção\)/,
  );
  await expect(effective).toContainText(/Centro: R\$\s14,90 \(promoção\)/);
  await page.getByLabel("Data e hora local").fill("2030-01-03T12:00");
  await expect(effective).toContainText(
    /Todas as filiais: R\$\s19,90 \(preço base\)/,
  );
  await expect(effective).toContainText(
    /Centro: R\$\s17,90 \(preço da filial\)/,
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  // A layout: a video column and a menu area showing the catalog.
  await page.goto(`${companyUrl}/programming?view=layouts`);
  await expect(page.getByText("Nenhum layout ainda.")).toBeVisible();
  await page.getByLabel("Nome", { exact: true }).fill("Vitrine");
  await page.getByRole("button", { name: "Criar", exact: true }).click();
  await afterNavigation(
    page.getByRole("heading", { level: 1, name: "Vitrine" }),
  ).toBeVisible();
  await page.getByLabel("Largura", { exact: true }).fill("1280");
  await page
    .getByRole("button", { name: "Adicionar área de catálogo" })
    .click();
  await page.getByLabel("Nome da área").fill("Cardápio");
  await page.getByLabel("Chave", { exact: true }).fill("cardapio");
  await page.getByLabel("X", { exact: true }).fill("1280");
  await page.getByLabel("Y", { exact: true }).fill("0");
  await page.getByLabel("Largura", { exact: true }).fill("640");
  await page.getByLabel("Altura", { exact: true }).fill("1080");
  await page.getByLabel("Catálogo", { exact: true }).selectOption("Cardápio");
  await page.getByRole("button", { name: "Adicionar campo" }).click();
  await page.getByRole("button", { name: "Adicionar campo" }).click();
  await page.getByLabel("Campo 2", { exact: true }).selectOption("Preço");
  await page.getByLabel("Papel do campo 2").selectOption("Preço");
  await page
    .getByLabel("Apresentação")
    .selectOption("Cardápio (título e preço alinhados)");
  await page.getByRole("button", { name: "Salvar layout" }).click();
  await expect(page.getByRole("status")).toContainText("Layout salvo.");
  const fit = page.getByRole("region", { name: "Encaixe dos catálogos" });
  await expect(fit).toContainText("Cardápio");
  await expect(fit).toContainText(/1 item em 1 página, até \d+ por página/);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar JSON" }).click();
  expect((await download).suggestedFilename()).toBe(
    "vitrine.teluni-layout.json",
  );
  await expect(page.getByRole("status")).toContainText(
    "Arquivo do layout exportado.",
  );

  // A group program chooses the layout; each area has its own schedules,
  // and publication waits for the screens' protocol 2.
  await page.goto(`${companyUrl}/programming?view=groups`);
  await page.getByLabel("Nome", { exact: true }).fill("Lojas");
  await page.getByLabel("Centro", { exact: true }).check();
  await page.getByRole("button", { name: "Criar", exact: true }).click();
  await afterNavigation(
    page.getByRole("heading", { level: 1, name: "Lojas" }),
  ).toBeVisible();
  await page.getByLabel("Layout", { exact: true }).selectOption("Vitrine");
  await page.getByRole("button", { name: "Usar este layout" }).click();
  await expect(page.getByRole("status")).toContainText("Layout escolhido.");
  await page
    .getByLabel("Área", { exact: true })
    .selectOption("Cardápio (catálogo)");
  await expect(
    page.getByText("O padrão desta área é a visão do catálogo", {
      exact: false,
    }),
  ).toBeVisible();
  await page.getByLabel("Área na prévia").selectOption("Cardápio (catálogo)");
  await expect(
    page.getByRole("cell", { name: "Visão do catálogo" }).first(),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Revisar para publicar" }).click();
  await expect(
    page.getByText("serão publicadas pelo protocolo 2", { exact: false }),
  ).toBeVisible();
});
