import { afterEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { Catalog, CatalogRecord } from "../src/catalogs/api.js";
import { catalogMessages } from "../src/catalogs/messages.js";
import { formatAmount } from "../src/catalogs/money.js";
import { sessionKey } from "../src/identity/api.js";
import { browserLocale } from "../src/locale.js";
import { ModuleNavigation } from "../src/module-navigation.js";
import { moduleNavigation, routeTree } from "../src/modules.js";
import { shellMessages } from "../src/shell-messages.js";
import { organizationMessages } from "../src/organizations/messages.js";

const companyId = "00000000-0000-4000-8000-000000000001";
const branchA = "00000000-0000-4000-8000-0000000000a1";
const catalogId = "00000000-0000-4000-8000-0000000000c1";
const recordId = "00000000-0000-4000-8000-0000000000d1";
const nameField = "00000000-0000-4000-8000-0000000000f1";
const priceField = "00000000-0000-4000-8000-0000000000f2";
const daysField = "00000000-0000-4000-8000-0000000000f3";
const promotionId = "00000000-0000-4000-8000-0000000000e1";
const base = `/companies/${companyId}/catalogs`;
const locale = browserLocale();
const t = catalogMessages[locale];
const organizations = organizationMessages[locale];

afterEach(() => vi.unstubAllGlobals());

function catalog(overrides: Partial<Catalog> = {}): Catalog {
  return {
    id: catalogId,
    name: "Cardápio",
    branch: null,
    status: "ACTIVE",
    fields: [
      {
        id: nameField,
        label: "Nome",
        type: "text",
        required: true,
        archived: false,
        maxLength: 120,
      },
      {
        id: priceField,
        label: "Preço",
        type: "money",
        required: false,
        archived: false,
        currency: "BRL",
        promotions: true,
      },
      {
        id: daysField,
        label: "Dias",
        type: "weekdays",
        required: false,
        archived: false,
      },
    ],
    recordCount: 1,
    schemaVersion: 1,
    createdAt: "2026-10-20T12:00:00.000Z",
    updatedAt: "2026-10-20T12:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

function record(overrides: Partial<CatalogRecord> = {}): CatalogRecord {
  return {
    id: recordId,
    catalogId,
    title: "Café",
    available: true,
    values: { [nameField]: "Café", [priceField]: 1990 },
    overrides: [],
    media: [],
    references: [],
    createdAt: "2026-10-20T12:00:00.000Z",
    updatedAt: "2026-10-20T12:00:00.000Z",
    version: 2,
    ...overrides,
  };
}

function company(capabilities: string[], afterStrong: string[] = []) {
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
      capabilitiesAfterStrongAuthentication: afterStrong,
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

const manager = [
  "catalogs.view",
  "catalogs.edit",
  "catalogs.manage",
  "prices.edit",
];

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
  if (
    path === `/companies/${companyId}` &&
    matchMedia("(max-width: 760px)").matches
  )
    await screen
      .getByRole("button", { name: shellMessages[locale].menu })
      .click();
  return { screen, router };
}

type Handler = (
  url: URL,
  request: Request,
) => { status?: number; body?: unknown } | undefined;

/** Answers API calls; unanswered company calls get the given access. */
function respond(
  capabilities: string[],
  handler: Handler = () => undefined,
  afterStrong: string[] = [],
) {
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
          : url.pathname.endsWith("/media")
            ? { body: { items: [], nextCursor: null } }
            : url.pathname.endsWith(`/companies/${companyId}`)
              ? { body: company(capabilities, afterStrong) }
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
    .find(
      (input): input is Request =>
        input instanceof Request &&
        input.method === method &&
        new URL(input.url).pathname.endsWith(suffix),
    );
  if (!request) throw new Error(`No ${method} ${suffix} request was sent`);
  return (await request.clone().json()) as unknown;
}

const failure = (code: string, issues: unknown[] = []) => ({
  status: 409,
  body: {
    error: { code, message: "Conflict.", requestId: "req_1", issues },
  },
});

test("links to catalogs from the company page only with catalogs.view", async () => {
  respond(["catalogs.view"]);
  const { screen } = await open(`/companies/${companyId}`);
  await expect
    .element(screen.getByRole("link", { name: organizations.catalogsTitle }))
    .toHaveAttribute("href", base);
});

test("asks for two-step verification when only a stronger session can view catalogs", async () => {
  respond([], undefined, ["catalogs.view"]);
  const { screen } = await open(base);
  await expect
    .element(screen.getByRole("status"))
    .toMatchTextContent(t.stepUpNotice);
});

test("denies the page without catalogs.view", async () => {
  respond(["media.view"]);
  const { screen } = await open(base);
  await expect
    .element(screen.getByRole("alert"))
    .toMatchTextContent(t.errors.PERMISSION_DENIED);
});

test("creates a catalog from the products preset and opens it", async () => {
  respond(manager, (url, request) => {
    if (url.pathname.endsWith("/catalogs"))
      return request.method === "POST"
        ? { status: 201, body: catalog() }
        : { body: { items: [], nextCursor: null } };
    if (url.pathname.endsWith(`/catalogs/${catalogId}`))
      return { body: catalog() };
    if (url.pathname.endsWith(`/catalogs/${catalogId}/records`))
      return { body: { items: [], nextCursor: null } };
    return undefined;
  });
  const { screen, router } = await open(base);
  await screen.getByLabelText(t.fieldName).fill("Cardápio");
  await screen.getByLabelText(t.fieldScope).selectOptions("Centro");
  await screen.getByRole("button", { name: t.create }).click();
  await expect
    .element(screen.getByRole("heading", { level: 1, name: "Cardápio" }))
    .toBeVisible();
  expect(router.state.location.pathname).toBe(`${base}/${catalogId}`);
  const body = (await sent("POST", "/catalogs")) as {
    name: string;
    branchId: string;
    fields: { type: string; currency?: string }[];
  };
  expect(body).toMatchObject({ name: "Cardápio", branchId: branchA });
  expect(body.fields.map((field) => field.type)).toEqual([
    "text",
    "longText",
    "media",
    "selection",
    "money",
  ]);
  expect(body.fields[4].currency).toBe("BRL");
});

test("saves the field list and names the fields that stored items block", async () => {
  respond(manager, (url) => {
    if (url.pathname.endsWith(`/catalogs/${catalogId}/schema`))
      return failure("CATALOG_SCHEMA_INVALID", [
        {
          path: "/fields/3/required",
          reason: "REQUIRED_MISSING_VALUES",
          count: 4,
        },
      ]);
    if (url.pathname.endsWith(`/catalogs/${catalogId}`))
      return { body: catalog() };
    return undefined;
  });
  const { screen } = await open(`${base}/${catalogId}?view=fields`);
  await screen
    .getByLabelText(t.fieldType, { exact: true })
    .last()
    .selectOptions(t.types.boolean);
  await screen.getByRole("button", { name: t.addField }).click();
  const labels = screen.getByLabelText(t.fieldLabel);
  await labels.last().fill("Vegano");
  await screen.getByLabelText(t.required).last().click();
  await screen.getByRole("button", { name: t.saveFields }).click();
  await expect
    .element(screen.getByRole("alert"))
    .toMatchTextContent(
      `Vegano: ${t.issueCount(t.issues.REQUIRED_MISSING_VALUES, 4)}`,
    );
  const body = (await sent("PUT", "/schema")) as {
    expectedVersion: number;
    fields: { id?: string; label: string; type: string; required: boolean }[];
  };
  expect(body.expectedVersion).toBe(1);
  expect(body.fields.map((field) => field.id ?? field.label)).toEqual([
    nameField,
    priceField,
    daysField,
    "Vegano",
  ]);
  expect(body.fields[3]).toMatchObject({ type: "boolean", required: true });
});

test("shows item value problems beside their fields", async () => {
  respond(manager, (url, request) => {
    if (
      url.pathname.endsWith(`/catalogs/${catalogId}/records`) &&
      request.method === "POST"
    )
      return failure("CATALOG_RECORD_INVALID", [
        { path: `/values/${nameField}`, reason: "REQUIRED" },
      ]);
    if (url.pathname.endsWith(`/catalogs/${catalogId}/records`))
      return { body: { items: [record()], nextCursor: null } };
    if (url.pathname.endsWith(`/catalogs/${catalogId}`))
      return { body: catalog() };
    return undefined;
  });
  const { screen } = await open(`${base}/${catalogId}`);
  await expect
    .element(screen.getByRole("link", { name: "Café" }))
    .toHaveAttribute("href", `${base}/${catalogId}/items/${recordId}`);
  await screen.getByLabelText(t.weekdays[0]).click();
  await screen.getByLabelText(t.weekdays[4]).click();
  await screen.getByRole("button", { name: t.addItem }).click();
  await expect
    .element(screen.getByRole("alert"))
    .toMatchTextContent(`Nome: ${t.issues.REQUIRED}`);
  expect(await sent("POST", `/catalogs/${catalogId}/records`)).toEqual({
    values: { [nameField]: null, [daysField]: [1, 5] },
    available: true,
  });
});

test("offers only images that fit the catalog and searches items to refer to", async () => {
  const photoField = "00000000-0000-4000-8000-0000000000f4";
  const linkField = "00000000-0000-4000-8000-0000000000f5";
  const targetId = "00000000-0000-4000-8000-0000000000c2";
  const companyImage = "00000000-0000-4000-8000-0000000000b1";
  const branchImage = "00000000-0000-4000-8000-0000000000b2";
  const withLinks = catalog({
    fields: [
      ...catalog().fields,
      {
        id: photoField,
        label: "Foto",
        type: "media",
        required: false,
        archived: false,
      },
      {
        id: linkField,
        label: "Bebida",
        type: "reference",
        required: false,
        archived: false,
        targetCatalogId: targetId,
      },
    ],
  });
  respond(manager, (url) => {
    if (url.pathname.endsWith("/media"))
      return {
        body: {
          items: [
            { id: companyImage, name: "Logo", branch: null },
            {
              id: branchImage,
              name: "Fachada",
              branch: { id: branchA, name: "Centro" },
            },
          ],
          nextCursor: null,
        },
      };
    if (url.pathname.endsWith(`/catalogs/${targetId}/records`))
      return {
        body: {
          items: [
            record({
              id: "00000000-0000-4000-8000-0000000000d9",
              catalogId: targetId,
              title: url.searchParams.get("text") ? "Suco de uva" : "Água",
            }),
          ],
          nextCursor: null,
        },
      };
    if (url.pathname.endsWith(`/catalogs/${catalogId}/records`))
      return { body: { items: [], nextCursor: null } };
    if (url.pathname.endsWith(`/catalogs/${catalogId}`))
      return { body: withLinks };
    return undefined;
  });
  const { screen } = await open(`${base}/${catalogId}`);
  const photo = screen.getByLabelText("Foto", { exact: true });
  await expect
    .element(photo.getByRole("option", { name: "Logo" }))
    .toBeInTheDocument();
  await expect
    .element(photo.getByRole("option", { name: "Fachada" }))
    .not.toBeInTheDocument();
  const mediaRequest = vi
    .mocked(fetch)
    .mock.calls.map(([input]) => input)
    .find(
      (input): input is Request =>
        input instanceof Request &&
        new URL(input.url).pathname.endsWith("/media"),
    );
  expect(new URL(mediaRequest!.url).searchParams.get("scope")).toBe("company");
  const drink = screen.getByLabelText("Bebida", { exact: true });
  await expect
    .element(drink.getByRole("option", { name: "Água" }))
    .toBeInTheDocument();
  await screen
    .getByRole("searchbox", { name: `${t.searchRecords}: Bebida` })
    .fill("uva");
  await expect
    .element(drink.getByRole("option", { name: "Suco de uva" }))
    .toBeInTheDocument();
});

test("saves prices in the person's locale and previews the price in effect", async () => {
  let current = record();
  respond(manager, (url, request) => {
    const path = url.pathname;
    if (path.endsWith(`/prices/${priceField}/promotions`))
      return request.method === "POST"
        ? failure("CATALOG_PROMOTION_CONFLICT")
        : {
            body: {
              items: [
                {
                  id: promotionId,
                  fieldId: priceField,
                  branch: null,
                  amount: 1490,
                  startsAt: "2026-11-07T00:00",
                  endsAt: "2026-11-09T00:00",
                  createdAt: "2026-10-20T12:00:00.000Z",
                },
              ],
            },
          };
    if (path.endsWith(`/prices/${priceField}/branches/${branchA}`)) {
      current = record({
        version: 4,
        values: { [nameField]: "Café", [priceField]: 2190 },
        overrides: [
          {
            fieldId: priceField,
            branch: { id: branchA, name: "Centro" },
            amount: 1790,
          },
        ],
      });
      return { body: current };
    }
    if (path.endsWith(`/prices/${priceField}`)) {
      current = record({
        version: 3,
        values: { [nameField]: "Café", [priceField]: 2190 },
      });
      return { body: current };
    }
    if (path.endsWith("/effective-prices"))
      return {
        body: {
          at: url.searchParams.get("at"),
          fields: [
            {
              fieldId: priceField,
              currency: "BRL",
              scope: { amount: 1490, source: "promotion", promotionId },
              branches: [],
            },
          ],
        },
      };
    if (path.endsWith("/price-publications")) return { body: { items: [] } };
    if (path.endsWith(`/records/${recordId}`)) return { body: current };
    if (path.endsWith(`/catalogs/${catalogId}/records`))
      return { body: { items: [current], nextCursor: null } };
    if (path.endsWith(`/catalogs/${catalogId}`)) return { body: catalog() };
    return undefined;
  });
  const { screen } = await open(`${base}/${catalogId}/items/${recordId}`);
  await expect
    .element(screen.getByRole("heading", { level: 1, name: "Café" }))
    .toBeVisible();
  const decimal = locale === "pt-BR" ? "," : ".";
  await screen
    .getByRole("textbox", { name: t.basePrice })
    .fill(`21${decimal}9`);
  await screen
    .getByRole("form", { name: t.basePrice })
    .getByRole("button", { name: t.save })
    .click();
  await expect
    .element(screen.getByText(formatAmount(2190, "BRL", locale)).first())
    .toBeVisible();
  await expect.element(screen.getByRole("status")).toHaveTextContent(t.saved);
  expect(await sent("PUT", `/prices/${priceField}`)).toEqual({
    expectedVersion: 2,
    amount: 2190,
  });
  await screen
    .getByRole("textbox", { name: t.branchPrice("Centro") })
    .fill(`17${decimal}90`);
  await screen
    .getByRole("form", { name: t.branchPrice("Centro") })
    .getByRole("button", { name: t.save })
    .click();
  await expect
    .element(screen.getByText(formatAmount(1790, "BRL", locale)).first())
    .toBeVisible();
  expect(await sent("PUT", `/branches/${branchA}`)).toEqual({
    expectedVersion: 3,
    amount: 1790,
  });
  // Amounts with more decimals than the currency stay local.
  await screen
    .getByRole("textbox", { name: t.basePrice })
    .fill(`1${decimal}999`);
  await expect.element(screen.getByText(t.amountInvalid)).toBeVisible();
  // Promotions: the server's conflict is shown.
  await screen.getByLabelText(t.amountLabel("BRL")).fill(`9${decimal}9`);
  await screen.getByLabelText(t.promotionStart).fill("2026-11-08T10:00");
  await screen.getByLabelText(t.promotionEnd).fill("2026-11-08T12:00");
  await screen.getByRole("button", { name: t.addPromotion }).click();
  await expect
    .element(
      screen.getByText(t.errors.CATALOG_PROMOTION_CONFLICT, { exact: false }),
    )
    .toBeVisible();
  expect(await sent("POST", "/promotions")).toEqual({
    branchId: null,
    amount: 990,
    startsAt: "2026-11-08T10:00",
    endsAt: "2026-11-08T12:00",
  });
  await expect
    .element(
      screen.getByText(
        `${formatAmount(1490, "BRL", locale)} (${t.sources.promotion})`,
        { exact: false },
      ),
    )
    .toBeVisible();
});

test("shows what price changes did on screens and authorizes blocked ones again", async () => {
  const p = t.pricePublications;
  const blocked = "00000000-0000-4000-8000-0000000000b1";
  const intent = (overrides: Record<string, unknown>) => ({
    id: "00000000-0000-4000-8000-0000000000b2",
    state: "published",
    reason: null,
    target: {
      kind: "group",
      id: "00000000-0000-4000-8000-0000000000a5",
      name: "Lojas",
    },
    priceSequence: 3,
    generation: null,
    authorIsCaller: false,
    reauthorized: false,
    attempts: 1,
    createdAt: "2026-10-21T12:00:00.000Z",
    updatedAt: "2026-10-21T12:00:05.000Z",
    ...overrides,
  });
  let retried = false;
  respond([...manager, "publications.publish"], (url, request) => {
    const path = url.pathname;
    if (path.endsWith(`/price-publications/${blocked}/retry`)) {
      retried = true;
      return {
        body: intent({ id: blocked, state: "pending", reauthorized: true }),
      };
    }
    if (path.endsWith("/price-publications"))
      return {
        body: {
          items: [
            intent({
              id: blocked,
              state: retried ? "pending" : "blocked",
              reason: retried ? null : "AUTHOR_NOT_AUTHORIZED",
              reauthorized: retried,
            }),
            intent({
              state: "published",
              generation: 4,
              authorIsCaller: true,
              target: {
                kind: "device",
                id: "00000000-0000-4000-8000-0000000000d9",
                name: "Caixa",
              },
            }),
            intent({
              id: "00000000-0000-4000-8000-0000000000b3",
              state: "failed",
              reason: "CATALOG_OVERFLOW",
              target: null,
            }),
          ],
        },
      };
    if (path.endsWith(`/prices/${priceField}`) && request.method === "PUT")
      return {
        status: 403,
        body: {
          error: {
            code: "PRICE_TARGET_FORBIDDEN",
            message: "Forbidden.",
            requestId: "req_1",
          },
        },
      };
    if (path.endsWith(`/prices/${priceField}/promotions`))
      return { body: { items: [] } };
    if (path.endsWith("/effective-prices"))
      return {
        body: { at: url.searchParams.get("at"), fields: [] },
      };
    if (path.endsWith(`/records/${recordId}`)) return { body: record() };
    if (path.endsWith(`/catalogs/${catalogId}`)) return { body: catalog() };
    return undefined;
  });
  const { screen } = await open(`${base}/${catalogId}/items/${recordId}`);
  const text = (item: { query(): Element | null }) =>
    item.query()?.textContent ?? "";
  const list = screen.getByRole("list", { name: p.title });
  const lojas = list
    .getByRole("listitem")
    .filter({ hasText: p.group("Lojas") });
  await expect.poll(() => text(lojas)).toContain(p.states.blocked());
  await expect
    .poll(() => text(lojas))
    .toContain(p.reasons.AUTHOR_NOT_AUTHORIZED);
  const caixa = list
    .getByRole("listitem")
    .filter({ hasText: p.device("Caixa") });
  await expect.poll(() => text(caixa)).toContain(p.states.published(4));
  await expect.poll(() => text(caixa)).toContain(p.byYou);
  const hidden = list.getByRole("listitem").filter({ hasText: p.hidden });
  await expect.poll(() => text(hidden)).toContain(p.reasons.CATALOG_OVERFLOW);
  await expect
    .element(caixa.getByRole("button", { name: p.retry }))
    .not.toBeInTheDocument();
  await lojas.getByRole("button", { name: p.retry }).click();
  await expect.element(screen.getByText(p.retried)).toBeVisible();
  await expect.poll(() => text(lojas)).toContain(p.states.pending());
  // A price that screens show through a program the person cannot publish.
  const decimal = locale === "pt-BR" ? "," : ".";
  await screen
    .getByRole("textbox", { name: t.basePrice })
    .fill(`21${decimal}9`);
  await screen
    .getByRole("form", { name: t.basePrice })
    .getByRole("button", { name: t.save })
    .click();
  await expect
    .element(screen.getByText(t.errors.PRICE_TARGET_FORBIDDEN))
    .toBeVisible();
});
