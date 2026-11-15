import { afterEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { sessionKey } from "../src/identity/api.js";
import { identityMessages } from "../src/identity/messages.js";
import { browserLocale } from "../src/locale.js";
import { ModuleNavigation } from "../src/module-navigation.js";
import { moduleNavigation, routeTree } from "../src/modules.js";
import { shellMessages } from "../src/shell-messages.js";
import { companyKey } from "../src/organizations/api.js";
import { workspaceMessages } from "../src/workspace/messages.js";

const locale = browserLocale();
const t = workspaceMessages[locale];
const identity = identityMessages[locale];
const signedIn = {
  principalId: "synthetic",
  sessionId: "synthetic-session",
  state: "ACTIVE",
  expiresAt: "2026-10-19T12:00:00.000Z",
  assuranceLevel: "teluni-aal1",
  authenticatedAt: "2026-10-19T08:00:00.000Z",
};

const companyId = "00000000-0000-4000-8000-000000000001";
const summary = {
  id: companyId,
  displayName: "Home company",
  status: "ACTIVE",
  roles: ["COMPANY_ADMINISTRATOR"],
};
function companyDetails(capabilities: string[]) {
  return {
    company: summary,
    access: {
      roles: summary.roles,
      profiles: [],
      responsible: true,
      capabilities,
    },
    responsibilityTransfer: null,
  };
}
function homeResponse(url: URL, capabilities: string[] = []) {
  if (url.pathname.endsWith("/auth/two-step"))
    return { body: { enabled: true } };
  if (url.pathname === "/api/companies")
    return { body: { items: [summary], nextCursor: null } };
  return { body: companyDetails(capabilities) };
}

afterEach(() => vi.unstubAllGlobals());

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

async function open(path: string, session: unknown) {
  vi.stubGlobal("__PROJECT_NAME__", "Teluni");
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(sessionKey, session);
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

test("sends a visitor from the entry to the sign-in page", async () => {
  respond(() => ({ body: {} }));
  const { screen, router } = await open("/", null);
  await expect
    .element(screen.getByRole("heading", { name: identity.signInTitle }))
    .toBeVisible();
  expect(router.state.location.pathname).toBe("/sign-in");
  await expect
    .element(screen.getByRole("link", { name: t.navHome }))
    .not.toBeInTheDocument();
  // Someone without an account creates one at the provider instead.
  await expect
    .element(screen.getByRole("link", { name: identity.signUpLink }))
    .toHaveAttribute("href", "/api/auth/login?returnTo=%2F&intent=signup");
});

test("shows a signed-in person's companies and account on the home page", async () => {
  respond((url) =>
    url.pathname.endsWith("/auth/two-step")
      ? { body: { enabled: false } }
      : url.pathname.endsWith("/companies")
        ? {
            body: {
              items: [
                {
                  id: "00000000-0000-4000-8000-000000000001",
                  status: "ACTIVE",
                  displayName: "Home company",
                  roles: ["COMPANY_ADMINISTRATOR"],
                },
              ],
              nextCursor: null,
            },
          }
        : { body: companyDetails([]) },
  );
  const { screen } = await open("/", signedIn);
  await expect
    .element(screen.getByRole("heading", { level: 1, name: t.homeTitle }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("link", { name: "Home company" }))
    .toHaveAttribute("href", "/companies/00000000-0000-4000-8000-000000000001");
  // Two-step verification is optional; the home page recommends it.
  await expect.element(screen.getByText(t.twoStepDisabled)).toBeVisible();
  await expect
    .element(screen.getByRole("link", { name: t.createAnother }))
    .toHaveAttribute("href", "/companies?mode=form&record=new");
  await expect
    .element(screen.getByRole("link", { name: t.twoStepButton }))
    .toHaveAttribute("href", "/api/auth/login?returnTo=%2F&twoStep=enable");
  // The browser runner's small viewport uses the navigation disclosure.
  if (matchMedia("(max-width: 760px)").matches)
    await screen
      .getByRole("button", { name: shellMessages[locale].menu })
      .click();
  await expect
    .element(screen.getByRole("link", { name: t.navHome }))
    .toHaveAttribute("data-status", "active");
});

test("invites a person without companies to create the first one", async () => {
  respond((url) =>
    url.pathname.endsWith("/auth/two-step")
      ? { body: { enabled: true } }
      : { body: { items: [], nextCursor: null } },
  );
  const { screen } = await open("/", {
    ...signedIn,
  });
  await expect.element(screen.getByText(t.companiesEmpty)).toBeVisible();
  await expect
    .element(screen.getByRole("link", { name: t.createFirst }))
    .toHaveAttribute("href", "/companies?mode=form&record=new");
  await expect.element(screen.getByText(t.twoStepEnabled)).toBeVisible();
  await expect
    .element(screen.getByRole("link", { name: t.twoStepButton }))
    .not.toBeInTheDocument();
});

test("sends a signed-in person from sign-in to the requested page", async () => {
  respond(() => ({ body: { items: [], nextCursor: null } }));
  const { router } = await open(
    "/sign-in?returnTo=%2Faccount%2Fsessions",
    signedIn,
  );
  await expect
    .poll(() => router.state.location.pathname)
    .toBe("/account/sessions");
});

test("mounts the developer portal only in development", () => {
  // Production builds drop the portal; scripts/check-public-bundle.mjs
  // verifies the emitted assets.
  expect(import.meta.env.DEV).toBe(true);
  expect(
    moduleNavigation.some((item) => item.name === "DocumentationNavigation"),
  ).toBe(true);
});

test("uses effective capabilities for shortcuts, regardless of the listed administrator role", async () => {
  const requests: string[] = [];
  respond((url) => {
    requests.push(url.pathname);
    return homeResponse(url, ["media.view"]);
  });
  const { screen } = await open("/", signedIn);
  const shortcuts = screen.getByRole("navigation", {
    name: t.companyShortcuts(summary.displayName),
  });
  await expect
    .element(shortcuts.getByRole("link", { name: t.media }))
    .toHaveAttribute("href", `/companies/${companyId}/media`);
  await expect
    .element(shortcuts.getByRole("link", { name: t.programming }))
    .not.toBeInTheDocument();
  await expect
    .element(shortcuts.getByRole("link", { name: t.screens }))
    .not.toBeInTheDocument();
  expect(requests.some((path) => path.includes("/devices"))).toBe(false);
});

test("hides cached shortcuts when a company access refetch is denied", async () => {
  let denied = false;
  respond((url) =>
    url.pathname === `/api/companies/${companyId}` && denied
      ? { status: 403, body: { error: { code: "PERMISSION_DENIED" } } }
      : homeResponse(url, ["media.view", "programming.view"]),
  );
  const { screen, client } = await open("/", signedIn);
  await expect
    .element(
      screen.getByRole("navigation", {
        name: t.companyShortcuts(summary.displayName),
      }),
    )
    .toBeVisible();
  denied = true;
  await client.invalidateQueries({ queryKey: companyKey(companyId) });
  await expect.element(screen.getByText(t.accessFailed)).toBeVisible();
  await expect
    .element(
      screen.getByRole("navigation", {
        name: t.companyShortcuts(summary.displayName),
      }),
    )
    .not.toBeInTheDocument();
});

test("keeps a failed company list distinct from an empty list and supports retry", async () => {
  let failed = false;
  respond((url) =>
    url.pathname === "/api/companies" && failed
      ? { status: 503, body: { error: { code: "SERVICE_UNAVAILABLE" } } }
      : homeResponse(url),
  );
  const { screen, client } = await open("/", signedIn);
  await expect
    .element(screen.getByRole("link", { name: summary.displayName }))
    .toBeVisible();
  failed = true;
  await client.invalidateQueries({
    queryKey: ["organizations", "companies", "home"],
  });
  await expect.element(screen.getByText(t.companiesFailed)).toBeVisible();
  await expect
    .element(screen.getByRole("link", { name: summary.displayName }))
    .not.toBeInTheDocument();
  await expect
    .element(screen.getByText(t.companiesEmpty))
    .not.toBeInTheDocument();
  failed = false;
  await screen.getByRole("button", { name: t.reload }).click();
  await expect
    .element(screen.getByRole("link", { name: summary.displayName }))
    .toBeVisible();
});

test("labels a partial screen preview without treating omitted connection states as zero connected", async () => {
  respond((url) => {
    if (url.pathname.endsWith("/devices")) {
      expect(url.searchParams.get("status")).toBe("ACTIVE");
      return {
        body: {
          items: [{ id: "screen-a" }, { id: "screen-b" }],
          nextCursor: "next-page",
        },
      };
    }
    if (url.pathname.endsWith("/screen-states"))
      return {
        body: { items: [{ deviceId: "screen-a", connection: "online" }] },
      };
    return homeResponse(url, ["devices.view"]);
  });
  const { screen } = await open("/", signedIn);
  await expect.element(screen.getByText(t.screenCount(2, true))).toBeVisible();
  await expect.element(screen.getByText(t.screensPartial)).toBeVisible();
  await expect.element(screen.getByText(t.connectionUnavailable)).toBeVisible();
  await expect
    .element(screen.getByText(t.connectedCount(0), { exact: true }))
    .not.toBeInTheDocument();
  await expect
    .element(screen.getByText(t.connectedCount(1), { exact: true }))
    .not.toBeInTheDocument();
});

test("shows real connection counts and keeps unavailable screens distinct from no screens", async () => {
  let failed = false;
  respond((url) => {
    if (url.pathname.endsWith("/devices"))
      return failed
        ? { status: 503, body: { error: { code: "SERVICE_UNAVAILABLE" } } }
        : {
            body: {
              items: [{ id: "screen-a" }, { id: "screen-b" }],
              nextCursor: null,
            },
          };
    if (url.pathname.endsWith("/screen-states"))
      return {
        body: {
          items: [
            { deviceId: "screen-a", connection: "online" },
            { deviceId: "screen-b", connection: "offline" },
          ],
        },
      };
    return homeResponse(url, ["devices.view"]);
  });
  const { screen, client } = await open("/", signedIn);
  await expect.element(screen.getByText(t.screenCount(2, false))).toBeVisible();
  await expect
    .element(screen.getByText(t.connectedCount(1), { exact: true }))
    .toBeVisible();
  failed = true;
  await client.invalidateQueries({
    queryKey: ["devices", "list", companyId, "home"],
  });
  await expect.element(screen.getByText(t.screensFailed)).toBeVisible();
  await expect.element(screen.getByText(t.noScreens)).not.toBeInTheDocument();
  await expect
    .element(screen.getByText(t.screenCount(2, false)))
    .not.toBeInTheDocument();
});

test.each([
  [7, 6],
  [2, 2],
])(
  "bounds a %i-company page to %i cards and labels the visible preview",
  async (count, visible) => {
    const detailRequests: string[] = [];
    respond((url) => {
      if (url.pathname === "/api/companies")
        return {
          body: {
            items: Array.from({ length: count }, (_, i) => ({
              ...summary,
              id: `company-${i}`,
              displayName: `Company ${i}`,
            })),
            nextCursor: "next-page",
          },
        };
      if (url.pathname.startsWith("/api/companies/"))
        detailRequests.push(url.pathname);
      return homeResponse(url);
    });
    const { screen } = await open("/", signedIn);
    await expect
      .element(screen.getByText(t.companiesPartial(visible), { exact: false }))
      .toBeVisible();
    await expect
      .element(
        screen.getByRole("link", {
          name: `Company ${visible - 1}`,
          exact: true,
        }),
      )
      .toBeVisible();
    await expect
      .element(
        screen.getByRole("link", { name: `Company ${visible}`, exact: true }),
      )
      .not.toBeInTheDocument();
    await expect.poll(() => detailRequests.length).toBe(visible);
    expect(
      detailRequests.some((path) => path.endsWith(`company-${visible}`)),
    ).toBe(false);
  },
);

test("does not request company details or workflow data for a suspended company", async () => {
  const requests: string[] = [];
  respond((url) => {
    requests.push(url.pathname);
    return url.pathname === "/api/companies"
      ? {
          body: {
            items: [{ ...summary, status: "SUSPENDED" }],
            nextCursor: null,
          },
        }
      : homeResponse(url);
  });
  const { screen } = await open("/", signedIn);
  await expect.element(screen.getByText(t.companySuspended)).toBeVisible();
  expect(
    requests.some((path) => path.startsWith(`/api/companies/${companyId}`)),
  ).toBe(false);
});

test("does not present unavailable two-step protection as enabled or disabled", async () => {
  respond((url) =>
    url.pathname.endsWith("/auth/two-step")
      ? { status: 503, body: { error: { code: "SERVICE_UNAVAILABLE" } } }
      : homeResponse(url),
  );
  const { screen } = await open("/", signedIn);
  await expect.element(screen.getByText(t.accountFailed)).toBeVisible();
  await expect
    .element(screen.getByText(t.twoStepEnabled))
    .not.toBeInTheDocument();
  await expect
    .element(screen.getByText(t.twoStepDisabled))
    .not.toBeInTheDocument();
});

test("offers session recovery without showing cached home data or redirecting in a loop", async () => {
  let failed = false;
  respond((url) => {
    if (url.pathname.endsWith("/auth/session"))
      return failed
        ? { status: 503, body: { error: { code: "SERVICE_UNAVAILABLE" } } }
        : { body: { ...signedIn, csrfToken: "synthetic-csrf" } };
    return homeResponse(url);
  });
  const { screen, client, router } = await open("/", signedIn);
  await expect
    .element(screen.getByRole("heading", { level: 1, name: t.homeTitle }))
    .toBeVisible();
  failed = true;
  await client.invalidateQueries({ queryKey: sessionKey });
  await expect.element(screen.getByText(t.sessionFailed)).toBeVisible();
  await expect
    .element(screen.getByRole("heading", { level: 1, name: t.homeTitle }))
    .not.toBeInTheDocument();
  expect(router.state.location.pathname).toBe("/");
  failed = false;
  await screen.getByRole("button", { name: t.reload }).click();
  await expect
    .element(screen.getByRole("heading", { level: 1, name: t.homeTitle }))
    .toBeVisible();
});

test("preserves sign-in entry when the session service is unavailable before loading a session", async () => {
  respond(() => ({
    status: 503,
    body: { error: { code: "SERVICE_UNAVAILABLE" } },
  }));
  const { screen, router } = await open("/", undefined);
  await expect
    .element(screen.getByRole("heading", { name: identity.signInTitle }))
    .toBeVisible();
  expect(router.state.location.pathname).toBe("/sign-in");
  await expect
    .element(screen.getByRole("heading", { level: 1, name: t.homeTitle }))
    .not.toBeInTheDocument();
});
