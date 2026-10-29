import { afterEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { sessionKey, sessionsKey } from "../src/identity/api.js";
import { identityMessages } from "../src/identity/messages.js";
import { browserLocale } from "../src/locale.js";
import { ModuleNavigation } from "../src/module-navigation.js";
import { moduleNavigation, routeTree } from "../src/modules.js";

afterEach(() => vi.unstubAllGlobals());

const t = identityMessages[browserLocale()];

/** Renders `path` for a signed-in person whose account has `enabled` two-step verification. */
async function open(path: string, enabled: boolean) {
  vi.stubGlobal("__PROJECT_NAME__", "Teluni");
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(sessionKey, {
    principalId: "synthetic",
    sessionId: "synthetic-session",
    state: "ACTIVE",
    expiresAt: "2099-10-28T12:00:00.000Z",
    assuranceLevel: "teluni-aal1",
    authenticatedAt: "2026-10-28T08:00:00.000Z",
  });
  client.setQueryData(sessionsKey, []);
  const original = globalThis.fetch;
  vi.stubGlobal("fetch", (request: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      request instanceof Request ? request.url : String(request),
      location.href,
    );
    if (!url.pathname.startsWith("/api/")) return original(request, init);
    const body = url.pathname.endsWith("/auth/two-step")
      ? { enabled }
      : { items: [], nextCursor: null };
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        headers: { "content-type": "application/json" },
      }),
    );
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

test("recommends enabling optional two-step verification on the sessions page", async () => {
  const { screen } = await open("/account/sessions", false);
  await expect.element(screen.getByText(t.twoStepDisabled)).toBeVisible();
  await expect
    .element(screen.getByRole("link", { name: t.twoStepEnable }))
    .toHaveAttribute(
      "href",
      "/api/auth/login?returnTo=%2Faccount%2Fsessions&twoStep=enable",
    );
  await expect
    .element(screen.getByRole("link", { name: t.twoStepDisable }))
    .not.toBeInTheDocument();
});

test("lets a person with two-step verification disable it", async () => {
  const { screen } = await open("/account/sessions", true);
  await expect.element(screen.getByText(t.twoStepEnabled)).toBeVisible();
  await expect
    .element(screen.getByRole("link", { name: t.twoStepDisable }))
    .toHaveAttribute(
      "href",
      "/api/auth/login?returnTo=%2Faccount%2Fsessions&twoStep=disable",
    );
  await expect.element(screen.getByText(t.twoStepDisableHint)).toBeVisible();
});

test("suggests two-step verification after the first sign-in, optionally", async () => {
  const { screen, router } = await open(
    "/welcome/two-step?returnTo=%2Fcompanies",
    false,
  );
  await expect
    .element(screen.getByRole("heading", { name: t.welcomeTitle }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("link", { name: t.welcomeEnable }))
    .toHaveAttribute(
      "href",
      "/api/auth/login?returnTo=%2Fcompanies&twoStep=enable",
    );
  await screen.getByRole("link", { name: t.welcomeSkip }).click();
  await expect.poll(() => router.state.location.pathname).toBe("/companies");
});

test("skips the suggestion when two-step verification is already on", async () => {
  const { router } = await open(
    "/welcome/two-step?returnTo=%2Fcompanies",
    true,
  );
  await expect.poll(() => router.state.location.pathname).toBe("/companies");
});

test("ignores a return path outside the panel", async () => {
  const { screen } = await open(
    "/welcome/two-step?returnTo=https%3A%2F%2Fevil.example",
    false,
  );
  await expect
    .element(screen.getByRole("link", { name: t.welcomeEnable }))
    .toHaveAttribute("href", "/api/auth/login?returnTo=%2F&twoStep=enable");
});
