import AxeBuilder from "@axe-core/playwright";
import { execFile } from "node:child_process";
import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import { enterCredentials } from "../identity/provider.ts";
import { startIdentityStack, type IdentityStack } from "../identity/stack.ts";

// Publication through the real panel and API, with the player simulated over
// HTTP: publish a group's programming, put a paired screen in the group, let
// the screen synchronize, verify its statement, manifest and media as the
// player must, report activation and see the panel show the screen up to
// date. Copy is Portuguese.
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
      join(fixtures, "vitrine.png"),
    ],
    { timeout: 60_000 },
  );
  stack = await startIdentityStack();
});
test.afterAll(async () => {
  await stack?.stop();
  if (fixtures) await rm(fixtures, { recursive: true, force: true });
});

/** A synthetic player holding a credential it generated itself. */
function player() {
  const credential = randomBytes(32);
  const headers = {
    authorization: `Bearer ${credential.toString("base64url")}`,
  };
  return {
    async enroll(): Promise<string> {
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
    },
    async sync(report: Record<string, unknown>) {
      const response = await fetch(`${stack.apiUrl}/device/sync`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          protocols: [1],
          appVersion: "0.0.0-e2e",
          active: null,
          recovery: null,
          staging: null,
          playback: "SETUP",
          storage: { freeBytes: 4e9, totalBytes: 8e9 },
          deviceTime: new Date().toISOString(),
          ...report,
        }),
      });
      expect(response.status).toBe(200);
      return (await response.json()) as {
        status: string;
        desired: {
          publicationId: string;
          generation: number;
          manifestSha256: string;
        } | null;
        authorization: string | null;
      };
    },
    async get(path: string): Promise<Buffer> {
      const response = await fetch(`${stack.apiUrl}${path}`, { headers });
      expect(response.status).toBe(200);
      return Buffer.from(await response.arrayBuffer());
    },
  };
}

/** Verifies an ES256 statement against the published key set, as the player must. */
function verifiedClaims(
  statement: string,
  keys: {
    keys: { kid: string; kty: string; crv: string; x: string; y: string }[];
  },
) {
  const [header, payload, signature] = statement.split(".");
  const { alg, kid } = JSON.parse(
    Buffer.from(header, "base64url").toString("utf8"),
  ) as { alg: string; kid: string };
  expect(alg).toBe("ES256");
  const jwk = keys.keys.find((key) => key.kid === kid);
  expect(jwk).toBeDefined();
  const valid = verify(
    "sha256",
    Buffer.from(`${header}.${payload}`, "ascii"),
    {
      key: createPublicKey({ key: jwk!, format: "jwk" }),
      dsaEncoding: "ieee-p1363",
    },
    Buffer.from(signature, "base64url"),
  );
  expect(valid).toBe(true);
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
    exp: number;
    iat: number;
    publications: { id: string; sha256: string }[];
  };
}

test("publishes a group, synchronizes a simulated screen and shows it up to date", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const tv = player();
  const userCode = await tv.enroll();

  await page.goto(`${stack.webUrl}/companies`);
  await page
    .getByRole("main")
    .getByRole("link", { name: "Entrar", exact: true })
    .click();
  await enterCredentials(page, stack.user);
  await afterNavigation(page).toHaveURL(`${stack.webUrl}/companies`);
  await page.getByLabel("Nome da empresa").fill("Publicação Central");
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
    .setInputFiles(join(fixtures, "vitrine.png"));
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  await afterProcessing(
    page
      .getByRole("listitem")
      .filter({ has: page.getByRole("link", { name: "vitrine" }) }),
  ).toContainText("Pronta");

  await page.goto(`${companyUrl}/programming`);
  await page.getByLabel("Nome", { exact: true }).fill("Vitrine");
  await page.getByRole("button", { name: "Criar", exact: true }).click();
  await afterNavigation(
    page.getByRole("heading", { level: 1, name: "Vitrine" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Adicionar vitrine" }).click();
  await page.getByRole("button", { name: "Salvar itens" }).click();
  await expect(page.getByRole("status")).toContainText("Itens salvos.");

  await page.goto(`${companyUrl}/programming?view=groups`);
  await page.getByLabel("Nome", { exact: true }).fill("Lojas");
  await page.getByLabel("Centro", { exact: true }).check();
  await page.getByRole("button", { name: "Criar", exact: true }).click();
  await afterNavigation(
    page.getByRole("heading", { level: 1, name: "Lojas" }),
  ).toBeVisible();
  const groupUrl = page.url();
  await page.getByRole("button", { name: "Adicionar horário" }).click();
  await page.getByLabel("Playlist", { exact: true }).selectOption("Vitrine");
  await page.getByLabel("Dia inteiro").check();
  await page.getByRole("button", { name: "Salvar horários" }).click();
  await expect(page.getByRole("status")).toContainText("Horários salvos.");

  // Review shows what will be published; publishing makes generation 1.
  await expect(
    page.getByText("Nada foi publicado ainda", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Revisar para publicar" }).click();
  await expect(
    page.getByText("1 horário · 1 playlist · 1 item · 1 mídia", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Nenhuma tela segue esta programação agora."),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Publicar agora" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Geração 1 publicada." }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("list", { name: "Gerações publicadas" })
      .getByText("Geração 1"),
  ).toBeVisible();

  // A published destination needs no neutral-screen confirmation.
  await page.goto(`${companyUrl}/screens`);
  await page
    .getByRole("region", { name: "Registros de telas" })
    .getByRole("link", { name: "Caixa 1" })
    .click();
  const screenUrl = page.url();
  await page
    .getByRole("link", { name: "Ver a programação desta tela" })
    .click();
  await page.getByLabel("Grupo", { exact: true }).selectOption("Lojas");
  await expect(
    page.getByText("O destino escolhido tem a geração 1 publicada", {
      exact: false,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Salvar escolha" }).click();
  await expect(page.getByRole("status")).toContainText("Escolha salva.");

  // The screen synchronizes and verifies everything it receives.
  const answer = await tv.sync({});
  expect(answer.status).toBe("active");
  expect(answer.desired?.generation).toBe(1);
  const keys = JSON.parse(
    (await tv.get("/device/keys")).toString("utf8"),
  ) as Parameters<typeof verifiedClaims>[1];
  const claims = verifiedClaims(answer.authorization!, keys);
  expect(claims.publications).toEqual([
    {
      id: answer.desired!.publicationId,
      sha256: answer.desired!.manifestSha256,
    },
  ]);
  expect(claims.exp - claims.iat).toBe(7 * 24 * 60 * 60);
  const manifest = await tv.get(
    `/device/publications/${answer.desired!.publicationId}/manifest`,
  );
  expect(createHash("sha256").update(manifest).digest("hex")).toBe(
    answer.desired!.manifestSha256,
  );
  const content = JSON.parse(manifest.toString("utf8")) as {
    media: { id: string; sha256: string; size: number }[];
  };
  expect(content.media).toHaveLength(1);
  for (const item of content.media) {
    const file = await tv.get(`/device/media/${item.id}`);
    expect(file.length).toBe(item.size);
    expect(createHash("sha256").update(file).digest("hex")).toBe(item.sha256);
  }
  await tv.sync({
    active: {
      publicationId: answer.desired!.publicationId,
      activatedAt: new Date().toISOString(),
    },
    playback: "PLAYING",
    diagnostics: {
      clock: "ANCHORED",
      systemSkewMillis: -120_001,
      crashCount: 2,
    },
  });

  // The panel shows the screen's own acknowledgement.
  await page.goto(screenUrl);
  const sync = page.getByTestId("screen-sync");
  await afterNavigation(sync).toContainText("Atualizada");
  await expect(sync).toContainText("Geração 1");
  await expect(sync).toContainText("Exibindo conteúdo");
  await expect(sync).toContainText("Sincronizada com o servidor");
  await expect(sync).toContainText("Falhas registradas neste pareamento");
  await expect(page.getByRole("status")).toContainText(
    "difere mais de 60 segundos",
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.goto(groupUrl);
  await expect(page.getByText("Conectada · Atualizada")).toBeVisible();
});
