import { afterEach, expect, test, vi } from "vitest";
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
import { organizationMessages } from "../src/organizations/messages.js";
import { branchesKey } from "../src/organizations/api.js";

const companyId = "00000000-0000-4000-8000-000000000001";
const companyPath = `/companies/${companyId}`;
const t = organizationMessages[browserLocale()];

afterEach(() => vi.unstubAllGlobals());

async function open(path: string, signedIn = true) {
  vi.stubGlobal("__PROJECT_NAME__", "Teluni");
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  if (signedIn)
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
  return { screen, router, client };
}

function respond(handler: (url: URL) => { status?: number; body: unknown }) {
  const fetchOriginal = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn((request: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(
        request instanceof Request ? request.url : String(request),
        location.href,
      );
      if (!url.pathname.startsWith("/api/"))
        return fetchOriginal(request, init);
      const { status = 200, body } = handler(url);
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        }),
      );
    }),
  );
}

test("offers step-up when the company detail requires strong authentication", async () => {
  respond(() => ({
    status: 403,
    body: {
      error: {
        code: "STRONG_AUTHENTICATION_REQUIRED",
        message: "Strong authentication required",
      },
    },
  }));
  const { screen } = await open(companyPath);
  await expect
    .element(screen.getByRole("status"))
    .toMatchTextContent(t.stepUpNotice);
  await expect
    .element(screen.getByRole("link", { name: t.stepUpButton }))
    .toHaveAttribute(
      "href",
      `/api/auth/login?returnTo=${encodeURIComponent(companyPath)}&assurance=strong`,
    );
  await expect
    .element(screen.getByRole("button", { name: t.addBranch }))
    .not.toBeInTheDocument();
});

test("shows session infrastructure failure with reload guidance", async () => {
  respond(() => ({
    status: 503,
    body: { error: { code: "SERVICE_UNAVAILABLE", message: "Unavailable" } },
  }));
  const { screen } = await open("/companies", false);
  await expect
    .element(screen.getByRole("alert"))
    .toMatchTextContent(t.errors.SERVICE_UNAVAILABLE);
  await expect
    .element(screen.getByRole("button", { name: t.reload }))
    .toBeVisible();
  await expect
    .element(screen.getByText(t.signInRequired))
    .not.toBeInTheDocument();
});

test("preserves branch pagination in the URL and browser history", async () => {
  respond((url) =>
    url.pathname.endsWith("/branches")
      ? {
          body: {
            items: [
              {
                id: "branch",
                name: url.searchParams.has("cursor")
                  ? "Second branch"
                  : "First branch",
                timeZone: "UTC",
                status: "ACTIVE",
                version: 1,
              },
            ],
            nextCursor: url.searchParams.has("cursor") ? null : "page2",
          },
        }
      : {
          body: {
            company: { id: companyId, displayName: "Synthetic company" },
            access: {
              roles: ["OPERATOR"],
              responsible: false,
              capabilities: ["company.view", "branches.view"],
              capabilitiesAfterStrongAuthentication: [],
            },
          },
        },
  );
  const { screen, router } = await open(companyPath);
  await expect
    .element(screen.getByText("First branch", { exact: true }))
    .toBeVisible();
  await screen.getByRole("link", { name: t.nextPage }).click();
  await expect
    .element(screen.getByText("Second branch", { exact: true }))
    .toBeVisible();
  expect(router.state.location.search).toEqual({ cursor: "page2" });
  router.history.back();
  await expect
    .element(screen.getByText("First branch", { exact: true }))
    .toBeVisible();
  expect(router.state.location.search).toEqual({});
});

test("keeps the edited version across refetch and reviews current data after a conflict", async () => {
  const branchId = "00000000-0000-4000-8000-000000000002";
  let version = 1;
  let name = "Original branch";
  respond((url) => {
    if (url.pathname.endsWith(`/branches/${branchId}`))
      return {
        status: 409,
        body: {
          error: { code: "RESOURCE_VERSION_CONFLICT", message: "Changed" },
        },
      };
    if (url.pathname.endsWith("/branches"))
      return {
        body: {
          items: [
            { id: branchId, name, version, status: "ACTIVE", timeZone: "UTC" },
          ],
          nextCursor: null,
        },
      };
    return {
      body: {
        company: { id: companyId, displayName: "Synthetic company" },
        access: {
          roles: ["COMPANY_ADMINISTRATOR"],
          responsible: true,
          capabilities: ["company.view", "branches.view", "branches.manage"],
          capabilitiesAfterStrongAuthentication: [],
        },
      },
    };
  });
  const { screen, client } = await open(companyPath);
  await screen
    .getByRole("button", { name: `${t.rename}: Original branch` })
    .click();
  await screen.getByLabelText(t.fieldBranchName).nth(0).fill("My change");
  version = 2;
  name = "Concurrent change";
  await client.invalidateQueries({ queryKey: branchesKey(companyId) });
  await screen.getByRole("button", { name: t.save }).click();
  await expect
    .element(screen.getByRole("alert"))
    .toMatchTextContent(t.errors.RESOURCE_VERSION_CONFLICT);
  const request = vi
    .mocked(fetch)
    .mock.calls.map(([input]) => input)
    .find((input) => input instanceof Request && input.method === "PATCH");
  if (!(request instanceof Request))
    throw new Error("The rename request was not sent");
  expect(await request.clone().json()).toEqual({
    name: "My change",
    expectedVersion: 1,
  });
  await screen.getByRole("button", { name: t.reload }).click();
  await expect
    .element(screen.getByText("Concurrent change", { exact: true }))
    .toBeVisible();
  await screen
    .getByRole("button", { name: `${t.rename}: Concurrent change` })
    .click();
  await expect
    .element(screen.getByLabelText(t.fieldBranchName).nth(0))
    .toHaveValue("Concurrent change");
});
