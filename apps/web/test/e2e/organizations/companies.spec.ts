import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { actionLink, mailedLink } from "../identity/mail.ts";
import {
  choosePassword,
  skipTwoStepSuggestion,
  enterCredentials,
  registerAccount,
} from "../identity/provider.ts";
import { startIdentityStack, type IdentityStack } from "../identity/stack.ts";

// Company and branch administration through the real sign-in and session
// boundary. Copy is Portuguese.
// Bounded actions fail at the missing element instead of consuming the whole
// journey's budget.
test.use({ locale: "pt-BR", actionTimeout: 20_000, navigationTimeout: 30_000 });
test.describe.configure({ mode: "serial", timeout: 120_000 });
const afterNavigation = expect.configure({ timeout: 20_000 });

async function openCompanySection(page: Page, name: string) {
  const menu = page.getByRole("button", { name: "Menu", exact: true });
  if (
    (await menu.isVisible()) &&
    (await menu.getAttribute("aria-expanded")) === "false"
  )
    await menu.click();
  await page
    .getByRole("navigation", { name: "Navegação principal" })
    .getByRole("link", { name, exact: true })
    .click();
}

let stack: IdentityStack;

/** The invitation link in the latest Mailpit message to `recipient`. */
function invitationLink(recipient: string): Promise<string> {
  return mailedLink(
    stack.mailUrl,
    recipient,
    /(https?:\/\/\S+\/invitations\/accept#[A-Za-z0-9_-]{43})/,
  );
}
test.beforeAll(async () => {
  test.setTimeout(300_000);
  stack = await startIdentityStack();
});
test.afterAll(async () => {
  await stack?.stop();
});

test("creates a company and manages branches, settings, members, responsibility and invitations", async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  await page.goto(`${stack.webUrl}/companies`);
  await afterNavigation(
    page.getByText("Entre para ver suas empresas."),
  ).toBeVisible();
  await page
    .getByRole("main")
    .getByRole("link", { name: "Entrar", exact: true })
    .click();
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

  // Administration needs no two-step verification, which is optional.
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

  await openCompanySection(page, "Configurações da empresa");
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

  await openCompanySection(page, "Histórico de alterações");
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

  const memberContext = await browser.newContext({ locale: "pt-BR" });
  memberContext.setDefaultTimeout(20_000);
  try {
    const memberPage = await memberContext.newPage();
    await memberPage.goto(`${stack.webUrl}/companies`);
    await memberPage
      .getByRole("main")
      .getByRole("link", { name: "Entrar", exact: true })
      .click();
    await enterCredentials(memberPage, stack.member);
    await afterNavigation(
      memberPage.getByLabel("Nome da empresa"),
    ).toBeVisible();
    await memberPage.getByLabel("Nome da empresa").fill("Empresa independente");
    await memberPage
      .getByRole("button", { name: "Criar empresa", exact: true })
      .click();
    await afterNavigation(memberPage).toHaveURL(/\/companies\/[0-9a-f-]{36}$/);
    const independentId = new URL(memberPage.url()).pathname.split("/").at(-1)!;
    const sessionResponse = await memberPage.request.get(
      `${stack.webUrl}/api/auth/session`,
    );
    const { principalId } = (await sessionResponse.json()) as {
      principalId: string;
    };
    const companyId = new URL(companyUrl).pathname.split("/").at(-1)!;
    // Fixture arrangement only: invitation delivery/acceptance is not provided
    // by this increment. Every action below goes through the real session API.
    const membershipId = randomUUID();
    await stack.sql.query(
      "INSERT INTO memberships (id, company_id, principal_id) VALUES ($1, $2, $3)",
      [membershipId, companyId, principalId],
    );
    await stack.sql.query(
      "INSERT INTO membership_grants (id, company_id, membership_id, role, scope) VALUES ($1, $2, $3, 'OPERATOR', 'COMPANY')",
      [randomUUID(), companyId, membershipId],
    );
    await memberPage.goto(`${companyUrl}?view=members`);
    await afterNavigation(memberPage.getByRole("alert")).toContainText(
      "Você não tem permissão",
    );
    expect(
      (
        await memberPage.request.get(
          `${stack.webUrl}/api/companies/${companyId}/members`,
        )
      ).status(),
    ).toBe(403);

    await openCompanySection(page, "Membros");
    const memberRow = page
      .locator(".branch-list > li")
      .filter({ hasText: stack.member.email });
    await afterNavigation(memberRow).toBeVisible();
    await expect(
      page.getByText("Responsável pela empresa. Transfira", { exact: false }),
    ).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await memberRow.getByRole("button", { name: /^Suspender:/ }).click();
    await memberRow
      .getByRole("button", { name: "Confirmar alteração", exact: true })
      .click();
    await expect(
      memberRow.getByRole("button", { name: /^Reativar:/ }),
    ).toBeVisible();
    expect(
      (
        await memberPage.request.get(
          `${stack.webUrl}/api/companies/${companyId}`,
        )
      ).status(),
    ).toBe(404);
    const ownCompanies = (await (
      await memberPage.request.get(`${stack.webUrl}/api/companies`)
    ).json()) as { items: { id: string }[] };
    expect(ownCompanies.items.map((item) => item.id)).toEqual([independentId]);

    await memberRow.getByRole("button", { name: /^Reativar:/ }).click();
    await memberRow
      .getByRole("button", { name: "Confirmar alteração", exact: true })
      .click();
    await expect(
      memberRow.getByRole("button", { name: /^Suspender:/ }),
    ).toBeVisible();
    expect(
      (
        await memberPage.request.get(
          `${stack.webUrl}/api/companies/${companyId}`,
        )
      ).status(),
    ).toBe(200);
    await memberRow.getByRole("button", { name: /^Remover acesso:/ }).click();
    await expect(
      memberRow.getByText("Esta ação não pode ser desfeita", { exact: false }),
    ).toBeVisible();
    await memberRow
      .getByRole("button", { name: "Confirmar alteração", exact: true })
      .click();
    await expect(
      memberRow.getByText("Removido", { exact: false }),
    ).toBeVisible();
    await expect(
      memberRow.getByRole("button", { name: /^Reativar:/ }),
    ).toHaveCount(0);
    expect(
      (
        await memberPage.request.get(
          `${stack.webUrl}/api/companies/${companyId}`,
        )
      ).status(),
    ).toBe(404);

    // Responsibility moves only when the proposed administrator accepts it.
    // Fixture arrangement only: the first person joins the member's company.
    const { principalId: userPrincipalId } = (await (
      await page.request.get(`${stack.webUrl}/api/auth/session`)
    ).json()) as { principalId: string };
    const userMembershipId = randomUUID();
    await stack.sql.query(
      "INSERT INTO memberships (id, company_id, principal_id) VALUES ($1, $2, $3)",
      [userMembershipId, independentId, userPrincipalId],
    );
    await stack.sql.query(
      "INSERT INTO membership_grants (id, company_id, membership_id, role, scope) VALUES ($1, $2, $3, 'OPERATOR', 'COMPANY')",
      [randomUUID(), independentId, userMembershipId],
    );
    const independentUrl = `${stack.webUrl}/companies/${independentId}`;
    await memberPage.goto(`${independentUrl}?view=members`);
    const userRow = memberPage
      .locator(".branch-list > li")
      .filter({ hasText: stack.user.email });
    await afterNavigation(userRow).toBeVisible();
    await userRow.getByRole("button", { name: /^Adicionar papel:/ }).click();
    await userRow
      .getByLabel("Papel", { exact: true })
      .selectOption("COMPANY_ADMINISTRATOR");
    await expect(
      userRow.getByText("A administração sempre vale para toda a empresa."),
    ).toBeVisible();
    expect(
      (await new AxeBuilder({ page: memberPage }).analyze()).violations,
    ).toEqual([]);
    await userRow.getByRole("button", { name: "Conceder papel" }).click();
    await expect(
      userRow.getByRole("button", { name: /^Revogar papel: Administrador/ }),
    ).toBeVisible();
    await userRow
      .getByRole("button", { name: /^Revogar papel: Operador/ })
      .click();
    await userRow
      .getByRole("button", { name: "Confirmar revogação", exact: true })
      .click();
    await expect(
      userRow.getByRole("button", { name: /^Revogar papel: Operador/ }),
    ).toHaveCount(0);
    await expect(userRow).toContainText("Ativo · Administrador");

    await userRow
      .getByRole("button", { name: /^Transferir responsabilidade:/ })
      .click();
    await userRow
      .getByRole("button", { name: "Propor transferência", exact: true })
      .click();
    await expect(memberPage.getByRole("status")).toContainText(
      "aguardando aceite",
    );
    await expect(
      userRow.getByRole("button", { name: /^Transferir responsabilidade:/ }),
    ).toHaveCount(0);

    await page.goto(independentUrl);
    await afterNavigation(page.getByRole("status")).toContainText(
      "propôs transferir para você a responsabilidade",
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page
      .getByRole("button", { name: "Aceitar responsabilidade" })
      .click();
    await expect(
      page.getByText(/Seu acesso: Administrador · Responsável pela empresa/),
    ).toBeVisible();
    await expect(page.getByRole("status")).toHaveCount(0);
    await openCompanySection(page, "Histórico de alterações");
    await expect(
      page.getByText("Responsabilidade transferida", { exact: true }),
    ).toBeVisible();
    await expect(
      page.locator(".audit-list > li").filter({ hasText: "Papel concedido" }),
    ).toContainText("Papel: Administrador");

    await memberPage.reload();
    await afterNavigation(userRow).toContainText(
      "Responsável pela empresa. Transfira",
    );
    await expect(
      userRow.getByRole("button", { name: /^Suspender:/ }),
    ).toHaveCount(0);

    // Invitations: the member, still an administrator, invites a third
    // person by email; only that person's verified address can accept.
    await memberPage.goto(`${independentUrl}?view=invitations`);
    await afterNavigation(
      memberPage.getByLabel("E-mail da pessoa"),
    ).toBeVisible();
    await memberPage.getByLabel("E-mail da pessoa").fill(stack.guest.email);
    await memberPage
      .getByRole("button", { name: "Enviar convite", exact: true })
      .click();
    await expect(
      memberPage.getByText("Convite criado.", { exact: false }),
    ).toBeVisible();
    const invitationRow = memberPage
      .locator(".branch-list > li")
      .filter({ hasText: stack.guest.email });
    await expect(invitationRow).toContainText("Aguardando aceite");
    expect(
      (await new AxeBuilder({ page: memberPage }).analyze()).violations,
    ).toEqual([]);
    const link = await invitationLink(stack.guest.email);
    expect(new URL(link).origin).toBe(new URL(stack.webUrl).origin);

    // Another signed-in person with the link learns only that it is not theirs.
    const otherTab = await page.context().newPage();
    try {
      await otherTab.goto(link);
      await afterNavigation(otherTab.getByRole("alert")).toContainText(
        "enviado para outro endereço",
      );
      await expect(
        otherTab.getByRole("button", { name: "Aceitar convite" }),
      ).toHaveCount(0);
    } finally {
      await otherTab.close();
    }

    const guestContext = await browser.newContext({ locale: "pt-BR" });
    guestContext.setDefaultTimeout(20_000);
    try {
      const guestPage = await guestContext.newPage();
      await guestPage.goto(link);
      await afterNavigation(
        guestPage.getByText(
          "Entre com o endereço de e-mail que recebeu o convite",
          {
            exact: false,
          },
        ),
      ).toBeVisible();
      // The credential left the address bar before anything else ran.
      expect(guestPage.url()).toBe(`${stack.webUrl}/invitations/accept`);
      await guestPage
        .getByRole("main")
        .getByRole("link", { name: "Entrar", exact: true })
        .click();
      await enterCredentials(guestPage, stack.guest);
      await afterNavigation(
        guestPage.getByRole("button", { name: "Aceitar convite" }),
      ).toBeVisible();
      await expect(
        guestPage.getByText("Empresa independente", { exact: true }),
      ).toBeVisible();
      expect(
        (await new AxeBuilder({ page: guestPage }).analyze()).violations,
      ).toEqual([]);
      await guestPage.getByRole("button", { name: "Aceitar convite" }).click();
      await afterNavigation(guestPage).toHaveURL(independentUrl);
      await afterNavigation(
        guestPage.getByRole("heading", { name: "Empresa independente" }),
      ).toBeVisible();
      await expect(guestPage.getByText(/Seu acesso: Operador/)).toBeVisible();
    } finally {
      await guestContext.close();
    }
    await memberPage.reload();
    await afterNavigation(invitationRow).toContainText("Aceito");

    // Someone without an account creates one from the invitation, confirms
    // the address in the same tab and accepts.
    const newcomer = `newcomer-${randomUUID().slice(0, 8)}@example.test`;
    await memberPage.getByLabel("E-mail da pessoa").fill(newcomer);
    await memberPage
      .getByRole("button", { name: "Enviar convite", exact: true })
      .click();
    await expect(
      memberPage.locator(".branch-list > li").filter({ hasText: newcomer }),
    ).toContainText("Aguardando aceite");
    const newcomerLink = await invitationLink(newcomer);
    const newcomerContext = await browser.newContext({ locale: "pt-BR" });
    newcomerContext.setDefaultTimeout(20_000);
    try {
      const newcomerPage = await newcomerContext.newPage();
      await newcomerPage.goto(newcomerLink);
      await newcomerPage
        .getByRole("main")
        .getByRole("link", { name: "Criar conta", exact: true })
        .click();
      const since = new Date(Date.now() - 1000);
      await registerAccount(newcomerPage, newcomer);
      await newcomerPage.goto(
        await mailedLink(stack.mailUrl, newcomer, actionLink, since),
      );
      await choosePassword(newcomerPage, `senha-${randomUUID()}`);
      await skipTwoStepSuggestion(newcomerPage);
      await afterNavigation(
        newcomerPage.getByRole("button", { name: "Aceitar convite" }),
      ).toBeVisible();
      await newcomerPage
        .getByRole("button", { name: "Aceitar convite" })
        .click();
      await afterNavigation(newcomerPage).toHaveURL(independentUrl);
    } finally {
      await newcomerContext.close();
    }
  } finally {
    await memberContext.close();
  }

  await page.getByRole("link", { name: "Suas empresas" }).click();
  const rows = page.locator(".ui-datagrid tbody tr");
  await expect(
    rows.filter({ hasText: "Lanchonete Central Renovada" }),
  ).toContainText("Administrador");
  await expect(rows.filter({ hasText: "Empresa independente" })).toContainText(
    "Administrador",
  );

  // The dataset switches between the grid and the selected record's form.
  // Rows are selected by clicking them; only their color marks the choice.
  const toolbar = page.getByRole("toolbar", { name: "Ações do registro" });
  const renamed = rows.filter({ hasText: "Lanchonete Central Renovada" });
  await renamed.getByRole("gridcell").nth(1).click();
  await expect(renamed).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("radio")).toHaveCount(0);
  // The shown rows export as a CSV that Portuguese spreadsheets read.
  const exported = page.waitForEvent("download");
  await toolbar.getByRole("button", { name: "Exportar" }).click();
  await page.getByRole("menuitem", { name: "CSV (.csv)" }).click();
  const file = await exported;
  expect(file.suggestedFilename()).toMatch(/^Empresas \d{4}-\d{2}-\d{2}\.csv$/);
  const csv = await readFile(await file.path(), "utf8");
  expect(csv.startsWith("\uFEFFNome da empresa;Seu acesso\r\n")).toBe(true);
  expect(csv).toContain("Lanchonete Central Renovada;Administrador");
  await toolbar.getByRole("button", { name: "Modo formulário" }).click();
  await expect(page.getByLabel("Nome da empresa")).toHaveValue(
    "Lanchonete Central Renovada",
  );
  await expect(page.getByLabel("Fuso horário")).toHaveValue("America/Manaus");
  await page.getByLabel("Nome da empresa").fill("Rascunho descartado");
  await expect(
    toolbar.getByRole("button", { name: "Duplicar" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(page.getByLabel("Nome da empresa")).toHaveValue(
    "Lanchonete Central Renovada",
  );
  await toolbar.getByRole("button", { name: "Duplicar" }).click();
  await expect(page.getByLabel("Nome da empresa")).toHaveValue(
    "Lanchonete Central Renovada (cópia)",
  );
  await expect(page.getByLabel("Fuso horário")).toHaveValue("America/Manaus");
  await expect(
    page.getByRole("button", { name: "Criar empresa" }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await toolbar.getByRole("button", { name: "Modo grade" }).click();
  await expect(rows).toHaveCount(2);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("does not reveal a company the person does not belong to", async ({
  page,
}) => {
  const foreign = `${stack.webUrl}/companies/00000000-0000-4000-8000-000000000000`;
  await page.goto(foreign);
  await page
    .getByRole("main")
    .getByRole("link", { name: "Entrar", exact: true })
    .click();
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
      .getByRole("main")
      .getByRole("link", { name: "Sign in", exact: true })
      .click();
    await enterCredentials(page, stack.user);
    await afterNavigation(
      page.getByRole("link", { name: "Lanchonete Central Renovada" }),
    ).toBeVisible();
    await expect(
      page.getByRole("toolbar", { name: "Record actions" }),
    ).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  } finally {
    await context.close();
  }
});
