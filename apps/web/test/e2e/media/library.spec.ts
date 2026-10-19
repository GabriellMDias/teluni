import AxeBuilder from "@axe-core/playwright";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import { enrollAuthenticator, enterCredentials } from "../identity/provider.ts";
import { startIdentityStack, type IdentityStack } from "../identity/stack.ts";

// The media library through the real panel and API with real FFmpeg:
// upload an image and a video, wait until both are prepared, preview them,
// archive, move to the trash and restore. Copy is Portuguese.
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
  const ffmpeg = (args: string[]) =>
    run("ffmpeg", ["-hide_banner", "-v", "error", "-y", ...args], {
      timeout: 60_000,
    });
  await ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=640x360",
    "-frames:v",
    "1",
    join(fixtures, "logo.png"),
  ]);
  await ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=320x240:rate=30",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000",
    "-t",
    "2",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    join(fixtures, "vitrine.mp4"),
  ]);
  stack = await startIdentityStack();
});
test.afterAll(async () => {
  await stack?.stop();
  if (fixtures) await rm(fixtures, { recursive: true, force: true });
});

test("uploads, prepares, previews, archives, trashes and restores media", async ({
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
  await page.getByLabel("Nome da empresa").fill("Mídia Central");
  await page.getByRole("button", { name: "Criar empresa" }).click();
  await afterNavigation(page).toHaveURL(/\/companies\/[0-9a-f-]{36}$/);
  const companyUrl = page.url();
  await page.getByRole("link", { name: "Verificar em duas etapas" }).click();
  await enrollAuthenticator(page);
  await afterNavigation(page).toHaveURL(companyUrl);

  await page.getByRole("link", { name: "Mídia", exact: true }).click();
  await afterNavigation(page).toHaveURL(`${companyUrl}/media`);
  await expect(page.getByText("Nenhuma mídia aqui ainda.")).toBeVisible();
  await page
    .getByLabel("Arquivos")
    .setInputFiles([join(fixtures, "logo.png"), join(fixtures, "vitrine.mp4")]);
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  await expect(
    page.getByText("Enviado. Preparando para as telas."),
  ).toHaveCount(2, { timeout: 60_000 });

  // The list refreshes itself until both items are prepared.
  const logo = page.getByRole("listitem").filter({ hasText: "logo" });
  const video = page.getByRole("listitem").filter({ hasText: "vitrine" });
  await afterProcessing(logo).toContainText("Pronta");
  await afterProcessing(video).toContainText("Pronta");
  await expect(video).toContainText("0:02");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  // The video's display rendition streams with ranges from the same origin.
  await video.getByRole("link").click();
  await afterNavigation(
    page.getByRole("heading", { name: "vitrine" }),
  ).toBeVisible();
  const source = await page.locator("video").getAttribute("src");
  expect(source).toMatch(/\/content\?variant=display$/);
  const ranged = await page.request.get(`${stack.webUrl}${source}`, {
    headers: { range: "bytes=0-99" },
  });
  expect(ranged.status()).toBe(206);
  expect(ranged.headers()["content-type"]).toBe("video/mp4");
  expect(ranged.headers()["x-content-type-options"]).toBe("nosniff");
  expect((await ranged.body()).length).toBe(100);

  await page.getByRole("link", { name: "Voltar para mídia" }).click();
  await page.getByRole("link", { name: "logo" }).click();
  await afterNavigation(
    page.getByRole("heading", { name: "logo" }),
  ).toBeVisible();
  const preview = page.getByRole("img", { name: "logo" });
  await expect(preview).toBeVisible();
  await expect
    .poll(() =>
      preview.evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBe(640);

  await page.getByRole("button", { name: "Arquivar" }).click();
  await expect(page.getByRole("status")).toContainText("Mídia arquivada.");
  const remove = page.getByRole("button", { name: "Mover para a lixeira" });
  await expect(remove).toBeDisabled();
  await page
    .getByLabel("Confirmo que quero mover “logo” para a lixeira.")
    .check();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await remove.click();
  await expect(page.getByRole("status")).toContainText(
    "Mídia movida para a lixeira.",
  );

  await page.getByRole("link", { name: "Voltar para mídia" }).click();
  await page.getByRole("link", { name: "Lixeira" }).click();
  await afterNavigation(page).toHaveURL(`${companyUrl}/media?view=trash`);
  await page.getByRole("link", { name: "logo" }).click();
  await expect(page.getByText("Exclusão definitiva em")).toBeVisible();
  await page.getByRole("button", { name: "Restaurar da lixeira" }).click();
  await expect(page.getByRole("status")).toContainText("Mídia restaurada.");
  await expect(
    page.getByRole("button", { name: "Restaurar", exact: true }),
  ).toBeVisible();
});
