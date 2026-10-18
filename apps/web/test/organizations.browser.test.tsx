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
import {
  branchesKey,
  companyKey,
  membersKey,
} from "../src/organizations/api.js";

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

function respond(
  handler: (
    url: URL,
    request: RequestInfo | URL,
  ) => { status?: number; body: unknown },
) {
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
      const { status = 200, body } = handler(url, request);
      return Promise.resolve(
        new Response(status === 204 ? null : JSON.stringify(body), {
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

test("preserves company pagination in the URL and browser history", async () => {
  respond((url) => ({
    body: {
      items: [
        {
          id: companyId,
          displayName: url.searchParams.has("cursor")
            ? "Older company"
            : "Recent company",
          roles: ["OPERATOR"],
        },
      ],
      nextCursor: url.searchParams.has("cursor") ? null : "company-page2",
    },
  }));
  const { screen, router } = await open("/companies");
  await expect
    .element(screen.getByRole("link", { name: "Recent company" }))
    .toBeVisible();
  await screen.getByRole("link", { name: t.nextPage }).click();
  await expect
    .element(screen.getByRole("link", { name: "Older company" }))
    .toBeVisible();
  expect(router.state.location.search).toEqual({ cursor: "company-page2" });
  router.history.back();
  await expect
    .element(screen.getByRole("link", { name: "Recent company" }))
    .toBeVisible();
  expect(router.state.location.search).toEqual({});
});

const administratorAccess = {
  roles: ["COMPANY_ADMINISTRATOR"],
  responsible: true,
  capabilities: [
    "company.view",
    "company.settings.manage",
    "branches.view",
    "audit.view",
  ],
  capabilitiesAfterStrongAuthentication: [],
};

test("keeps the company draft and its version across refetch until a conflict is reviewed", async () => {
  let version = 1;
  let name = "Original company";
  respond((_url, request) =>
    request instanceof Request && request.method === "PATCH"
      ? {
          status: 409,
          body: {
            error: { code: "RESOURCE_VERSION_CONFLICT", message: "Changed" },
          },
        }
      : {
          body: {
            company: {
              id: companyId,
              displayName: name,
              version,
              timeZone: "Asia/Kolkata",
              defaultLocale: "pt-BR",
            },
            access: administratorAccess,
          },
        },
  );
  const { screen, client } = await open(`${companyPath}?view=settings`);
  await screen.getByRole("button", { name: t.editSettings }).click();
  await expect
    .element(screen.getByLabelText(t.fieldTimeZone))
    .toHaveValue("Asia/Kolkata");
  await screen.getByLabelText(t.fieldCompanyName).fill("My settings");
  version = 2;
  name = "Concurrent company";
  await client.invalidateQueries({ queryKey: companyKey(companyId) });
  await expect.element(screen.getByRole("heading", { name })).toBeVisible();
  await screen.getByRole("button", { name: t.save }).click();
  await expect
    .element(screen.getByRole("alert"))
    .toMatchTextContent(t.errors.RESOURCE_VERSION_CONFLICT);
  await expect
    .element(screen.getByRole("button", { name: t.save }))
    .toBeDisabled();
  const request = vi
    .mocked(fetch)
    .mock.calls.map(([input]) => input)
    .find((input) => input instanceof Request && input.method === "PATCH");
  if (!(request instanceof Request))
    throw new Error("The settings request was not sent");
  expect(await request.clone().json()).toEqual({
    displayName: "My settings",
    timeZone: "Asia/Kolkata",
    defaultLocale: "pt-BR",
    expectedVersion: 1,
  });
  await screen.getByRole("button", { name: t.reload }).click();
  await screen.getByRole("button", { name: t.editSettings }).click();
  await expect
    .element(screen.getByLabelText(t.fieldCompanyName))
    .toHaveValue(name);
});

test("reconciles a lost company update response before another save", async () => {
  let name = "Original company";
  let writes = 0;
  respond((_url, request) => {
    if (request instanceof Request && request.method === "PATCH") {
      writes++;
      name = "Saved despite disconnect";
      throw new TypeError("Synthetic lost response");
    }
    return {
      body: {
        company: {
          id: companyId,
          displayName: name,
          version: writes + 1,
          timeZone: "UTC",
          defaultLocale: "pt-BR",
        },
        access: administratorAccess,
      },
    };
  });
  const { screen } = await open(`${companyPath}?view=settings`);
  await screen.getByRole("button", { name: t.editSettings }).click();
  await screen
    .getByLabelText(t.fieldCompanyName)
    .fill("Saved despite disconnect");
  await screen.getByRole("button", { name: t.save }).click();
  await expect
    .element(screen.getByRole("alert"))
    .toMatchTextContent(t.unknownWrite);
  await expect
    .element(screen.getByRole("button", { name: t.save }))
    .toBeDisabled();
  await screen.getByRole("button", { name: t.reload }).click();
  await expect
    .element(screen.getByRole("heading", { name: "Saved despite disconnect" }))
    .toBeVisible();
  expect(writes).toBe(1);
});

test("paginates localized history and resets the cursor when changing views", async () => {
  respond((url) =>
    url.pathname.endsWith("/audit-events")
      ? {
          body: {
            items: [
              {
                id: url.searchParams.has("cursor")
                  ? "older-event"
                  : "recent-event",
                action: url.searchParams.has("cursor")
                  ? "__proto__"
                  : "company.updated",
                actorPrincipalId: "synthetic",
                occurredAt: "2026-10-18T12:00:00.000Z",
                targetType: "branch",
                details: {
                  branchName: "Historic branch",
                  fields: ["displayName", "__proto__", { untrusted: true }],
                },
              },
            ],
            nextCursor: url.searchParams.has("cursor") ? null : "history-page2",
          },
        }
      : {
          body: {
            company: {
              id: companyId,
              displayName: "History company",
              version: 1,
              timeZone: "UTC",
              defaultLocale: "pt-BR",
            },
            access: administratorAccess,
          },
        },
  );
  const { screen, router } = await open(`${companyPath}?view=history`);
  await expect
    .element(screen.getByText(t.historyActions["company.updated"]))
    .toBeVisible();
  await expect
    .element(screen.getByText(t.historyYou, { exact: false }))
    .toBeVisible();
  await screen.getByRole("link", { name: t.nextPage }).click();
  await expect.element(screen.getByText(t.historyUnknown)).toBeVisible();
  await expect
    .element(screen.getByText(`${t.fieldBranchName}: Historic branch`))
    .toBeVisible();
  expect(router.state.location.search).toEqual({
    view: "history",
    cursor: "history-page2",
  });
  router.history.back();
  await expect
    .element(screen.getByText(t.historyActions["company.updated"]))
    .toBeVisible();
  await screen.getByRole("link", { name: t.settingsTitle }).click();
  expect(router.state.location.search).toEqual({ view: "settings" });
  await expect
    .element(screen.getByRole("button", { name: t.editSettings }))
    .toBeVisible();
});

test.each(["settings", "history", "members"])(
  "denies an operator's direct %s view without requesting protected data",
  async (view) => {
    respond(() => ({
      body: {
        company: { id: companyId, displayName: "Restricted company" },
        access: {
          roles: ["OPERATOR"],
          responsible: false,
          capabilities: ["company.view", "branches.view"],
          capabilitiesAfterStrongAuthentication: [],
        },
      },
    }));
    const { screen } = await open(`${companyPath}?view=${view}`);
    await expect
      .element(screen.getByRole("alert"))
      .toMatchTextContent(t.errors.PERMISSION_DENIED);
    await expect
      .element(screen.getByRole("link", { name: t.historyTitle }))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: t.editSettings }))
      .not.toBeInTheDocument();
    expect(
      vi
        .mocked(fetch)
        .mock.calls.every(
          ([input]) =>
            !(input instanceof Request) ||
            (!input.url.includes("audit-events") &&
              !input.url.includes("/members")),
        ),
    ).toBe(true);
  },
);

const memberId = "00000000-0000-4000-8000-000000000009";
const memberAccess = {
  ...administratorAccess,
  capabilities: [...administratorAccess.capabilities, "members.manage"],
};
const memberPage = (status = "ACTIVE", version = 1, roles = ["OPERATOR"]) => ({
  items: [
    {
      id: memberId,
      principalId: "another-person",
      displayName: "Synthetic member",
      email: "member@example.test",
      status,
      version,
      responsible: false,
      roles,
    },
  ],
  nextCursor: null,
});
const memberCompany = {
  company: { id: companyId, displayName: "Member company" },
  access: memberAccess,
};

test("captures the member version before confirmation and reviews a conflict", async () => {
  let version = 1;
  respond((url, request) =>
    request instanceof Request && request.method === "PATCH"
      ? {
          status: 409,
          body: {
            error: { code: "RESOURCE_VERSION_CONFLICT", message: "Changed" },
          },
        }
      : {
          body: url.pathname.endsWith("/members")
            ? memberPage(version === 1 ? "ACTIVE" : "SUSPENDED", version)
            : memberCompany,
        },
  );
  const { screen, client } = await open(`${companyPath}?view=members`);
  await screen
    .getByRole("button", { name: `${t.memberSuspend}: Synthetic member` })
    .click();
  version = 2;
  await client.invalidateQueries({ queryKey: membersKey(companyId) });
  await screen
    .getByRole("button", { name: t.memberConfirm, exact: true })
    .click();
  await expect
    .element(screen.getByRole("alert"))
    .toMatchTextContent(t.errors.RESOURCE_VERSION_CONFLICT);
  const request = vi
    .mocked(fetch)
    .mock.calls.map(([input]) => input)
    .find((input) => input instanceof Request && input.method === "PATCH");
  if (!(request instanceof Request))
    throw new Error("The member request was not sent");
  expect(await request.clone().json()).toEqual({
    status: "SUSPENDED",
    expectedVersion: 1,
  });
  await expect
    .element(screen.getByRole("button", { name: t.memberConfirm, exact: true }))
    .toBeDisabled();
  await screen.getByRole("button", { name: t.reload }).click();
  await expect
    .element(
      screen.getByRole("button", {
        name: `${t.memberReactivate}: Synthetic member`,
      }),
    )
    .toBeVisible();
});

test("reconciles a lost member-change response without repeating the write", async () => {
  let writes = 0;
  respond((url, request) => {
    if (request instanceof Request && request.method === "PATCH") {
      writes++;
      throw new TypeError("Synthetic lost response");
    }
    return {
      body: url.pathname.endsWith("/members")
        ? memberPage(writes ? "SUSPENDED" : "ACTIVE", writes + 1)
        : memberCompany,
    };
  });
  const { screen } = await open(`${companyPath}?view=members`);
  await screen
    .getByRole("button", { name: `${t.memberSuspend}: Synthetic member` })
    .click();
  await screen
    .getByRole("button", { name: t.memberConfirm, exact: true })
    .click();
  await expect
    .element(screen.getByRole("alert"))
    .toMatchTextContent(t.unknownWrite);
  await expect
    .element(screen.getByRole("button", { name: t.memberConfirm, exact: true }))
    .toBeDisabled();
  await screen.getByRole("button", { name: t.reload }).click();
  await expect
    .element(
      screen.getByRole("button", {
        name: `${t.memberReactivate}: Synthetic member`,
      }),
    )
    .toBeVisible();
  expect(writes).toBe(1);
});

test("offers recent step-up when restoring an administrator", async () => {
  respond((url, request) =>
    request instanceof Request && request.method === "PATCH"
      ? {
          status: 403,
          body: {
            error: {
              code: "RECENT_AUTHENTICATION_REQUIRED",
              message: "Recent assurance required",
            },
          },
        }
      : {
          body: url.pathname.endsWith("/members")
            ? memberPage("SUSPENDED", 2, ["COMPANY_ADMINISTRATOR"])
            : memberCompany,
        },
  );
  const { screen } = await open(`${companyPath}?view=members`);
  await screen
    .getByRole("button", { name: `${t.memberReactivate}: Synthetic member` })
    .click();
  await screen
    .getByRole("button", { name: t.memberConfirm, exact: true })
    .click();
  await expect
    .element(screen.getByRole("link", { name: t.memberReauthenticate }))
    .toHaveAttribute(
      "href",
      `/api/auth/login?returnTo=${encodeURIComponent(`${companyPath}?view=members`)}&assurance=recent`,
    );
});

test("preserves member pagination and hides lifecycle actions for the responsible member", async () => {
  respond((url) => ({
    body: url.pathname.endsWith("/members")
      ? {
          items: [
            {
              ...memberPage().items[0],
              responsible: !url.searchParams.has("cursor"),
              displayName: url.searchParams.has("cursor")
                ? "Older member"
                : "Responsible member",
            },
          ],
          nextCursor: url.searchParams.has("cursor") ? null : "members-page2",
        }
      : memberCompany,
  }));
  const { screen, router } = await open(`${companyPath}?view=members`);
  await expect
    .element(screen.getByText(t.memberResponsibleProtected))
    .toBeVisible();
  await expect
    .element(
      screen.getByRole("button", {
        name: `${t.memberSuspend}: Responsible member`,
      }),
    )
    .not.toBeInTheDocument();
  await screen.getByRole("link", { name: t.nextPage }).click();
  await expect
    .element(screen.getByText("Older member", { exact: true }))
    .toBeVisible();
  expect(router.state.location.search).toEqual({
    view: "members",
    cursor: "members-page2",
  });
  router.history.back();
  await expect
    .element(screen.getByText("Responsible member", { exact: true }))
    .toBeVisible();
  expect(router.state.location.search).toEqual({ view: "members" });
});
