import AxeBuilder from "@axe-core/playwright";
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import { enterCredentials } from "../identity/provider.ts";
import { startIdentityStack, type IdentityStack } from "../identity/stack.ts";

// Programming through the real panel and API: upload an image, build a
// playlist, give a group an all-day schedule, put a simulated screen in the
// group and preview what it will play. Copy is Portuguese.
test.use({ locale: "pt-BR", actionTimeout: 20_000, navigationTimeout: 30_000 });
test.describe.configure({ mode: "serial", timeout: 120_000 });
const afterNavigation = expect.configure({ timeout: 20_000 });
const afterProcessing = expect.configure({ timeout: 90_000 });
const run = promisify(execFile);

let stack: IdentityStack;
let fixtures: string;

test.beforeAll(async () => {
  test.setTimeout(300_000);
  fixtures = await mkdtemp(join(tmpdir(), "teluni-e2e-fixtures-"));
  await run(
    "ffmpeg",
    [
      "-hide_banner",
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=640x360",
      "-frames:v",
      "1",
      join(fixtures, "logo.png"),
    ],
    { timeout: 60_000 },
  );
  stack = await startIdentityStack();
});
test.afterAll(async () => {
  await stack?.stop();
  if (fixtures) await rm(fixtures, { recursive: true, force: true });
});

/** Enrolls a synthetic player and returns the code the panel pairs. */
async function enrollScreen(): Promise<string> {
  const credential = randomBytes(32);
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
        rotations: [0],
      },
    }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { userCode: string }).userCode;
}

test("builds a playlist, schedules a group and previews a screen in it", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const userCode = await enrollScreen();

  await page.goto(`${stack.webUrl}/companies`);
  await page
    .getByRole("main")
    .getByRole("link", { name: "Entrar", exact: true })
    .click();
  await enterCredentials(page, stack.user);
  await afterNavigation(page).toHaveURL(`${stack.webUrl}/companies`);
  await page.getByLabel("Nome da empresa").fill("Programação Central");
  await page.getByRole("button", { name: "Criar empresa" }).click();
  await afterNavigation(page).toHaveURL(/\/companies\/[0-9a-f-]{36}$/);
  const companyUrl = page.url();
  await page.getByLabel("Nome da filial").fill("Centro");
  await page.getByRole("button", { name: "Adicionar filial" }).click();
  await expect(page.getByText("Centro", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Telas", exact: true }).click();
  await afterNavigation(page).toHaveURL(new RegExp(`^${companyUrl}/screens`));
  await page.getByLabel("Código da TV").fill(userCode);
  await page.getByLabel("Nome da tela").fill("Caixa 1");
  await page.getByRole("button", { name: "Parear tela" }).click();
  await expect(page.getByRole("status")).toContainText("Tela pareada.");

  await page.goto(`${companyUrl}/media`);
  await page
    .getByLabel("Arquivos", { exact: true })
    .setInputFiles(join(fixtures, "logo.png"));
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  await afterProcessing(
    page
      .getByRole("listitem")
      .filter({ has: page.getByRole("link", { name: "logo" }) }),
  ).toContainText("Pronta");

  // A company playlist with the image shown for 15 seconds.
  await page.goto(companyUrl);
  await page.getByRole("link", { name: "Programação", exact: true }).click();
  await afterNavigation(page).toHaveURL(`${companyUrl}/programming`);
  await expect(page.getByText("Nenhuma playlist ainda.")).toBeVisible();
  await page.getByLabel("Nome", { exact: true }).fill("Manhã");
  await page.getByRole("button", { name: "Criar", exact: true }).click();
  await afterNavigation(
    page.getByRole("heading", { level: 1, name: "Manhã" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Adicionar logo" }).click();
  await page.getByLabel("Segundos na tela: logo").fill("15");
  await page.getByRole("button", { name: "Salvar itens" }).click();
  await expect(page.getByRole("status")).toContainText("Itens salvos.");
  await expect(page.getByText("1 item · 0:15", { exact: false })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  // A group for the branch, playing the playlist all day, every day.
  await page.getByRole("link", { name: "Voltar para programação" }).click();
  await page.getByRole("link", { name: "Grupos", exact: true }).click();
  await afterNavigation(page).toHaveURL(
    `${companyUrl}/programming?view=groups`,
  );
  await page.getByLabel("Nome", { exact: true }).fill("Vitrines");
  await page.getByLabel("Centro", { exact: true }).check();
  await page.getByRole("button", { name: "Criar", exact: true }).click();
  await afterNavigation(
    page.getByRole("heading", { level: 1, name: "Vitrines" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Adicionar horário" }).click();
  await page.getByLabel("Playlist", { exact: true }).selectOption("Manhã");
  await page.getByLabel("Dia inteiro").check();
  await page
    .getByLabel("Playlist padrão, quando nenhum horário vale")
    .selectOption("Manhã");
  await page.getByRole("button", { name: "Salvar horários" }).click();
  await expect(page.getByRole("status")).toContainText("Horários salvos.");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  // The screen joins the group once its owner accepts the neutral screen.
  await page.goto(`${companyUrl}/screens`);
  await page
    .getByRole("region", { name: "Registros de telas" })
    .getByRole("link", { name: "Caixa 1" })
    .click();
  await page
    .getByRole("link", { name: "Ver a programação desta tela" })
    .click();
  await afterNavigation(
    page.getByRole("heading", { level: 1, name: "Caixa 1" }),
  ).toBeVisible();
  await page.getByLabel("Grupo", { exact: true }).selectOption("Vitrines");
  const save = page.getByRole("button", { name: "Salvar escolha" });
  await expect(save).toBeDisabled();
  await page
    .getByLabel("Confirmo: ainda não há publicação", { exact: false })
    .check();
  await save.click();
  await expect(page.getByRole("status")).toContainText("Escolha salva.");
  await expect(page.getByText("Grupo: Vitrines")).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Manhã", exact: true }).first(),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
