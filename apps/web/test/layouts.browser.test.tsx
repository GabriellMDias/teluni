import { afterEach, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { sessionKey } from "../src/identity/api.js";
import { browserLocale } from "../src/locale.js";
import { ModuleNavigation } from "../src/module-navigation.js";
import { moduleNavigation, routeTree } from "../src/modules.js";
import type { Layout, LayoutSummary } from "../src/programming/api.js";
import { programmingMessages } from "../src/programming/messages.js";

// The layouts section of programming (D-11 increment 2) against a stubbed
// API: list, creation and import, the editor's areas, catalog views and
// pages, issues by area and page, the fit report and export.

const companyId = "00000000-0000-4000-8000-000000000001";
const branchA = "00000000-0000-4000-8000-0000000000a1";
const layoutId = "00000000-0000-4000-8000-0000000000b1";
const catalogId = "00000000-0000-4000-8000-0000000000c1";
const titleField = "00000000-0000-4000-8000-0000000000c2";
const priceField = "00000000-0000-4000-8000-0000000000c3";
const roomField = "00000000-0000-4000-8000-0000000000c4";
const roomOne = "00000000-0000-4000-8000-0000000000c5";
const imageId = "00000000-0000-4000-8000-0000000000e1";
const recordId = "00000000-0000-4000-8000-0000000000f1";
const base = `/companies/${companyId}/programming`;
const locale = browserLocale();
const t = programmingMessages[locale];
const l = t.layouts;

afterEach(() => vi.unstubAllGlobals());

const mainArea: Layout["areas"][number] = {
  key: "main",
  name: "Principal",
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
  z: 0,
  background: "#000000",
  fit: "contain",
  muted: true,
  volume: 100,
  kind: "media",
  pageControlled: false,
  view: null,
};

function layout(overrides: Partial<Layout> = {}): Layout {
  return {
    id: layoutId,
    name: "Vitrine",
    branch: null,
    orientation: "landscape",
    canvas: { width: 1920, height: 1080 },
    audioMixConfirmed: false,
    areas: [mainArea],
    pages: [],
    fit: [],
    createdAt: "2026-10-20T12:00:00.000Z",
    updatedAt: "2026-10-20T12:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

const summary: LayoutSummary = {
  id: layoutId,
  name: "Vitrine",
  branch: null,
  orientation: "landscape",
  areaCount: 2,
  pageCount: 0,
  createdAt: "2026-10-20T12:00:00.000Z",
  updatedAt: "2026-10-20T12:00:00.000Z",
  version: 1,
};

const catalog = {
  id: catalogId,
  name: "Cardápio",
  branch: null,
  status: "ACTIVE",
  fields: [
    {
      id: titleField,
      label: "Nome",
      type: "text",
      required: true,
      archived: false,
    },
    {
      id: priceField,
      label: "Preço",
      type: "money",
      required: false,
      archived: false,
      currency: "BRL",
    },
    {
      id: roomField,
      label: "Sala",
      type: "selection",
      required: false,
      archived: false,
      choices: [{ id: roomOne, label: "Sala 1" }],
    },
  ],
  recordCount: 1,
  createdAt: "2026-10-20T12:00:00.000Z",
  updatedAt: "2026-10-20T12:00:00.000Z",
  version: 1,
};

function company(capabilities: string[]) {
  return {
    company: {
      id: companyId,
      displayName: "Synthetic company",
      timeZone: "America/Sao_Paulo",
    },
    access: {
      roles: ["COMPANY_ADMINISTRATOR"],
      profiles: [],
      responsible: true,
      capabilities: ["company.view", "branches.view", ...capabilities],
    },
    responsibilityTransfer: null,
  };
}

const branches = {
  items: [
    {
      id: branchA,
      name: "Centro",
      timeZone: "America/Sao_Paulo",
      status: "ACTIVE",
      version: 1,
    },
  ],
  nextCursor: null,
};

const editor = ["programming.view", "programming.edit", "catalogs.view"];

async function open(path: string) {
  vi.stubGlobal("__PROJECT_NAME__", "Teluni");
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(sessionKey, {
    principalId: "synthetic",
    state: "ACTIVE",
  });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  const screen = await render(
    <QueryClientProvider client={client}>
      <ModuleNavigation value={moduleNavigation}>
        <RouterProvider router={router} />
      </ModuleNavigation>
    </QueryClientProvider>,
  );
  return { screen, router };
}

type Handler = (
  url: URL,
  request: Request,
) => { status?: number; body?: unknown } | undefined;

/** Answers API calls; unanswered company calls get the given access. */
function respond(capabilities: string[], handler: Handler = () => undefined) {
  const fetchOriginal = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request =
        input instanceof Request ? input : new Request(String(input), init);
      const url = new URL(request.url, location.href);
      if (!url.pathname.startsWith("/api/")) return fetchOriginal(input, init);
      const answer =
        handler(url, request) ??
        (url.pathname.endsWith("/branches")
          ? { body: branches }
          : url.pathname.endsWith("/catalogs")
            ? { body: { items: [catalog], nextCursor: null } }
            : url.pathname.endsWith(`/catalogs/${catalogId}`)
              ? { body: catalog }
              : url.pathname.endsWith("/media")
                ? {
                    body: {
                      items: [
                        {
                          id: imageId,
                          name: "Promoção",
                          kind: "IMAGE",
                          status: "READY",
                          branch: null,
                          version: 1,
                        },
                      ],
                      nextCursor: null,
                    },
                  }
                : url.pathname.endsWith(`/companies/${companyId}`)
                  ? { body: company(capabilities) }
                  : {
                      status: 404,
                      body: { error: { code: "RESOURCE_NOT_FOUND" } },
                    });
      const { status = 200, body } = answer;
      return new Response(status === 204 ? null : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

async function sent(method: string, suffix: string) {
  const request = vi
    .mocked(fetch)
    .mock.calls.map(([input]) => input)
    .findLast(
      (input): input is Request =>
        input instanceof Request &&
        input.method === method &&
        new URL(input.url).pathname.endsWith(suffix),
    );
  if (!request) throw new Error(`No ${method} ${suffix} request was sent`);
  return (await request.clone().json()) as unknown;
}

const sentCount = (method: string, suffix: string) =>
  vi
    .mocked(fetch)
    .mock.calls.filter(
      ([input]) =>
        input instanceof Request &&
        input.method === method &&
        new URL(input.url).pathname.endsWith(suffix),
    ).length;

test("lists layouts for viewers without the create and import forms", async () => {
  respond(["programming.view"], (url) =>
    url.pathname.endsWith("/programming/layouts")
      ? { body: { items: [summary], nextCursor: null } }
      : undefined,
  );
  const { screen } = await open(`${base}?view=layouts`);
  await expect
    .element(screen.getByRole("link", { name: "Vitrine" }))
    .toHaveAttribute("href", `${base}/layouts/${layoutId}`);
  await expect
    .element(screen.getByText(l.summary(2, 0), { exact: false }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("heading", { name: l.createTitle }))
    .not.toBeInTheDocument();
  await expect
    .element(screen.getByRole("heading", { name: l.importTitle }))
    .not.toBeInTheDocument();
});

test("creates a portrait layout with one full-canvas area and opens it", async () => {
  respond(editor, (url, request) => {
    if (url.pathname.endsWith("/programming/layouts"))
      return request.method === "POST"
        ? {
            status: 201,
            body: layout({ branch: { id: branchA, name: "Centro" } }),
          }
        : { body: { items: [], nextCursor: null } };
    if (url.pathname.endsWith(`/layouts/${layoutId}`))
      return { body: layout({ branch: { id: branchA, name: "Centro" } }) };
    return undefined;
  });
  const { screen, router } = await open(`${base}?view=layouts`);
  await screen.getByLabelText(t.fieldName, { exact: true }).fill("Vitrine");
  await screen
    .getByLabelText(t.fieldScope, { exact: true })
    .first()
    .selectOptions("Centro");
  await screen
    .getByLabelText(l.orientationLabel)
    .selectOptions(l.orientations.portrait);
  await screen.getByRole("button", { name: t.create }).click();
  await expect
    .element(screen.getByRole("heading", { level: 1, name: "Vitrine" }))
    .toBeVisible();
  expect(router.state.location.pathname).toBe(`${base}/layouts/${layoutId}`);
  expect(await sent("POST", "/programming/layouts")).toEqual({
    name: "Vitrine",
    branchId: branchA,
    definition: {
      orientation: "portrait",
      areas: [
        {
          key: "main",
          name: l.firstAreaName,
          x: 0,
          y: 0,
          width: 1080,
          height: 1920,
          z: 0,
          kind: "media",
        },
      ],
    },
  });
});

test("imports an exported file and refuses one that is not JSON", async () => {
  respond(editor, (url, request) => {
    if (url.pathname.endsWith("/programming/layouts"))
      return { body: { items: [], nextCursor: null } };
    if (url.pathname.endsWith("/layouts/import") && request.method === "POST")
      return {
        status: 409,
        body: {
          error: {
            code: "LAYOUT_INVALID",
            message: "The layout cannot be saved this way.",
            requestId: "request-1",
            issues: [
              {
                path: "/document/areas/0/view/catalogId",
                reason: "CATALOG_UNAVAILABLE",
              },
            ],
          },
        },
      };
    return undefined;
  });
  const { screen } = await open(`${base}?view=layouts`);
  const file = screen.getByLabelText(l.importFile);
  await file.upload(
    new File(["not json"], "vitrine.json", { type: "application/json" }),
  );
  await screen.getByRole("button", { name: l.import }).click();
  await expect.element(screen.getByText(l.importUnreadable)).toBeVisible();
  expect(sentCount("POST", "/layouts/import")).toBe(0);
  const document = {
    format: "teluni.layout",
    schema: 1,
    name: "Vitrine",
    orientation: "landscape",
    audioMixConfirmed: false,
    areas: [{ ...mainArea, name: "Cardápio" }],
    pages: [],
  };
  await file.upload(
    new File([JSON.stringify(document)], "vitrine.json", {
      type: "application/json",
    }),
  );
  await screen
    .getByLabelText(t.fieldScope, { exact: true })
    .nth(1)
    .selectOptions("Centro");
  await screen.getByRole("button", { name: l.import }).click();
  await expect
    .element(screen.getByRole("alert"))
    .toMatchTextContent(
      `${l.selectedTitle("Cardápio")}: ${l.issues.CATALOG_UNAVAILABLE}`,
    );
  expect(await sent("POST", "/layouts/import")).toEqual({
    branchId: branchA,
    document,
  });
});

test("adds a catalog area with a menu view, moves it by keyboard and saves", async () => {
  let current = layout();
  respond(editor, (url, request) => {
    if (url.pathname.endsWith(`/layouts/${layoutId}`)) {
      if (request.method === "PATCH")
        current = layout({ version: 2, name: "Vitrine nova" });
      return { body: current };
    }
    if (url.pathname.endsWith("/programming/layouts"))
      return { body: { items: [summary], nextCursor: null } };
    return undefined;
  });
  const { screen } = await open(`${base}/layouts/${layoutId}`);
  await screen
    .getByLabelText(t.fieldName, { exact: true })
    .fill("Vitrine nova");
  await screen.getByRole("button", { name: l.addCatalogArea }).click();
  await screen.getByLabelText(l.areaName, { exact: true }).fill("Cardápio");
  await screen.getByLabelText(l.areaKey, { exact: true }).fill("menu");
  await screen
    .getByLabelText(l.catalog, { exact: true })
    .selectOptions("Cardápio");
  await screen.getByRole("button", { name: l.addField }).click();
  await screen.getByRole("button", { name: l.addField }).click();
  await expect
    .element(screen.getByLabelText(l.fieldPosition(2)))
    .toHaveValue(priceField);
  await screen
    .getByLabelText(l.presentation)
    .selectOptions(l.presentations.menu);
  await screen.getByLabelText(l.textSize).fill("48");
  // The selected area moves 10 units right and grows 10 units down.
  await screen
    .getByRole("button", {
      name: l.areaButton("Cardápio", l.kinds.catalog),
    })
    .click();
  await userEvent.keyboard("{ArrowRight}{Shift>}{ArrowDown}{/Shift}");
  await expect
    .element(screen.getByLabelText(l.x, { exact: true }))
    .toHaveValue(730);
  await expect
    .element(screen.getByLabelText(l.height, { exact: true }))
    .toHaveValue(280);
  await screen.getByRole("button", { name: l.saveLayout }).click();
  await expect
    .element(screen.getByRole("status"))
    .toMatchTextContent(l.layoutSaved);
  expect(await sent("PATCH", `/layouts/${layoutId}`)).toEqual({
    expectedVersion: 1,
    name: "Vitrine nova",
    definition: {
      orientation: "landscape",
      audioMixConfirmed: false,
      areas: [
        mainArea,
        {
          key: "menu",
          name: "Cardápio",
          x: 730,
          y: 410,
          width: 480,
          height: 280,
          z: 1,
          background: "#000000",
          fit: "contain",
          muted: true,
          volume: 100,
          kind: "catalog",
          pageControlled: false,
          view: {
            catalogId,
            fields: [
              { fieldId: titleField, role: "title" },
              { fieldId: priceField, role: "price" },
            ],
            presentation: "menu",
            textSize: 48,
            unavailable: "hide",
            pageSeconds: 10,
          },
        },
      ],
      pages: [],
    },
  });
});

test("coordinates pages, confirms the audio mix and names issues by area and page", async () => {
  const menuArea: Layout["areas"][number] = {
    ...mainArea,
    key: "menu",
    name: "Cardápio",
    x: 1280,
    width: 640,
    z: 1,
    kind: "catalog",
    view: {
      catalog: { id: catalogId, name: "Cardápio" },
      fields: [
        { fieldId: titleField, role: "title", label: "Nome", type: "text" },
        { fieldId: roomField, role: "group", label: "Sala", type: "selection" },
      ],
      presentation: "list",
      textSize: 40,
      unavailable: "hide",
      pageSeconds: 10,
    },
  };
  respond(editor, (url, request) => {
    if (url.pathname.endsWith(`/layouts/${layoutId}`))
      return request.method === "PATCH"
        ? {
            status: 409,
            body: {
              error: {
                code: "LAYOUT_INVALID",
                message: "The layout cannot be saved this way.",
                requestId: "request-2",
                issues: [
                  { path: "/areas/1", reason: "OUTSIDE_CANVAS" },
                  {
                    path: "/pages/1/durationSeconds",
                    reason: "PAGE_SHORTER_THAN_VIDEO",
                  },
                ],
              },
            },
          }
        : {
            body: layout({
              areas: [
                { ...mainArea, width: 1280 },
                menuArea,
                {
                  ...mainArea,
                  key: "music",
                  name: "Música",
                  width: 40,
                  height: 40,
                  z: 2,
                  muted: false,
                },
              ],
            }),
          };
    return undefined;
  });
  const { screen } = await open(`${base}/layouts/${layoutId}`);
  // Two audible areas need the mix confirmed.
  await screen
    .getByRole("button", { name: l.areaButton("Principal", l.kinds.media) })
    .click();
  await screen.getByLabelText(l.muted, { exact: true }).click();
  await expect
    .element(screen.getByText(l.audioAreas("Principal, Música")))
    .toBeVisible();
  await screen.getByLabelText(l.audioMix).click();
  await screen.getByLabelText(l.pageControlled).click();
  await screen
    .getByRole("button", { name: l.areaButton("Cardápio", l.kinds.catalog) })
    .click();
  await screen.getByLabelText(l.pageControlled).click();
  await screen.getByRole("button", { name: l.addPage }).click();
  await expect
    .element(screen.getByRole("heading", { name: l.pageTitle(2) }))
    .toBeVisible();
  for (const page of [1, 2]) {
    const label = `${l.pageTitle(page)} · Principal`;
    await screen
      .getByRole("button", { name: `${l.chooseMedia}: ${label}` })
      .click();
    await screen.getByRole("button", { name: l.useMedia("Promoção") }).click();
  }
  await screen
    .getByLabelText(l.content(`${l.pageTitle(2)} · Cardápio`))
    .selectOptions(l.contentModes.group);
  await screen
    .getByLabelText(l.group(`${l.pageTitle(2)} · Cardápio`))
    .selectOptions("Sala 1");
  await screen
    .getByLabelText(`${l.pageTitle(2)}: ${l.pageDuration}`)
    .fill("20");
  await screen.getByRole("button", { name: l.saveLayout }).click();
  const alert = screen.getByRole("alert");
  await expect
    .element(alert)
    .toMatchTextContent(
      `${l.selectedTitle("Cardápio")}: ${l.issues.OUTSIDE_CANVAS}`,
    );
  await expect
    .element(alert)
    .toMatchTextContent(
      `${l.pageTitle(2)}: ${l.issues.PAGE_SHORTER_THAN_VIDEO}`,
    );
  await expect
    .element(screen.getByText(l.issues.OUTSIDE_CANVAS, { exact: true }))
    .toBeVisible();
  const body = (await sent("PATCH", `/layouts/${layoutId}`)) as {
    definition: { audioMixConfirmed: boolean; pages: unknown[] };
  };
  expect(body.definition.audioMixConfirmed).toBe(true);
  expect(body.definition.pages).toEqual([
    {
      durationSeconds: 10,
      contents: [
        { areaKey: "main", mediaAssetId: imageId },
        { areaKey: "menu", viewPage: 1 },
      ],
    },
    {
      durationSeconds: 20,
      contents: [
        { areaKey: "main", mediaAssetId: imageId },
        { areaKey: "menu", groupChoiceId: roomOne },
      ],
    },
  ]);
});

test("asks to confirm removing an area whose schedules programs would lose", async () => {
  const side: Layout["areas"][number] = {
    ...mainArea,
    key: "side",
    name: "Lateral",
    width: 640,
    z: 1,
  };
  let current = layout({ areas: [{ ...mainArea, width: 1280 }, side] });
  respond(editor, (url, request) => {
    if (url.pathname.endsWith(`/layouts/${layoutId}`)) {
      if (request.method !== "PATCH") return { body: current };
      return sentCount("PATCH", `/layouts/${layoutId}`) === 1
        ? {
            status: 409,
            body: {
              error: {
                code: "LAYOUT_CHANGE_CONFIRMATION_REQUIRED",
                message: "Confirm.",
                requestId: "request-3",
                issues: [
                  { path: "/outputs/side", reason: "OUTPUT_REMOVED", count: 2 },
                ],
              },
            },
          }
        : { body: (current = layout({ version: 2 })) };
    }
    return undefined;
  });
  const { screen } = await open(`${base}/layouts/${layoutId}`);
  await screen
    .getByRole("button", { name: l.areaButton("Lateral", l.kinds.media) })
    .click();
  await screen.getByRole("button", { name: l.removeArea }).click();
  await screen.getByRole("button", { name: l.saveLayout }).click();
  await expect
    .element(screen.getByRole("alert"))
    .toMatchTextContent(
      `${l.selectedTitle("Lateral")}: ${l.programsLoseOutput(2)}`,
    );
  await expect
    .element(screen.getByRole("button", { name: l.saveLayout }))
    .toBeDisabled();
  await screen.getByLabelText(l.confirmRemoval).click();
  await screen.getByRole("button", { name: l.saveLayout }).click();
  await expect
    .element(screen.getByRole("status"))
    .toMatchTextContent(l.layoutSaved);
  expect(await sent("PATCH", `/layouts/${layoutId}`)).toMatchObject({
    expectedVersion: 1,
    confirmRemovedOutputs: true,
    definition: { areas: [{ key: "main" }] },
  });
});

test("shows viewers the canvas and the fit report, and exports the file", async () => {
  respond(["programming.view"], (url) => {
    if (url.pathname.endsWith(`/layouts/${layoutId}/export`))
      return {
        body: {
          format: "teluni.layout",
          schema: 1,
          name: "Vitrine",
          orientation: "landscape",
          audioMixConfirmed: false,
          areas: [mainArea],
          pages: [],
        },
      };
    if (url.pathname.endsWith(`/layouts/${layoutId}`))
      return {
        body: layout({
          fit: [
            {
              areaKey: "main",
              pages: 2,
              records: 25,
              rowsPerPage: 20,
              overflow: [
                {
                  recordId,
                  title: "Hambúrguer artesanal duplo",
                  reason: "TITLE_OVERFLOW",
                },
              ],
            },
          ],
        }),
      };
    return undefined;
  });
  const { screen } = await open(`${base}/layouts/${layoutId}`);
  await expect
    .element(screen.getByRole("group", { name: l.canvasLabel("Vitrine") }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: l.saveLayout }))
    .not.toBeInTheDocument();
  await expect.element(screen.getByText(l.fitSummary(25, 2, 20))).toBeVisible();
  await expect
    .element(
      screen.getByText(
        `Hambúrguer artesanal duplo: ${l.overflow.TITLE_OVERFLOW}`,
      ),
    )
    .toBeVisible();
  await screen.getByRole("button", { name: l.export }).click();
  await expect
    .element(screen.getByRole("status"))
    .toMatchTextContent(l.exported);
  expect(sentCount("GET", `/layouts/${layoutId}/export`)).toBe(1);
});
