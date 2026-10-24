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

test("labels the local MFA exception without claiming provider two-step verification", async () => {
  vi.stubGlobal("__PROJECT_NAME__", "Teluni");
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(sessionKey, {
    principalId: "synthetic",
    state: "ACTIVE",
    assuranceLevel: "teluni-development",
    strongAuthenticatedAt: "2026-10-24T12:00:00.000Z",
  });
  client.setQueryData(sessionsKey, []);
  const original = globalThis.fetch;
  vi.stubGlobal("fetch", (request: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      request instanceof Request ? request.url : String(request),
      location.href,
    );
    return url.pathname.startsWith("/api/")
      ? Promise.resolve(
          new Response(JSON.stringify({ items: [], nextCursor: null }), {
            headers: { "content-type": "application/json" },
          }),
        )
      : original(request, init);
  });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/account/sessions"] }),
  });
  const screen = await render(
    <QueryClientProvider client={client}>
      <ModuleNavigation value={moduleNavigation}>
        <RouterProvider router={router} />
      </ModuleNavigation>
    </QueryClientProvider>,
  );
  const t = identityMessages[browserLocale()];
  await expect.element(screen.getByText(t.twoStepDevelopment)).toBeVisible();
  await expect
    .element(screen.getByText(t.twoStepDone, { exact: false }))
    .not.toBeInTheDocument();
  await expect
    .element(screen.getByRole("link", { name: t.twoStepButton }))
    .not.toBeInTheDocument();
});
