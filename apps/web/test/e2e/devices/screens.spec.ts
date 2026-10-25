import AxeBuilder from "@axe-core/playwright";
import { createHash, randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { enrollAuthenticator, enterCredentials } from "../identity/provider.ts";
import { startIdentityStack, type IdentityStack } from "../identity/stack.ts";

// Screen pairing through the real panel, with the player simulated over HTTP
// against the API: enroll, pair in the panel, check in, unlink and confirm
// erasure. Copy is Portuguese.
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

/** A synthetic player holding a credential it generated itself. */
function player() {
  const credential = randomBytes(32);
  const bearer = {
    authorization: `Bearer ${credential.toString("base64url")}`,
  };
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${stack.apiUrl}${path}`, {
      method,
      headers: {
        ...bearer,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return {
      status: response.status,
      body: (response.status === 204 ? {} : await response.json()) as Record<
        string,
        unknown
      >,
    };
  };
  return {
    call,
    async enroll() {
      const response = await fetch(`${stack.apiUrl}/device-enrollments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          credentialHash: createHash("sha256")
            .update(credential)
            .digest("base64url"),
          report: {
            appVersion: "0.0.0-e2e",
            protocolVersion: 1,
            manufacturer: "Synthetic",
            model: "E2E Player",
            osVersion: "14",
            display: { width: 1920, height: 1080 },
            rotations: [0, 90],
          },
        }),
      });
      expect(response.status).toBe(201);
      return (await response.json()) as {
        enrollmentId: string;
        userCode: string;
      };
    },
  };
}

test("pairs a simulated screen, checks it in, unlinks it and confirms erasure", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const screen = player();
  const enrollment = await screen.enroll();

  await page.goto(`${stack.webUrl}/companies`);
  await page
    .getByRole("main")
    .getByRole("link", { name: "Entrar", exact: true })
    .click();
  await enterCredentials(page, stack.user);
  await afterNavigation(page).toHaveURL(`${stack.webUrl}/companies`);
  await page.getByLabel("Nome da empresa").fill("Telas Centrais");
  await page.getByRole("button", { name: "Criar empresa" }).click();
  await afterNavigation(page).toHaveURL(/\/companies\/[0-9a-f-]{36}$/);
  const companyUrl = page.url();
  await page.getByRole("link", { name: "Verificar em duas etapas" }).click();
  await enrollAuthenticator(page);
  await afterNavigation(page).toHaveURL(companyUrl);
  await page.getByLabel("Nome da filial").fill("Centro");
  await page.getByRole("button", { name: "Adicionar filial" }).click();
  await expect(page.getByText("Centro", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Telas", exact: true }).click();
  await afterNavigation(page).toHaveURL(`${companyUrl}/screens`);
  await expect(page.getByText("Nenhuma tela pareada ainda.")).toBeVisible();
  await page.getByLabel("Código da TV").fill(enrollment.userCode.toLowerCase());
  await page.getByLabel("Nome da tela").fill("Caixa 1");
  await page.getByLabel("Rotação").selectOption("90°");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Parear tela" }).click();
  await expect(page.getByRole("status")).toContainText("Tela pareada.");
  await expect(
    page.getByText("Synthetic E2E Player", { exact: false }),
  ).toBeVisible();

  // The player learns its identity by polling, then checks in.
  const polled = await screen.call(
    "POST",
    `/device-enrollments/${enrollment.enrollmentId}/status`,
  );
  expect(polled.body).toMatchObject({ status: "paired" });
  const self = await screen.call("GET", "/device/self");
  expect(self.body).toMatchObject({
    status: "active",
    name: "Caixa 1",
    rotation: 90,
    clearRequired: false,
  });

  await page
    .getByRole("listitem")
    .getByRole("link", { name: "Caixa 1" })
    .click();
  await afterNavigation(
    page.getByRole("heading", { name: "Caixa 1" }),
  ).toBeVisible();
  await expect(
    page.getByText("Pode exibir sem conexão até, no máximo"),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Histórico da tela", exact: true })
    .click();
  const history = page.getByTestId("screen-history");
  await afterNavigation(history).toContainText("Tela pareada");
  await expect(history).toContainText("Você");
  for (const theme of ["dark", "light"]) {
    await page
      .getByRole("combobox", { name: "Tema", exact: true })
      .selectOption(theme);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  }
  await page.getByRole("link", { name: "Detalhes", exact: true }).click();
  const unlink = page.getByRole("button", { name: "Desvincular tela" });
  await expect(unlink).toBeDisabled();
  await page
    .getByLabel("Confirmo que quero desvincular “Caixa 1”", { exact: false })
    .check();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await unlink.click();
  await expect(
    page.getByText("Limpeza pendente", { exact: false }).first(),
  ).toBeVisible();

  // The revoked credential can only learn it must clear, then confirm it.
  expect((await screen.call("GET", "/device/self")).body).toMatchObject({
    status: "unlinked",
    clearRequired: true,
  });
  expect(
    (
      await screen.call("PUT", "/device/self/report", {
        appVersion: "0.0.0-e2e",
        protocolVersion: 1,
        manufacturer: "Synthetic",
        model: "E2E Player",
        osVersion: "14",
        display: { width: 1920, height: 1080 },
        rotations: [0],
      })
    ).status,
  ).toBe(401);
  expect((await screen.call("POST", "/device/self/erasure")).status).toBe(204);
  expect((await screen.call("GET", "/device/self")).status).toBe(401);

  await page.reload();
  await afterNavigation(
    page.getByText("Limpeza confirmada pela tela", { exact: false }).first(),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Histórico da tela", exact: true })
    .click();
  await afterNavigation(history).toContainText("Tela desvinculada");
  await expect(history).toContainText("Limpeza confirmada pela tela");
  await expect(history).toContainText("A própria tela");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
