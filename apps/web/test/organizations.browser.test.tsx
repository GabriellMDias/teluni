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
import { shellMessages } from "../src/shell-messages.js";
import { formatInstant } from "../src/organizations/members.js";
import { organizationMessages } from "../src/organizations/messages.js";
import {
  branchesKey,
  companyKey,
  membersKey,
  profilesKey,
} from "../src/organizations/api.js";

const companyId = "00000000-0000-4000-8000-000000000001";
const companyPath = `/companies/${companyId}`;
const locale = browserLocale();
const t = organizationMessages[locale];

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
  if (matchMedia("(max-width: 760px)").matches)
    await screen
      .getByRole("button", { name: shellMessages[locale].menu })
      .click();
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
              profiles: [],
              responsible: false,
              capabilities: ["company.view", "branches.view"],
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
          profiles: [],
          responsible: true,
          capabilities: ["company.view", "branches.view", "branches.manage"],
        },
      },
    };
  });
  // The branches dataset opens the branch in form mode from the URL.
  const { screen, client } = await open(
    `${companyPath}?mode=form&record=${branchId}`,
  );
  await screen.getByLabelText(t.fieldBranchName).fill("My change");
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
    address: null,
    expectedVersion: 1,
  });
  await screen.getByRole("button", { name: t.reload }).click();
  await expect
    .element(screen.getByRole("heading", { name: "Concurrent change" }))
    .toBeVisible();
  await expect
    .element(screen.getByLabelText(t.fieldBranchName))
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

const datasetCompany = "00000000-0000-4000-8000-000000000002";

function respondWithCompanies(
  items: readonly { id: string; displayName: string }[],
) {
  respond((url) => {
    if (url.pathname.endsWith("/companies"))
      return {
        body: {
          items: items.map((item) => ({ ...item, roles: ["OPERATOR"] })),
          nextCursor: null,
        },
      };
    const item = items.find(({ id }) => url.pathname.endsWith(id))!;
    return {
      body: {
        company: {
          ...item,
          version: 1,
          timeZone: "UTC",
          defaultLocale: "pt-BR",
        },
        access: {
          roles: ["OPERATOR"],
          profiles: [],
          responsible: false,
          capabilities: ["company.view"],
        },
      },
    };
  });
}

test("opens the first company form directly when the person has no company", async () => {
  respondWithCompanies([]);
  const { screen } = await open("/companies");
  await expect
    .element(screen.getByRole("button", { name: t.createCompany }))
    .toBeVisible();
  await expect.element(screen.getByText(t.companiesEmpty)).toBeVisible();
});

test("keeps dataset selection, mode and duplication in the URL", async () => {
  const other = datasetCompany;
  respondWithCompanies([
    { id: companyId, displayName: "Alpha" },
    { id: other, displayName: "Beta" },
  ]);
  const { screen, router } = await open("/companies");
  await screen.getByRole("gridcell", { name: "Beta" }).click();
  expect(router.state.location.search).toEqual({ record: other });
  await screen
    .getByRole("toolbar")
    .getByRole("button", { name: /formulário|form mode/i })
    .click();
  expect(router.state.location.search).toEqual({
    mode: "form",
    record: other,
  });
  // Operators can read the record but the settings stay read-only.
  await expect
    .element(screen.getByLabelText(t.fieldCompanyName))
    .toHaveValue("Beta");
  await expect
    .element(screen.getByLabelText(t.fieldCompanyName))
    .toBeDisabled();
  await expect.element(screen.getByText(t.settingsReadOnly)).toBeVisible();
  await screen
    .getByRole("toolbar")
    .getByRole("button", { name: /anterior|previous/i })
    .click();
  await expect
    .element(screen.getByLabelText(t.fieldCompanyName))
    .toHaveValue("Alpha");
  expect(router.state.location.search).toEqual({
    mode: "form",
    record: companyId,
  });
  await screen
    .getByRole("toolbar")
    .getByRole("button", { name: /duplicar|duplicate/i })
    .click();
  await expect
    .element(screen.getByLabelText(t.fieldCompanyName))
    .toHaveValue(t.copyName("Alpha"));
  await expect.element(screen.getByLabelText(t.fieldCompanyName)).toBeEnabled();
  expect(router.state.location.search).toEqual({
    mode: "form",
    record: "new",
    copy: companyId,
  });
});

const administratorAccess = {
  roles: ["COMPANY_ADMINISTRATOR"],
  profiles: [],
  responsible: true,
  capabilities: [
    "company.view",
    "company.settings.manage",
    "branches.view",
    "audit.view",
  ],
};

test("keeps the current logo and restores focus when a rejected replacement is discarded", async () => {
  const logo =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jPZkAAAAASUVORK5CYII=";
  let writes = 0;
  respond((_url, request) => {
    if (request instanceof Request && request.method === "PATCH") writes++;
    return {
      body: {
        company: {
          id: companyId,
          displayName: "Original company",
          version: 1,
          logoDataUrl: logo,
          defaultLocale: "pt-BR",
        },
        access: administratorAccess,
      },
    };
  });
  const { screen } = await open(`${companyPath}?view=settings`);
  const edit = screen.getByRole("button", { name: t.editSettings });
  await edit.click();
  const name = screen.getByLabelText(t.fieldCompanyName);
  const save = screen.getByRole("button", { name: t.save });
  await expect.element(name).toHaveFocus();
  await expect.element(save).toBeDisabled();
  await name.fill("Draft company");
  await screen
    .getByLabelText(t.replaceLogo)
    .upload(new File(["not an image"], "invalid.png", { type: "image/png" }));
  await expect
    .element(screen.getByRole("alert"))
    .toMatchTextContent(t.logoInvalid);
  await screen
    .getByRole("button", { name: t.settingsWorkspace.clearFile })
    .click();
  await expect
    .element(screen.getByRole("img", { name: t.logoPreview }))
    .toHaveAttribute("src", logo);
  await expect
    .element(screen.getByLabelText(t.replaceLogo))
    .not.toHaveAttribute("aria-invalid", "true");
  await expect.element(save).toBeEnabled();
  await screen.getByRole("button", { name: t.cancel }).click();
  await expect.element(edit).toHaveFocus();
  await expect
    .element(screen.getByRole("heading", { name: "Original company" }))
    .toBeVisible();
  expect(writes).toBe(0);
});

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
    .not.toBeInTheDocument();
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
    logoDataUrl: null,
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
  let reloadAttempts = 0;
  respond((_url, request) => {
    if (request instanceof Request && request.method === "PATCH") {
      writes++;
      name = "Saved despite disconnect";
      throw new TypeError("Synthetic lost response");
    }
    if (writes > 0 && ++reloadAttempts === 1)
      return {
        status: 503,
        body: {
          error: { code: "SERVICE_UNAVAILABLE", message: "Unavailable" },
        },
      };
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
  await expect.poll(() => reloadAttempts).toBe(1);
  await expect
    .element(screen.getByLabelText(t.fieldCompanyName))
    .toHaveValue("Saved despite disconnect");
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
                  role: "__proto__",
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
  if (matchMedia("(max-width: 760px)").matches)
    await screen
      .getByRole("button", { name: shellMessages[locale].menu })
      .click();
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
          profiles: [],
          responsible: false,
          capabilities: ["company.view", "branches.view"],
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
const memberPath = `${companyPath}?view=members&member=${memberId}`;
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
      grants: roles.map((role, index) => ({
        id: `00000000-0000-4000-8000-00000000010${index}`,
        role,
        profile: null,
        scope: "COMPANY",
        branches: [],
        startsAt: "2026-10-18T12:00:00.000Z",
        expiresAt: null,
      })),
    },
  ],
  nextCursor: null,
});
const memberCompany = {
  company: { id: companyId, displayName: "Member company" },
  access: memberAccess,
};

test("filters members on the current page and restores the filters after viewing a person", async () => {
  const hiddenId = "00000000-0000-4000-8000-000000000010";
  respond((url) => ({
    body: url.pathname.endsWith("/members")
      ? {
          items: [
            { ...memberPage().items[0], displayName: "João Lima" },
            {
              ...memberPage("SUSPENDED").items[0],
              id: hiddenId,
              displayName: "Other person",
              email: "other@example.test",
            },
          ],
          nextCursor: null,
        }
      : memberCompany,
  }));
  const { screen, router } = await open(`${companyPath}?view=members`);
  const search = screen.getByRole("searchbox", {
    name: t.memberWorkspace.search,
  });
  await search.fill("joao");
  await expect
    .element(screen.getByRole("link", { name: /João Lima/ }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("link", { name: /Other person/ }))
    .not.toBeInTheDocument();
  await screen.getByRole("link", { name: /João Lima/ }).click();
  expect(router.state.location.search).toMatchObject({
    view: "members",
    member: memberId,
  });
  await expect
    .element(screen.getByRole("article", { name: "João Lima" }))
    .toBeVisible();
  await screen.getByRole("link", { name: t.memberWorkspace.back }).click();
  await expect.element(search).toHaveValue("joao");
  await screen.getByRole("button", { name: t.memberWorkspace.clear }).click();
  await screen
    .getByRole("combobox", { name: t.memberWorkspace.status })
    .selectOptions("SUSPENDED");
  await expect
    .element(screen.getByRole("link", { name: /Other person/ }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("link", { name: /João Lima/ }))
    .not.toBeInTheDocument();
});

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
  const { screen, client } = await open(memberPath);
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
  const { screen } = await open(memberPath);
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
  const { screen } = await open(memberPath);
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
      `/api/auth/login?returnTo=${encodeURIComponent(memberPath)}&reauthenticate=true`,
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
  const { screen, router } = await open(memberPath);
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
  await screen.getByRole("link", { name: t.memberWorkspace.back }).click();
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

const northId = "00000000-0000-4000-8000-000000000021";
const posted = (suffix: string) =>
  vi
    .mocked(fetch)
    .mock.calls.map(([input]) => input)
    .find(
      (input): input is Request =>
        input instanceof Request &&
        input.method === "POST" &&
        new URL(input.url).pathname.endsWith(suffix),
    );

test("grants a temporary branch-scoped role over selected active branches", async () => {
  respond((url, request) => {
    if (request instanceof Request && request.method === "POST")
      return {
        status: 201,
        body: {
          id: "00000000-0000-4000-8000-000000000031",
          role: "BRANCH_MANAGER",
          scope: "BRANCHES",
          branches: [{ id: northId, name: "Norte" }],
          startsAt: "2026-10-18T12:00:00.000Z",
          expiresAt: "2030-01-02T06:04:00.000Z",
        },
      };
    if (url.pathname.endsWith("/branches"))
      return {
        body: {
          items: [
            {
              id: northId,
              name: "Norte",
              status: "ACTIVE",
              version: 1,
              timeZone: "UTC",
            },
            {
              id: "00000000-0000-4000-8000-000000000022",
              name: "Antiga",
              status: "ARCHIVED",
              version: 2,
              timeZone: "UTC",
            },
          ],
          nextCursor: null,
        },
      };
    if (url.pathname.endsWith("/access-profiles"))
      return { body: { items: [] } };
    return {
      body: url.pathname.endsWith("/members") ? memberPage() : memberCompany,
    };
  });
  const { screen } = await open(memberPath);
  await screen
    .getByRole("button", { name: `${t.grantAdd}: Synthetic member` })
    .click();
  await expect
    .element(
      screen.getByRole("option", { name: t.roles.COMPANY_ADMINISTRATOR }),
    )
    .toBeInTheDocument();
  await screen.getByLabelText(t.grantRole).selectOptions("BRANCH_MANAGER");
  await screen.getByRole("radio", { name: t.grantScopeBranches }).click();
  await expect
    .element(screen.getByRole("button", { name: t.grantSubmit }))
    .toBeDisabled();
  await expect
    .element(screen.getByRole("checkbox", { name: "Antiga" }))
    .not.toBeInTheDocument();
  await screen.getByRole("checkbox", { name: "Norte" }).click();
  await screen.getByLabelText(t.grantExpiry).fill("2030-01-02T03:04");
  await screen.getByRole("button", { name: t.grantSubmit }).click();
  await expect
    .element(screen.getByRole("button", { name: t.grantSubmit }))
    .not.toBeInTheDocument();
  const request = posted(`/members/${memberId}/grants`);
  if (!request) throw new Error("The grant request was not sent");
  expect(await request.clone().json()).toEqual({
    role: "BRANCH_MANAGER",
    scope: "BRANCHES",
    branchIds: [northId],
    expiresAt: new Date("2030-01-02T03:04").toISOString(),
  });
  expect(
    vi
      .mocked(fetch)
      .mock.calls.some(
        ([input]) =>
          input instanceof Request &&
          new URL(input.url).pathname.endsWith("/branches") &&
          new URL(input.url).searchParams.get("limit") === "100",
      ),
  ).toBe(true);
});

test("keeps administration out of a non-responsible administrator's grant form", async () => {
  respond((url) => ({
    body: url.pathname.endsWith("/access-profiles")
      ? { items: [] }
      : url.pathname.endsWith("/members")
        ? memberPage()
        : {
            ...memberCompany,
            access: { ...memberAccess, responsible: false },
          },
  }));
  const { screen } = await open(memberPath);
  await screen
    .getByRole("button", { name: `${t.grantAdd}: Synthetic member` })
    .click();
  await expect.element(screen.getByText(t.grantResponsibleOnly)).toBeVisible();
  await expect
    .element(
      screen.getByRole("option", { name: t.roles.COMPANY_ADMINISTRATOR }),
    )
    .not.toBeInTheDocument();
  await expect
    .element(
      screen.getByRole("button", {
        name: `${t.transferPropose}: Synthetic member`,
      }),
    )
    .not.toBeInTheDocument();
});

const profileId = "00000000-0000-4000-8000-000000000041";
const accessProfile = (overrides: Record<string, unknown> = {}) => ({
  id: profileId,
  name: "Auditor",
  capabilities: ["branches.view", "audit.view"],
  status: "ACTIVE",
  version: 1,
  createdAt: "2026-10-18T12:00:00.000Z",
  updatedAt: "2026-10-18T12:00:00.000Z",
  memberCount: 0,
  grantCount: 0,
  ...overrides,
});

test("grants a customized access profile and names it on the member", async () => {
  respond((url, request) => {
    if (request instanceof Request && request.method === "POST")
      return {
        status: 201,
        body: {
          id: "00000000-0000-4000-8000-000000000032",
          role: null,
          profile: { id: profileId, name: "Auditor" },
          scope: "COMPANY",
          branches: [],
          startsAt: "2026-10-18T12:00:00.000Z",
          expiresAt: null,
        },
      };
    if (url.pathname.endsWith("/access-profiles"))
      return { body: { items: [accessProfile()] } };
    if (url.pathname.endsWith("/members")) {
      const page = memberPage("ACTIVE", 1, []);
      return {
        body: {
          ...page,
          items: [
            {
              ...page.items[0],
              grants: [
                {
                  id: "00000000-0000-4000-8000-000000000033",
                  role: null,
                  profile: { id: profileId, name: "Auditor" },
                  scope: "COMPANY",
                  branches: [],
                  startsAt: "2026-10-18T12:00:00.000Z",
                  expiresAt: null,
                },
              ],
            },
          ],
        },
      };
    }
    return { body: memberCompany };
  });
  const { screen } = await open(memberPath);
  await expect
    .element(screen.getByText(`${t.grantProfile}: Auditor`))
    .toBeVisible();
  await expect
    .element(
      screen.getByRole("button", {
        name: `${t.grantRevoke}: ${t.grantProfile}: Auditor · Synthetic member`,
      }),
    )
    .toBeVisible();
  await screen
    .getByRole("button", { name: `${t.grantAdd}: Synthetic member` })
    .click();
  await screen
    .getByLabelText(t.grantRoleOrProfile)
    .selectOptions(`profile:${profileId}`);
  await expect
    .element(
      screen.getByText(
        `${t.grantProfileIncludes}: ${t.capabilities["branches.view"]}, ${t.capabilities["audit.view"]}`,
      ),
    )
    .toBeVisible();
  await screen.getByRole("button", { name: t.grantSubmit }).click();
  await expect
    .element(screen.getByRole("button", { name: t.grantSubmit }))
    .not.toBeInTheDocument();
  const request = posted(`/members/${memberId}/grants`);
  if (!request) throw new Error("The grant request was not sent");
  expect(await request.clone().json()).toEqual({
    profileId,
    scope: "COMPANY",
  });
});

test("creates profiles and confirms a capability change that reaches members", async () => {
  let current = accessProfile({ memberCount: 1, grantCount: 1 });
  respond((url, request) => {
    if (request instanceof Request && request.method === "POST")
      return {
        status: 201,
        body: accessProfile({
          id: "00000000-0000-4000-8000-000000000042",
          name: "Recepção",
          capabilities: ["invitations.manage"],
        }),
      };
    if (request instanceof Request && request.method === "PATCH") {
      current = {
        ...current,
        version: 2,
        capabilities: ["audit.view"],
      };
      return { body: current };
    }
    if (url.pathname.endsWith(`/access-profiles/${profileId}`))
      return {
        body: {
          profile: current,
          holders: [
            {
              grantId: "00000000-0000-4000-8000-000000000033",
              membershipId: memberId,
              membershipStatus: "ACTIVE",
              displayName: "Synthetic member",
              email: "member@example.test",
              scope: "BRANCHES",
              branches: [{ id: northId, name: "Norte" }],
              expiresAt: null,
            },
          ],
          holdersTruncated: false,
        },
      };
    if (url.pathname.endsWith("/access-profiles"))
      return { body: { items: [current] } };
    return { body: memberCompany };
  });
  const { screen } = await open(`${companyPath}?view=profiles`);
  await expect
    .element(screen.getByRole("link", { name: t.profilesTitle }))
    .toHaveAttribute("aria-current", "page");
  await expect.element(screen.getByText(t.profileUsage(1, 1))).toBeVisible();
  await screen.getByRole("link", { name: "Auditor", exact: true }).click();
  await expect
    .element(screen.getByRole("button", { name: `${t.archive}: Auditor` }))
    .toBeDisabled();
  await screen
    .getByRole("button", { name: t.profileEdit, exact: true })
    .click();
  await expect
    .element(screen.getByText("Synthetic member", { exact: true }))
    .toBeVisible();
  await expect
    .element(screen.getByText(`${t.grantBranches}: Norte`, { exact: true }))
    .toBeVisible();
  await expect
    .element(screen.getByText(t.profileWorkspace.noExpiry))
    .toBeVisible();
  const editor = screen.getByRole("form", {
    name: `${t.profileEdit}: Auditor`,
  });
  await editor
    .getByRole("checkbox", { name: t.capabilities["branches.view"] })
    .click();
  await editor.getByRole("button", { name: t.save }).click();
  await expect
    .element(screen.getByText(t.profileChangeConfirmation(1)))
    .toBeVisible();
  expect(
    vi
      .mocked(fetch)
      .mock.calls.some(
        ([input]) => input instanceof Request && input.method === "PATCH",
      ),
  ).toBe(false);
  await editor.getByRole("button", { name: t.profileChangeConfirm }).click();
  await expect
    .element(screen.getByText(t.profileChangeConfirmation(1)))
    .not.toBeInTheDocument();
  const update = vi
    .mocked(fetch)
    .mock.calls.map(([input]) => input)
    .find(
      (input): input is Request =>
        input instanceof Request && input.method === "PATCH",
    );
  if (!update) throw new Error("The profile update was not sent");
  expect(await update.clone().json()).toEqual({
    expectedVersion: 1,
    capabilities: ["audit.view"],
  });

  await screen.getByRole("link", { name: t.profileWorkspace.back }).click();
  await screen
    .getByRole("button", { name: t.profileCreate, exact: true })
    .click();
  await screen.getByLabelText(t.profileName).fill("Recepção");
  const create = screen.getByRole("form", { name: t.profileCreateTitle });
  await expect
    .element(create.getByRole("button", { name: t.profileCreate }))
    .toBeDisabled();
  await create
    .getByRole("checkbox", { name: t.capabilities["invitations.manage"] })
    .click();
  await create.getByRole("button", { name: t.profileCreate }).click();
  const created = posted("/access-profiles");
  if (!created) throw new Error("The profile was not created");
  expect(await created.clone().json()).toEqual({
    name: "Recepção",
    capabilities: ["invitations.manage"],
  });
});

test("keeps each profile capability together with the one it needs", async () => {
  respond((url) =>
    url.pathname.endsWith("/access-profiles")
      ? { body: { items: [] } }
      : { body: memberCompany },
  );
  const { screen } = await open(`${companyPath}?view=profiles&profile=new`);
  const create = screen.getByRole("form", { name: t.profileCreateTitle });
  const box = (capability: keyof typeof t.capabilities) =>
    create.getByRole("checkbox", { name: t.capabilities[capability] });
  await box("media.upload").click();
  await expect.element(box("media.view")).toBeChecked();
  await box("media.view").click();
  await expect.element(box("media.upload")).not.toBeChecked();
});

test("names the access profile of profile history events", async () => {
  respond((url) =>
    url.pathname.endsWith("/audit-events")
      ? {
          body: {
            items: [
              {
                id: "profile-event",
                action: "profile.updated",
                actorPrincipalId: "synthetic",
                occurredAt: "2026-10-18T12:00:00.000Z",
                targetType: "access_profile",
                details: {
                  profileName: "Auditor",
                  fields: ["name", "capabilities"],
                },
              },
            ],
            nextCursor: null,
          },
        }
      : { body: { ...memberCompany, access: administratorAccess } },
  );
  const { screen } = await open(`${companyPath}?view=history`);
  await expect
    .element(screen.getByText(t.historyActions["profile.updated"]))
    .toBeVisible();
  await expect
    .element(screen.getByText(`${t.historyProfile}: Auditor`))
    .toBeVisible();
  await expect
    .element(
      screen.getByText(
        `${t.historyFields.profileName}, ${t.historyFields.capabilities}`,
      ),
    )
    .toBeVisible();
});

test("revokes a role after confirmation and keeps the responsible administrator's only administration", async () => {
  const managerGrant = "00000000-0000-4000-8000-000000000041";
  const expiresAt = "2030-01-02T06:04:00.000Z";
  respond((url, request) =>
    request instanceof Request && request.method === "POST"
      ? { status: 204, body: null }
      : {
          body: url.pathname.endsWith("/members")
            ? {
                items: [
                  {
                    ...memberPage("ACTIVE", 1, ["COMPANY_ADMINISTRATOR"])
                      .items[0],
                    id: "00000000-0000-4000-8000-000000000008",
                    displayName: "Responsible member",
                    responsible: true,
                  },
                  {
                    ...memberPage().items[0],
                    roles: ["BRANCH_MANAGER", "OPERATOR"],
                    grants: [
                      ...memberPage().items[0].grants,
                      {
                        id: managerGrant,
                        role: "BRANCH_MANAGER",
                        scope: "BRANCHES",
                        branches: [{ id: northId, name: "Norte" }],
                        startsAt: "2026-10-18T12:00:00.000Z",
                        expiresAt,
                      },
                    ],
                  },
                ],
                nextCursor: null,
              }
            : memberCompany,
        },
  );
  const { screen } = await open(
    `${companyPath}?view=members&member=00000000-0000-4000-8000-000000000008`,
  );
  await expect
    .element(screen.getByText(t.memberResponsibleProtected))
    .toBeVisible();
  await expect
    .element(
      screen.getByRole("button", {
        name: `${t.grantRevoke}: ${t.roles.COMPANY_ADMINISTRATOR} · Responsible member`,
      }),
    )
    .not.toBeInTheDocument();
  await screen.getByRole("link", { name: t.memberWorkspace.back }).click();
  await screen
    .getByRole("link", { name: "Synthetic member", exact: false })
    .click();
  await expect
    .element(
      screen.getByText(
        `${t.grantBranches}: Norte · ${t.grantUntil} ${formatInstant(locale, expiresAt)}`,
        { exact: false },
      ),
    )
    .toBeVisible();
  await screen
    .getByRole("button", {
      name: `${t.grantRevoke}: ${t.roles.BRANCH_MANAGER} · Synthetic member`,
    })
    .click();
  await expect
    .element(screen.getByText(t.grantRevokeConfirmation))
    .toBeVisible();
  await screen.getByRole("button", { name: t.grantRevokeConfirm }).click();
  await expect
    .element(screen.getByText(t.grantRevokeConfirmation))
    .not.toBeInTheDocument();
  expect(
    posted(`/members/${memberId}/grants/${managerGrant}/revoke`),
  ).toBeDefined();
});

test("proposes a responsibility transfer and lets the proposer cancel it", async () => {
  const transfer = {
    id: "00000000-0000-4000-8000-000000000051",
    direction: "outgoing",
    fromMembershipId: "00000000-0000-4000-8000-000000000008",
    toMembershipId: memberId,
    counterpartName: "Synthetic member",
    counterpartEmail: "member@example.test",
    createdAt: "2026-10-18T12:00:00.000Z",
    expiresAt: "2026-10-25T12:00:00.000Z",
  };
  let pending = false;
  respond((url, request) => {
    if (request instanceof Request && request.method === "POST") {
      pending = !url.pathname.endsWith("/cancel");
      return pending
        ? { status: 201, body: transfer }
        : { status: 204, body: null };
    }
    return {
      body: url.pathname.endsWith("/members")
        ? memberPage("ACTIVE", 1, ["COMPANY_ADMINISTRATOR"])
        : {
            ...memberCompany,
            responsibilityTransfer: pending ? transfer : null,
          },
    };
  });
  const { screen } = await open(memberPath);
  await screen
    .getByRole("button", { name: `${t.transferPropose}: Synthetic member` })
    .click();
  await expect.element(screen.getByText(t.transferConfirmation)).toBeVisible();
  await screen.getByRole("button", { name: t.transferConfirm }).click();
  await expect
    .element(screen.getByRole("status"))
    .toMatchTextContent(
      t.transferOutgoing(
        "Synthetic member",
        formatInstant(locale, transfer.expiresAt),
      ),
    );
  await expect
    .element(
      screen.getByRole("button", {
        name: `${t.transferPropose}: Synthetic member`,
      }),
    )
    .not.toBeInTheDocument();
  const request = posted("/responsibility-transfers");
  if (!request) throw new Error("The transfer request was not sent");
  expect(await request.clone().json()).toEqual({
    successorMembershipId: memberId,
  });
  await screen.getByRole("button", { name: t.transferCancel }).click();
  await expect.element(screen.getByRole("status")).not.toBeInTheDocument();
  expect(
    posted(`/responsibility-transfers/${transfer.id}/cancel`),
  ).toBeDefined();
});

test("asks the successor for recent verification before accepting responsibility", async () => {
  const transferId = "00000000-0000-4000-8000-000000000061";
  respond((_url, request) =>
    request instanceof Request && request.method === "POST"
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
          body: {
            ...memberCompany,
            access: { ...memberAccess, responsible: false },
            responsibilityTransfer: {
              id: transferId,
              direction: "incoming",
              fromMembershipId: "00000000-0000-4000-8000-000000000008",
              toMembershipId: memberId,
              counterpartName: null,
              counterpartEmail: "owner@example.test",
              createdAt: "2026-10-18T12:00:00.000Z",
              expiresAt: "2026-10-25T12:00:00.000Z",
            },
          },
        },
  );
  const { screen } = await open(companyPath);
  await expect
    .element(screen.getByRole("status"))
    .toMatchTextContent(
      t.transferIncoming(
        "owner@example.test",
        formatInstant(locale, "2026-10-25T12:00:00.000Z"),
      ),
    );
  await expect
    .element(screen.getByRole("button", { name: t.transferDecline }))
    .toBeVisible();
  await screen.getByRole("button", { name: t.transferAccept }).click();
  await expect
    .element(screen.getByRole("link", { name: t.memberReauthenticate }))
    .toHaveAttribute(
      "href",
      `/api/auth/login?returnTo=${encodeURIComponent(companyPath)}&reauthenticate=true`,
    );
  expect(
    posted(`/responsibility-transfers/${transferId}/accept`),
  ).toBeDefined();
});

test("names the role of grant history events", async () => {
  respond((url) =>
    url.pathname.endsWith("/audit-events")
      ? {
          body: {
            items: [
              {
                id: "grant-event",
                action: "grant.created",
                actorPrincipalId: "another-person",
                occurredAt: "2026-10-18T12:00:00.000Z",
                targetType: "membership",
                details: { role: "BRANCH_MANAGER", scope: "BRANCHES" },
              },
            ],
            nextCursor: null,
          },
        }
      : { body: { ...memberCompany, access: administratorAccess } },
  );
  const { screen } = await open(`${companyPath}?view=history`);
  await expect
    .element(screen.getByText(t.historyActions["grant.created"]))
    .toBeVisible();
  await expect
    .element(screen.getByText(`${t.historyRole}: ${t.roles.BRANCH_MANAGER}`))
    .toBeVisible();
});

test("offers branch managers the history of their own branches", async () => {
  respond((url) =>
    url.pathname.endsWith("/audit-events")
      ? {
          body: {
            items: [
              {
                id: "branch-event",
                action: "branch.created",
                actorPrincipalId: "another-person",
                occurredAt: "2026-10-18T12:00:00.000Z",
                targetType: "branch",
                details: { branchName: "Norte" },
              },
            ],
            nextCursor: null,
          },
        }
      : {
          body: {
            ...memberCompany,
            access: {
              roles: ["BRANCH_MANAGER"],
              profiles: [],
              responsible: false,
              capabilities: [
                "company.view",
                "branches.view",
                "invitations.manage",
                "audit.view",
              ],
            },
          },
        },
  );
  const { screen } = await open(`${companyPath}?view=history`);
  await expect
    .element(screen.getByRole("link", { name: t.historyTitle }))
    .toBeVisible();
  await expect.element(screen.getByText(t.historyLeadBranches)).toBeVisible();
  await expect
    .element(screen.getByText(`${t.fieldBranchName}: Norte`))
    .toBeVisible();
});

test("never shows history read under a wider access after the access narrows", async () => {
  let manager = false;
  respond((url) =>
    url.pathname.endsWith("/audit-events")
      ? {
          body: {
            items: [
              manager
                ? {
                    id: "branch-event",
                    action: "branch.created",
                    actorPrincipalId: "another-person",
                    occurredAt: "2026-10-18T12:00:00.000Z",
                    targetType: "branch",
                    details: { branchName: "Norte" },
                  }
                : {
                    id: "company-event",
                    action: "company.updated",
                    actorPrincipalId: "another-person",
                    occurredAt: "2026-10-18T12:00:00.000Z",
                    targetType: "company",
                    details: { fields: ["displayName"] },
                  },
            ],
            nextCursor: null,
          },
        }
      : {
          body: {
            ...memberCompany,
            access: manager
              ? {
                  ...memberAccess,
                  roles: ["BRANCH_MANAGER"],
                  responsible: false,
                  capabilities: ["company.view", "branches.view", "audit.view"],
                }
              : {
                  ...memberAccess,
                  capabilities: [...memberAccess.capabilities, "audit.view"],
                },
          },
        },
  );
  const { screen, client } = await open(`${companyPath}?view=history`);
  await expect
    .element(screen.getByText(t.historyActions["company.updated"]))
    .toBeVisible();
  manager = true;
  // Only the company access refreshes, as when another session narrows it.
  await client.invalidateQueries({ queryKey: companyKey(companyId) });
  await expect.element(screen.getByText(t.historyLeadBranches)).toBeVisible();
  await expect
    .element(screen.getByText(t.historyActions["company.updated"]))
    .not.toBeInTheDocument();
  await expect
    .element(screen.getByText(`${t.fieldBranchName}: Norte`))
    .toBeVisible();
});

const invitationAccess = {
  ...memberAccess,
  capabilities: [...memberAccess.capabilities, "invitations.manage"],
};
const invitationItem = {
  id: "00000000-0000-4000-8000-000000000071",
  recipientEmail: "guest@example.test",
  role: "OPERATOR",
  scope: "COMPANY",
  branches: [],
  grantExpiresAt: null,
  status: "PENDING",
  delivery: "SENT",
  invitedByName: "Owner Person",
  createdAt: "2026-10-18T12:00:00.000Z",
  expiresAt: "2026-10-25T12:00:00.000Z",
};

test("invites by email and revokes a pending invitation after confirmation", async () => {
  let created = false;
  respond((url, request) => {
    if (request instanceof Request && request.method === "POST") {
      created = true;
      return url.pathname.endsWith("/revoke")
        ? { status: 204, body: null }
        : { status: 201, body: { ...invitationItem, delivery: "PENDING" } };
    }
    if (url.pathname.endsWith("/invitations"))
      return {
        body: { items: created ? [invitationItem] : [], nextCursor: null },
      };
    return { body: { ...memberCompany, access: invitationAccess } };
  });
  const { screen } = await open(`${companyPath}?view=invitations`);
  await expect.element(screen.getByText(t.invitationsEmpty)).toBeVisible();
  await screen
    .getByRole("button", { name: t.inviteTitle, exact: true })
    .click();
  await expect
    .element(
      screen.getByRole("option", { name: t.roles.COMPANY_ADMINISTRATOR }),
    )
    .toBeInTheDocument();
  await screen.getByLabelText(t.inviteEmail).fill("guest@example.test");
  await screen.getByRole("button", { name: t.inviteSubmit }).click();
  await expect.element(screen.getByText(t.inviteSent)).toBeVisible();
  const request = posted(`/companies/${companyId}/invitations`);
  if (!request) throw new Error("The invitation request was not sent");
  expect(await request.clone().json()).toEqual({
    email: "guest@example.test",
    role: "OPERATOR",
    scope: "COMPANY",
  });
  await expect
    .element(screen.getByText(t.deliveryStates.SENT, { exact: false }))
    .toBeVisible();
  await screen
    .getByRole("button", { name: t.invitationRevoke, exact: true })
    .click();
  await expect
    .element(screen.getByText(t.invitationRevokeConfirmation))
    .toBeVisible();
  await screen.getByRole("button", { name: t.grantRevokeConfirm }).click();
  await expect
    .element(screen.getByText(t.invitationRevokeConfirmation))
    .not.toBeInTheDocument();
  expect(posted(`/invitations/${invitationItem.id}/revoke`)).toBeDefined();
});

test("lets a branch manager invite operators only to managed branches", async () => {
  respond((url, request) => {
    if (request instanceof Request && request.method === "POST")
      return { status: 201, body: invitationItem };
    if (url.pathname.endsWith("/branches"))
      return {
        body: {
          items: [
            {
              id: northId,
              name: "Norte",
              status: "ACTIVE",
              version: 1,
              timeZone: "UTC",
            },
          ],
          nextCursor: null,
        },
      };
    if (url.pathname.endsWith("/invitations"))
      return { body: { items: [], nextCursor: null } };
    return {
      body: {
        ...memberCompany,
        access: {
          roles: ["BRANCH_MANAGER"],
          profiles: [],
          responsible: false,
          capabilities: ["company.view", "branches.view", "invitations.manage"],
        },
      },
    };
  });
  const { screen } = await open(
    `${companyPath}?view=invitations&invitation=new`,
  );
  await expect.element(screen.getByText(t.inviteManagerHint)).toBeVisible();
  await expect
    .element(screen.getByRole("option", { name: t.roles.BRANCH_MANAGER }))
    .not.toBeInTheDocument();
  await expect
    .element(screen.getByRole("radio", { name: t.grantScopeCompany }))
    .not.toBeInTheDocument();
  await screen.getByLabelText(t.inviteEmail).fill("operator@example.test");
  await expect
    .element(screen.getByRole("button", { name: t.inviteSubmit }))
    .toBeDisabled();
  await screen.getByRole("checkbox", { name: "Norte" }).click();
  await screen.getByRole("button", { name: t.inviteSubmit }).click();
  await expect.element(screen.getByText(t.inviteSent)).toBeVisible();
  const request = posted(`/companies/${companyId}/invitations`);
  if (!request) throw new Error("The invitation request was not sent");
  expect(await request.clone().json()).toEqual({
    email: "operator@example.test",
    role: "OPERATOR",
    scope: "BRANCHES",
    branchIds: [northId],
  });
});

const credential = "C".repeat(43);
const previewBody = {
  companyId,
  companyName: "Invited company",
  role: "OPERATOR",
  scope: "COMPANY",
  branches: [],
  grantExpiresAt: null,
  expiresAt: "2026-10-25T12:00:00.000Z",
  invitedByName: "Owner Person",
  status: "PENDING",
};

test("keeps the invitation credential out of the address and asks to sign in", async () => {
  respond((url) =>
    url.pathname.endsWith("/auth/session")
      ? {
          status: 401,
          body: {
            error: { code: "AUTHENTICATION_REQUIRED", message: "Sign in" },
          },
        }
      : { body: previewBody },
  );
  const { screen, router } = await open(
    `/invitations/accept#${credential}`,
    false,
  );
  await expect.element(screen.getByText(t.acceptSignIn)).toBeVisible();
  await expect
    .element(screen.getByRole("main").getByRole("link", { name: t.signIn }))
    .toHaveAttribute(
      "href",
      `/api/auth/login?returnTo=${encodeURIComponent("/invitations/accept")}`,
    );
  // Someone without an account creates one and returns to this page.
  await expect.element(screen.getByText(t.acceptSignUp)).toBeVisible();
  await expect
    .element(screen.getByRole("main").getByRole("link", { name: t.signUp }))
    .toHaveAttribute(
      "href",
      `/api/auth/login?returnTo=${encodeURIComponent("/invitations/accept")}&intent=signup`,
    );
  expect(router.state.location.hash).toBe("");
  expect(sessionStorage.getItem("teluni.invitation")).toBe(credential);
  sessionStorage.removeItem("teluni.invitation");
});

test("accepts a previewed invitation and opens the company", async () => {
  sessionStorage.setItem("teluni.invitation", credential);
  respond((url) =>
    url.pathname.endsWith("/invitations/accept")
      ? { status: 201, body: { companyId, membershipId: memberId } }
      : url.pathname.endsWith("/invitations/preview")
        ? { body: previewBody }
        : {
            body: {
              ...memberCompany,
              company: { id: companyId, displayName: "Invited company" },
            },
          },
  );
  const { screen, router } = await open("/invitations/accept");
  await expect
    .element(screen.getByText("Invited company", { exact: true }))
    .toBeVisible();
  await expect.element(screen.getByText("Owner Person")).toBeVisible();
  await screen.getByRole("button", { name: t.acceptButton }).click();
  await expect.poll(() => router.state.location.pathname).toBe(companyPath);
  expect(sessionStorage.getItem("teluni.invitation")).toBeNull();
  const request = posted("/invitations/accept");
  if (!request) throw new Error("The acceptance request was not sent");
  expect(await request.clone().json()).toEqual({ credential });
});

test("explains a recipient mismatch without accepting", async () => {
  sessionStorage.setItem("teluni.invitation", credential);
  respond(() => ({
    status: 403,
    body: {
      error: {
        code: "INVITATION_RECIPIENT_MISMATCH",
        message: "Sent to another address",
      },
    },
  }));
  const { screen } = await open("/invitations/accept");
  await expect
    .element(screen.getByRole("alert"))
    .toMatchTextContent(t.errors.INVITATION_RECIPIENT_MISMATCH);
  await expect
    .element(screen.getByRole("button", { name: t.acceptButton }))
    .not.toBeInTheDocument();
  sessionStorage.removeItem("teluni.invitation");
});

test("removes company navigation after a denied refetch even when cached access remains", async () => {
  let revoked = false;
  respond((url) =>
    url.pathname.endsWith("/branches")
      ? { body: { items: [], nextCursor: null } }
      : revoked
        ? {
            status: 403,
            body: { error: { code: "PERMISSION_DENIED", message: "Denied" } },
          }
        : { body: { ...memberCompany, access: administratorAccess } },
  );
  const { screen, client } = await open(companyPath);
  await expect
    .element(screen.getByRole("link", { name: t.settingsTitle }))
    .toBeVisible();
  revoked = true;
  await client.invalidateQueries({ queryKey: companyKey(companyId) });
  await expect
    .element(screen.getByRole("alert"))
    .toMatchTextContent(t.errors.PERMISSION_DENIED);
  expect(client.getQueryData(companyKey(companyId))).toBeDefined();
  await expect
    .element(screen.getByRole("link", { name: t.settingsTitle }))
    .not.toBeInTheDocument();
  await expect
    .element(
      screen.getByRole("group", { name: memberCompany.company.displayName }),
    )
    .not.toBeInTheDocument();
});

test("requires a confirmed map point and submits the full address without a client time zone", async () => {
  const city = {
    id: "3448439",
    name: "São Paulo",
    region: "São Paulo",
    countryCode: "BR",
    latitude: -23.55052,
    longitude: -46.633308,
  };
  respond((url, request) => {
    if (url.pathname.endsWith("/organization-locations"))
      return { body: { items: [city] } };
    if (url.pathname.endsWith("/branches")) {
      if (request instanceof Request && request.method === "POST")
        return {
          status: 201,
          body: {
            id: "new-branch",
            companyId,
            name: "Map branch",
            location: { latitude: -23.55, longitude: -46.63 },
            address: "Avenida de teste, 100, São Paulo, SP, Brasil",
            timeZone: "America/Sao_Paulo",
            status: "ACTIVE",
            version: 1,
          },
        };
      return { body: { items: [], nextCursor: null } };
    }
    return {
      body: {
        company: { id: companyId, displayName: "Map company" },
        access: {
          ...administratorAccess,
          capabilities: [
            ...administratorAccess.capabilities,
            "branches.manage",
          ],
        },
      },
    };
  });
  const { screen } = await open(`${companyPath}?mode=form&record=new`);
  await screen
    .getByRole("textbox", { name: t.fieldBranchName, exact: true })
    .fill("Map branch");
  await screen
    .getByLabelText(t.fieldAddress, { exact: true })
    .fill("Avenida de teste, 100, São Paulo, SP, Brasil");
  await expect
    .element(screen.getByRole("button", { name: t.addBranch, exact: true }))
    .toBeDisabled();
  await screen.getByLabelText(t.citySearch, { exact: true }).fill("sao paulo");
  const cityLabel = `São Paulo, São Paulo, ${new Intl.DisplayNames([locale], { type: "region" }).of("BR")}`;
  await screen.getByRole("button", { name: cityLabel, exact: true }).click();
  await expect
    .element(screen.getByRole("button", { name: t.addBranch, exact: true }))
    .toBeDisabled();
  await screen.getByText(t.coordinatesAlternative, { exact: true }).click();
  await screen.getByLabelText(t.latitude, { exact: true }).fill("-23.55");
  await screen.getByLabelText(t.longitude, { exact: true }).fill("-46.63");
  await screen
    .getByRole("button", { name: t.confirmPoint, exact: true })
    .click();
  await expect
    .element(screen.getByRole("button", { name: t.addBranch, exact: true }))
    .toBeEnabled();
  await expect
    .element(screen.getByLabelText(t.fieldTimeZone))
    .not.toBeInTheDocument();
  await screen.getByRole("button", { name: t.addBranch, exact: true }).click();
  await expect
    .poll(() =>
      vi
        .mocked(fetch)
        .mock.calls.some(
          ([input]) =>
            input instanceof Request &&
            input.method === "POST" &&
            input.url.endsWith("/branches"),
        ),
    )
    .toBe(true);
  const request = vi
    .mocked(fetch)
    .mock.calls.map(([input]) => input)
    .find(
      (input) =>
        input instanceof Request &&
        input.method === "POST" &&
        input.url.endsWith("/branches"),
    );
  expect(request).toBeInstanceOf(Request);
  expect(await (request as Request).clone().json()).toEqual({
    name: "Map branch",
    location: { latitude: -23.55, longitude: -46.63 },
    address: "Avenida de teste, 100, São Paulo, SP, Brasil",
  });
});

test("discards the entire new branch draft so an existing branch can be opened", async () => {
  const branch = {
    id: "00000000-0000-4000-8000-000000000002",
    name: "Existing branch",
    location: null,
    address: null,
    version: 1,
    status: "ACTIVE",
    timeZone: "UTC",
  };
  respond((url) =>
    url.pathname.endsWith("/branches")
      ? { body: { items: [branch], nextCursor: null } }
      : {
          body: {
            company: { id: companyId, displayName: "Draft company" },
            access: {
              ...administratorAccess,
              capabilities: [
                ...administratorAccess.capabilities,
                "branches.manage",
              ],
            },
          },
        },
  );
  const { screen } = await open(`${companyPath}?mode=form&record=new`);
  await screen
    .getByRole("textbox", { name: t.fieldBranchName, exact: true })
    .fill("Discarded branch");
  await screen
    .getByLabelText(t.fieldAddress, { exact: true })
    .fill("Discarded full address");
  await screen.getByText(t.coordinatesAlternative, { exact: true }).click();
  await screen.getByLabelText(t.latitude, { exact: true }).fill("-23.55");
  await screen.getByLabelText(t.longitude, { exact: true }).fill("-46.63");
  await screen
    .getByRole("button", { name: t.confirmPoint, exact: true })
    .click();
  await screen.getByRole("button", { name: t.cancel, exact: true }).click();
  await screen.getByText("Existing branch", { exact: true }).dblClick();
  await expect
    .element(
      screen.getByRole("textbox", { name: t.fieldBranchName, exact: true }),
    )
    .toHaveValue("Existing branch");
  await expect
    .element(screen.getByLabelText(t.fieldAddress, { exact: true }))
    .toHaveValue("");
  await expect
    .element(screen.getByText(t.unsavedChanges, { exact: true }))
    .not.toBeInTheDocument();
});

test("filters profiles by name and state and preserves filters on detail return", async () => {
  const reception = accessProfile({ name: "Recepção" });
  const archived = accessProfile({
    id: "00000000-0000-4000-8000-000000000042",
    name: "Antigo",
    status: "ARCHIVED",
  });
  respond((url) => {
    if (url.pathname.endsWith(`/access-profiles/${profileId}`))
      return {
        body: { profile: reception, holders: [], holdersTruncated: false },
      };
    if (url.pathname.endsWith("/access-profiles"))
      return { body: { items: [reception, archived] } };
    return { body: memberCompany };
  });
  const { screen, router } = await open(`${companyPath}?view=profiles`);
  await expect
    .element(screen.getByRole("form", { name: t.profileCreateTitle }))
    .not.toBeInTheDocument();
  await screen
    .getByRole("searchbox", { name: t.profileWorkspace.search })
    .fill("recepcao");
  await expect
    .element(screen.getByRole("link", { name: "Antigo", exact: true }))
    .not.toBeInTheDocument();
  await screen.getByRole("link", { name: "Recepção", exact: true }).click();
  expect(router.state.location.search).toMatchObject({
    view: "profiles",
    profile: profileId,
  });
  await screen.getByRole("link", { name: t.profileWorkspace.back }).click();
  await expect
    .element(screen.getByRole("searchbox", { name: t.profileWorkspace.search }))
    .toHaveValue("recepcao");
  await screen.getByRole("button", { name: t.profileWorkspace.clear }).click();
  await screen
    .getByRole("combobox", { name: t.profileWorkspace.status, exact: true })
    .selectOptions("ARCHIVED");
  await expect
    .element(screen.getByRole("link", { name: "Antigo", exact: true }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("link", { name: "Recepção", exact: true }))
    .not.toBeInTheDocument();
});

test("confirms archiving an unused profile and keeps archived detail read only", async () => {
  let current = accessProfile();
  let archives = 0;
  respond((url, request) => {
    if (
      url.pathname.endsWith("/archive") &&
      request instanceof Request &&
      request.method === "POST"
    ) {
      archives++;
      current = { ...current, status: "ARCHIVED", version: 2 };
      return { body: current };
    }
    if (url.pathname.endsWith(`/access-profiles/${profileId}`))
      return {
        body: { profile: current, holders: [], holdersTruncated: false },
      };
    if (url.pathname.endsWith("/access-profiles"))
      return { body: { items: [current] } };
    return { body: memberCompany };
  });
  const { screen } = await open(
    `${companyPath}?view=profiles&profile=${profileId}`,
  );
  await screen.getByRole("button", { name: `${t.archive}: Auditor` }).click();
  expect(archives).toBe(0);
  await expect
    .element(
      screen.getByRole("button", { name: t.profileWorkspace.confirmArchive }),
    )
    .toBeDisabled();
  await screen
    .getByRole("checkbox", {
      name: t.profileWorkspace.archiveConfirm("Auditor"),
    })
    .click();
  await screen
    .getByRole("button", { name: t.profileWorkspace.confirmArchive })
    .click();
  await expect
    .element(screen.getByText(t.profileWorkspace.archivedHint))
    .toBeVisible();
  expect(archives).toBe(1);
  expect(
    await posted(`/access-profiles/${profileId}/archive`)?.clone().json(),
  ).toEqual({ expectedVersion: 1 });
  await expect
    .element(screen.getByRole("button", { name: t.profileEdit }))
    .not.toBeInTheDocument();
});

test("keeps a profile draft and observed version across refetch and failed conflict recovery", async () => {
  let current = accessProfile();
  let writes = 0;
  let failRead = false;
  respond((url, request) => {
    if (request instanceof Request && request.method === "PATCH") {
      writes++;
      return {
        status: 409,
        body: {
          error: { code: "RESOURCE_VERSION_CONFLICT", message: "Changed" },
        },
      };
    }
    if (url.pathname.endsWith(`/access-profiles/${profileId}`))
      return failRead
        ? {
            status: 503,
            body: {
              error: { code: "SERVICE_UNAVAILABLE", message: "Unavailable" },
            },
          }
        : { body: { profile: current, holders: [], holdersTruncated: false } };
    if (url.pathname.endsWith("/access-profiles"))
      return { body: { items: [current] } };
    return { body: memberCompany };
  });
  const { screen, client } = await open(
    `${companyPath}?view=profiles&profile=${profileId}`,
  );
  await screen.getByRole("button", { name: t.profileEdit }).click();
  await screen.getByLabelText(t.profileName).fill("My profile draft");
  current = accessProfile({ name: "Concurrent profile", version: 2 });
  await client.invalidateQueries({
    queryKey: profilesKey(companyId),
  });
  await expect
    .element(
      screen.getByRole("heading", { name: "Concurrent profile", exact: true }),
    )
    .toBeVisible();
  await expect
    .element(screen.getByLabelText(t.profileName))
    .toHaveValue("My profile draft");
  await screen.getByRole("button", { name: t.save, exact: true }).click();
  await expect
    .element(screen.getByRole("alert"))
    .toMatchTextContent(t.errors.RESOURCE_VERSION_CONFLICT);
  const patch = vi
    .mocked(fetch)
    .mock.calls.map(([input]) => input)
    .find(
      (input): input is Request =>
        input instanceof Request && input.method === "PATCH",
    );
  expect(await patch?.clone().json()).toEqual({
    expectedVersion: 1,
    name: "My profile draft",
  });
  failRead = true;
  await screen.getByRole("button", { name: t.reload, exact: true }).click();
  await expect
    .element(screen.getByLabelText(t.profileName))
    .toHaveValue("My profile draft");
  await expect
    .element(screen.getByRole("button", { name: t.save, exact: true }))
    .toBeDisabled();
  expect(writes).toBe(1);
  failRead = false;
  await screen
    .getByRole("button", { name: t.reload, exact: true })
    .first()
    .click();
  await expect
    .element(screen.getByLabelText(t.profileName))
    .toHaveValue("Concurrent profile");
});

test("reconciles an unknown profile creation before allowing another submission", async () => {
  let writes = 0;
  let reads = 0;
  respond((url, request) => {
    if (
      url.pathname.endsWith("/access-profiles") &&
      request instanceof Request &&
      request.method === "POST"
    ) {
      writes++;
      throw new TypeError("Synthetic lost profile creation response");
    }
    if (url.pathname.endsWith("/access-profiles")) {
      if (writes && ++reads === 1)
        return {
          status: 503,
          body: {
            error: { code: "SERVICE_UNAVAILABLE", message: "Unavailable" },
          },
        };
      return {
        body: {
          items: writes ? [accessProfile({ name: "Saved profile" })] : [],
        },
      };
    }
    return { body: memberCompany };
  });
  const { screen } = await open(`${companyPath}?view=profiles&profile=new`);
  await screen.getByLabelText(t.profileName).fill("Saved profile");
  await screen
    .getByRole("checkbox", { name: t.capabilities["branches.view"] })
    .click();
  await screen
    .getByRole("button", { name: t.profileCreate, exact: true })
    .click();
  await expect
    .element(screen.getByRole("alert"))
    .toMatchTextContent(t.unknownWrite);
  await expect
    .element(screen.getByRole("button", { name: t.profileCreate, exact: true }))
    .toBeDisabled();
  await screen.getByRole("button", { name: t.reload }).click();
  await expect
    .element(screen.getByLabelText(t.profileName))
    .toHaveValue("Saved profile");
  await expect
    .element(screen.getByRole("button", { name: t.profileCreate, exact: true }))
    .toBeDisabled();
  expect(writes).toBe(1);
  await screen.getByRole("button", { name: t.reload }).click();
  await expect
    .element(screen.getByRole("link", { name: "Saved profile", exact: true }))
    .toBeVisible();
  expect(writes).toBe(1);
});

test("shows profile holder scope, expiry and membership status and denies unauthorized profiles", async () => {
  let authorized = true;
  respond((url) => {
    if (url.pathname.endsWith(`/access-profiles/${profileId}`))
      return {
        body: {
          profile: accessProfile({ memberCount: 1, grantCount: 1 }),
          holders: [
            {
              grantId: "grant-1",
              membershipId: memberId,
              membershipStatus: "SUSPENDED",
              displayName: "Synthetic holder",
              email: "holder@example.test",
              scope: "COMPANY",
              branches: [],
              expiresAt: "2026-12-01T12:00:00.000Z",
            },
          ],
          holdersTruncated: true,
        },
      };
    if (url.pathname.endsWith("/access-profiles"))
      return { body: { items: [] } };
    return {
      body: authorized
        ? memberCompany
        : {
            ...memberCompany,
            access: { ...memberCompany.access, capabilities: ["company.view"] },
          },
    };
  });
  const { screen, client } = await open(
    `${companyPath}?view=profiles&profile=${profileId}`,
  );
  await expect.element(screen.getByText("holder@example.test")).toBeVisible();
  await expect
    .element(screen.getByText(t.memberStatuses.SUSPENDED, { exact: true }))
    .toBeVisible();
  await expect
    .element(screen.getByText(t.grantCompanyWide, { exact: true }))
    .toBeVisible();
  await expect
    .element(
      screen.getByText(formatInstant(locale, "2026-12-01T12:00:00.000Z")),
    )
    .toBeVisible();
  await expect
    .element(screen.getByText(t.profileHoldersTruncated))
    .toBeVisible();
  authorized = false;
  await client.invalidateQueries({ queryKey: companyKey(companyId) });
  await expect
    .element(screen.getByRole("alert"))
    .toMatchTextContent(t.errors.PERMISSION_DENIED);
  await expect
    .element(screen.getByRole("heading", { name: "Auditor", exact: true }))
    .not.toBeInTheDocument();
});

test("filters invitations on the current page and preserves context after detail navigation", async () => {
  const accepted = {
    ...invitationItem,
    id: "00000000-0000-4000-8000-000000000072",
    recipientEmail: "ana@example.test",
    status: "ACCEPTED",
    delivery: null,
  };
  respond((url) =>
    url.pathname.endsWith("/invitations")
      ? {
          body: {
            items: [invitationItem, accepted],
            nextCursor: "next-invitations",
          },
        }
      : { body: { ...memberCompany, access: invitationAccess } },
  );
  const { screen, router } = await open(
    `${companyPath}?view=invitations&cursor=current-page`,
  );
  await expect
    .element(screen.getByRole("form", { name: t.inviteTitle }))
    .not.toBeInTheDocument();
  await screen
    .getByRole("searchbox", { name: t.invitationWorkspace.search })
    .fill("GUEST");
  await expect
    .element(
      screen.getByRole("link", { name: "ana@example.test", exact: true }),
    )
    .not.toBeInTheDocument();
  await screen
    .getByRole("link", { name: "guest@example.test", exact: true })
    .click();
  expect(router.state.location.search).toEqual({
    view: "invitations",
    cursor: "current-page",
    invitationQuery: "GUEST",
    invitation: invitationItem.id,
  });
  expect(router.state.location.href).not.toContain("guest@example.test");
  await expect
    .element(screen.getByRole("article", { name: "guest@example.test" }))
    .toBeVisible();
  await screen.getByRole("link", { name: t.invitationWorkspace.back }).click();
  await expect
    .element(
      screen.getByRole("searchbox", { name: t.invitationWorkspace.search }),
    )
    .toHaveValue("GUEST");
  await screen
    .getByRole("button", { name: t.invitationWorkspace.clear })
    .click();
  await screen
    .getByRole("combobox", { name: t.invitationWorkspace.status, exact: true })
    .selectOptions("ACCEPTED");
  await screen
    .getByRole("link", { name: "ana@example.test", exact: true })
    .click();
  await expect
    .element(screen.getByText(t.invitationWorkspace.finalHint))
    .toBeVisible();
  await expect
    .element(
      screen.getByRole("button", { name: t.invitationResend, exact: true }),
    )
    .not.toBeInTheDocument();
  await expect
    .element(
      screen.getByRole("button", { name: t.invitationRevoke, exact: true }),
    )
    .not.toBeInTheDocument();
});

test("separates invitation link expiry from scoped access expiry and reports delivery failure", async () => {
  const item = {
    ...invitationItem,
    scope: "BRANCHES",
    branches: [{ id: northId, name: "Norte" }],
    grantExpiresAt: "2026-12-01T12:00:00.000Z",
    delivery: "FAILED",
  };
  respond((url) =>
    url.pathname.endsWith("/invitations")
      ? { body: { items: [item], nextCursor: null } }
      : { body: { ...memberCompany, access: invitationAccess } },
  );
  const { screen } = await open(
    `${companyPath}?view=invitations&invitation=${invitationItem.id}`,
  );
  const article = screen.getByRole("article", { name: "guest@example.test" });
  await expect
    .element(article.getByText(`${t.grantBranches}: Norte`, { exact: true }))
    .toBeVisible();
  await expect
    .element(
      article.getByText(t.invitationWorkspace.accessExpiry, { exact: true }),
    )
    .toBeVisible();
  await expect
    .element(
      article.getByText(formatInstant(locale, item.grantExpiresAt), {
        exact: true,
      }),
    )
    .toBeVisible();
  await expect
    .element(
      article.getByText(t.invitationWorkspace.linkExpiry, { exact: true }),
    )
    .toBeVisible();
  await expect
    .element(
      article.getByText(formatInstant(locale, item.expiresAt), { exact: true }),
    )
    .toBeVisible();
  await expect
    .element(article.getByText(t.deliveryStates.FAILED))
    .toBeVisible();
  await expect
    .element(article.getByText("Owner Person", { exact: true }))
    .toBeVisible();
});

test("confirms resend and reconciles an unknown result before issuing another email", async () => {
  let writes = 0;
  let reads = 0;
  respond((url, request) => {
    if (
      url.pathname.endsWith("/resend") &&
      request instanceof Request &&
      request.method === "POST"
    ) {
      writes++;
      throw new TypeError("Synthetic lost resend response");
    }
    if (url.pathname.endsWith("/invitations")) {
      if (writes && ++reads === 1)
        return {
          status: 503,
          body: {
            error: { code: "SERVICE_UNAVAILABLE", message: "Unavailable" },
          },
        };
      return { body: { items: [invitationItem], nextCursor: null } };
    }
    return { body: { ...memberCompany, access: invitationAccess } };
  });
  const { screen } = await open(
    `${companyPath}?view=invitations&invitation=${invitationItem.id}`,
  );
  await screen
    .getByRole("button", { name: t.invitationResend, exact: true })
    .click();
  await expect
    .element(screen.getByText(t.invitationWorkspace.resendConfirmation))
    .toBeVisible();
  expect(writes).toBe(0);
  await screen.getByRole("button", { name: t.cancel, exact: true }).click();
  expect(writes).toBe(0);
  await screen
    .getByRole("button", { name: t.invitationResend, exact: true })
    .click();
  const confirm = screen.getByRole("button", {
    name: t.invitationWorkspace.confirmResend,
  });
  await confirm.click();
  await expect
    .element(screen.getByRole("alert"))
    .toMatchTextContent(t.unknownWrite);
  await expect.element(confirm).toBeDisabled();
  await screen.getByRole("button", { name: t.reload, exact: true }).click();
  await expect.element(confirm).toBeDisabled();
  expect(writes).toBe(1);
  await screen.getByRole("button", { name: t.reload, exact: true }).click();
  await expect
    .element(
      screen.getByRole("button", { name: t.invitationResend, exact: true }),
    )
    .toBeEnabled();
  expect(writes).toBe(1);
});

test("preserves an uncertain invitation draft until its list can be reconciled", async () => {
  let writes = 0;
  let reads = 0;
  respond((url, request) => {
    if (
      url.pathname.endsWith("/invitations") &&
      request instanceof Request &&
      request.method === "POST"
    ) {
      writes++;
      throw new TypeError("Synthetic lost invitation response");
    }
    if (url.pathname.endsWith("/invitations")) {
      if (writes && ++reads === 1)
        return {
          status: 503,
          body: {
            error: { code: "SERVICE_UNAVAILABLE", message: "Unavailable" },
          },
        };
      return {
        body: { items: writes ? [invitationItem] : [], nextCursor: null },
      };
    }
    return { body: { ...memberCompany, access: invitationAccess } };
  });
  const { screen } = await open(
    `${companyPath}?view=invitations&invitation=new`,
  );
  const email = screen.getByRole("textbox", {
    name: t.inviteEmail,
    exact: true,
  });
  await email.fill("guest@example.test");
  const send = screen.getByRole("button", {
    name: t.inviteSubmit,
    exact: true,
  });
  await send.click();
  await expect
    .element(screen.getByRole("alert"))
    .toMatchTextContent(t.unknownWrite);
  await expect.element(send).toBeDisabled();
  await screen.getByRole("button", { name: t.reload, exact: true }).click();
  await expect.element(email).toHaveValue("guest@example.test");
  await expect.element(send).toBeDisabled();
  expect(writes).toBe(1);
  await screen.getByRole("button", { name: t.reload, exact: true }).click();
  await expect
    .element(
      screen.getByRole("link", { name: "guest@example.test", exact: true }),
    )
    .toBeVisible();
  expect(writes).toBe(1);
});

test("keeps unavailable invitation details explicit and removes cached invitations after permission loss", async () => {
  let authorized = true;
  respond((url) =>
    url.pathname.endsWith("/invitations")
      ? { body: { items: [invitationItem], nextCursor: null } }
      : {
          body: {
            ...memberCompany,
            access: authorized
              ? invitationAccess
              : { ...memberAccess, capabilities: ["company.view"] },
          },
        },
  );
  const { screen, client } = await open(
    `${companyPath}?view=invitations&invitation=00000000-0000-4000-8000-000000000072`,
  );
  await expect
    .element(screen.getByText(t.invitationWorkspace.noDetail))
    .toBeVisible();
  authorized = false;
  await client.invalidateQueries({ queryKey: companyKey(companyId) });
  await expect
    .element(screen.getByRole("alert"))
    .toMatchTextContent(t.errors.PERMISSION_DENIED);
  await expect
    .element(screen.getByText(t.invitationWorkspace.noDetail))
    .not.toBeInTheDocument();
});

test("opens the replacement invitation after a successful resend from a later page", async () => {
  const replacement = {
    ...invitationItem,
    id: "00000000-0000-4000-8000-000000000072",
    expiresAt: "2026-11-01T12:00:00.000Z",
  };
  let resent = false;
  respond((url, request) => {
    if (
      url.pathname.endsWith("/resend") &&
      request instanceof Request &&
      request.method === "POST"
    ) {
      resent = true;
      return { status: 201, body: replacement };
    }
    if (url.pathname.endsWith("/invitations"))
      return {
        body: {
          items: resent
            ? [replacement, { ...invitationItem, status: "REPLACED" }]
            : [invitationItem],
          nextCursor: null,
        },
      };
    return { body: { ...memberCompany, access: invitationAccess } };
  });
  const { screen, router } = await open(
    `${companyPath}?view=invitations&cursor=later-page&invitation=${invitationItem.id}`,
  );
  await screen
    .getByRole("button", { name: t.invitationResend, exact: true })
    .click();
  await screen
    .getByRole("button", { name: t.invitationWorkspace.confirmResend })
    .click();
  await expect
    .element(screen.getByText(t.invitationWorkspace.resent))
    .toBeVisible();
  expect(router.state.location.search).toEqual({
    view: "invitations",
    invitation: replacement.id,
  });
  await expect
    .element(
      screen.getByText(formatInstant(locale, replacement.expiresAt), {
        exact: true,
      }),
    )
    .toBeVisible();
  await expect
    .element(
      screen.getByRole("button", { name: t.invitationResend, exact: true }),
    )
    .toBeEnabled();
});

test("restores invitation filters from a direct URL and retains them on detail return", async () => {
  const accepted = { ...invitationItem, status: "ACCEPTED" };
  respond((url) =>
    url.pathname.endsWith("/invitations")
      ? {
          body: {
            items: [
              accepted,
              {
                ...invitationItem,
                id: "00000000-0000-4000-8000-000000000072",
                recipientEmail: "other@example.test",
              },
            ],
            nextCursor: "next-page",
          },
        }
      : { body: { ...memberCompany, access: invitationAccess } },
  );
  const { screen, router } = await open(
    `${companyPath}?view=invitations&invitationQuery=guest&invitationStatus=ACCEPTED`,
  );
  await expect
    .element(
      screen.getByRole("searchbox", { name: t.invitationWorkspace.search }),
    )
    .toHaveValue("guest");
  await expect
    .element(
      screen.getByRole("combobox", {
        name: t.invitationWorkspace.status,
        exact: true,
      }),
    )
    .toHaveValue("ACCEPTED");
  await expect
    .element(
      screen.getByRole("link", { name: "other@example.test", exact: true }),
    )
    .not.toBeInTheDocument();
  await screen
    .getByRole("link", { name: "guest@example.test", exact: true })
    .click();
  expect(router.state.location.search).toEqual({
    view: "invitations",
    invitationQuery: "guest",
    invitationStatus: "ACCEPTED",
    invitation: invitationItem.id,
  });
  await screen.getByRole("link", { name: t.invitationWorkspace.back }).click();
  expect(router.state.location.search).toEqual({
    view: "invitations",
    invitationQuery: "guest",
    invitationStatus: "ACCEPTED",
  });
  await screen
    .getByRole("button", { name: t.invitationWorkspace.clear })
    .click();
  expect(router.state.location.search).toEqual({ view: "invitations" });
});

test("restores profile filters from a shared link and keeps them through detail navigation", async () => {
  const archived = accessProfile({ status: "ARCHIVED", name: "Recepção" });
  respond((url) => {
    if (url.pathname.endsWith(`/access-profiles/${profileId}`))
      return {
        body: { profile: archived, holders: [], holdersTruncated: false },
      };
    if (url.pathname.endsWith("/access-profiles"))
      return {
        body: {
          items: [
            archived,
            accessProfile({
              id: "00000000-0000-4000-8000-000000000042",
              name: "Outro perfil",
            }),
          ],
        },
      };
    return { body: memberCompany };
  });
  const { screen, router } = await open(
    `${companyPath}?view=profiles&profileQuery=recepcao&profileStatus=ARCHIVED`,
  );
  await expect
    .element(screen.getByRole("searchbox", { name: t.profileWorkspace.search }))
    .toHaveValue("recepcao");
  await expect
    .element(
      screen.getByRole("combobox", {
        name: t.profileWorkspace.status,
        exact: true,
      }),
    )
    .toHaveValue("ARCHIVED");
  await expect
    .element(screen.getByRole("link", { name: "Outro perfil", exact: true }))
    .not.toBeInTheDocument();
  await screen.getByRole("link", { name: "Recepção", exact: true }).click();
  expect(router.state.location.search).toEqual({
    view: "profiles",
    profileQuery: "recepcao",
    profileStatus: "ARCHIVED",
    profile: profileId,
  });
  await screen.getByRole("link", { name: t.profileWorkspace.back }).click();
  expect(router.state.location.search).toEqual({
    view: "profiles",
    profileQuery: "recepcao",
    profileStatus: "ARCHIVED",
  });
  await screen.getByRole("button", { name: t.profileWorkspace.clear }).click();
  expect(router.state.location.search).toEqual({ view: "profiles" });
});
