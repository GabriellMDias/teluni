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
  strongAuthenticatedAt: null,
};

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
  return { screen, router };
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
    url.pathname.endsWith("/companies")
      ? {
          body: {
            items: [
              {
                id: "00000000-0000-4000-8000-000000000001",
                displayName: "Home company",
                roles: ["COMPANY_ADMINISTRATOR"],
              },
            ],
            nextCursor: null,
          },
        }
      : { body: {} },
  );
  const { screen } = await open("/", signedIn);
  await expect
    .element(screen.getByRole("heading", { level: 1, name: t.homeTitle }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("link", { name: "Home company" }))
    .toHaveAttribute("href", "/companies/00000000-0000-4000-8000-000000000001");
  await expect.element(screen.getByText(t.twoStepMissing)).toBeVisible();
  await expect
    .element(screen.getByRole("link", { name: t.twoStepButton }))
    .toHaveAttribute("href", "/api/auth/login?returnTo=%2F&assurance=strong");
  await expect
    .element(screen.getByRole("link", { name: t.navHome }))
    .toHaveAttribute("data-status", "active");
});

test("invites a person without companies to create the first one", async () => {
  respond(() => ({ body: { items: [], nextCursor: null } }));
  const { screen } = await open("/", {
    ...signedIn,
    strongAuthenticatedAt: "2026-10-19T08:00:00.000Z",
  });
  await expect.element(screen.getByText(t.companiesEmpty)).toBeVisible();
  await expect
    .element(screen.getByRole("link", { name: t.createFirst }))
    .toHaveAttribute("href", "/companies");
  await expect.element(screen.getByText(t.twoStepDone)).toBeVisible();
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
