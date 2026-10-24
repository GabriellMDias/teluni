import { afterEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { Device } from "../src/devices/api.js";
import { deviceMessages } from "../src/devices/messages.js";
import { sessionKey } from "../src/identity/api.js";
import { browserLocale } from "../src/locale.js";
import { ModuleNavigation } from "../src/module-navigation.js";
import { moduleNavigation, routeTree } from "../src/modules.js";
import { shellMessages } from "../src/shell-messages.js";
import { organizationMessages } from "../src/organizations/messages.js";

const companyId = "00000000-0000-4000-8000-000000000001";
const branchA = "00000000-0000-4000-8000-0000000000a1";
const branchB = "00000000-0000-4000-8000-0000000000b2";
const deviceId = "00000000-0000-4000-8000-0000000000d1";
const screensPath = `/companies/${companyId}/screens`;
const locale = browserLocale();
const t = deviceMessages[locale];
const organizations = organizationMessages[locale];

afterEach(() => vi.unstubAllGlobals());

function device(overrides: Partial<Device> = {}): Device {
  return {
    id: deviceId,
    name: "Caixa 1",
    branch: { id: branchA, name: "Centro", timeZone: "America/Sao_Paulo" },
    timeZone: null,
    rotation: 0,
    status: "ACTIVE",
    erasure: "NONE",
    report: {
      appVersion: "1.0.0",
      protocolVersion: 1,
      manufacturer: "Synthetic",
      model: "Player",
      osVersion: "14",
      display: { width: 1920, height: 1080 },
      rotations: [0, 90],
    },
    lastSeenAt: null,
    pairedAt: "2026-10-19T12:00:00.000Z",
    revokedAt: null,
    erasureRecordedAt: null,
    version: 1,
    ...overrides,
  };
}

function company(capabilities: string[], afterStrong: string[] = []) {
  return {
    company: { id: companyId, displayName: "Synthetic company" },
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
      timeZone: "UTC",
      status: "ACTIVE",
      version: 1,
    },
    {
      id: branchB,
      name: "Bairro",
      timeZone: "UTC",
      status: "ACTIVE",
      version: 1,
    },
  ],
  nextCursor: null,
};

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
  return { screen, router, client };
}

type Handler = (
  url: URL,
  request: Request,
) =>
  | { status?: number; body?: unknown }
  | Promise<{ status?: number; body?: unknown }>;

function respond(handler: Handler) {
  const fetchOriginal = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request =
        input instanceof Request ? input : new Request(String(input), init);
      const url = new URL(request.url, location.href);
      if (!url.pathname.startsWith("/api/")) return fetchOriginal(input, init);
      const { status = 200, body } = await handler(url, request);
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

test("links to screens from the company page only with devices.view", async () => {
  respond((url) =>
    url.pathname.endsWith("/branches")
      ? { body: branches }
      : { body: company(["devices.view"]) },
  );
  const { screen } = await open(`/companies/${companyId}`);
  await expect
    .element(screen.getByRole("link", { name: organizations.screensTitle }))
    .toHaveAttribute("href", screensPath);
});

test("lists screens with filters kept in the URL and no pairing for viewers", async () => {
  respond((url) => {
    if (url.pathname.endsWith("/devices"))
      return {
        body: {
          items: [
            url.searchParams.get("status") === "REVOKED"
              ? device({
                  name: "Antiga",
                  status: "REVOKED",
                  erasure: "PENDING",
                  revokedAt: "2026-10-19T13:00:00.000Z",
                })
              : device(),
          ],
          nextCursor: null,
        },
      };
    if (url.pathname.endsWith("/branches")) return { body: branches };
    return { body: company(["devices.view"]) };
  });
  const { screen, router } = await open(screensPath);
  await expect
    .element(screen.getByRole("link", { name: "Caixa 1" }))
    .toHaveAttribute("href", `${screensPath}/${deviceId}`);
  await expect
    .element(screen.getByText(t.neverSeen, { exact: false }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: t.pair }))
    .not.toBeInTheDocument();
  await screen.getByLabelText(t.filterStatus).selectOptions(t.statusRevoked);
  await expect
    .element(screen.getByRole("link", { name: "Antiga" }))
    .toBeVisible();
  expect(router.state.location.search).toEqual({ status: "REVOKED" });
  await expect
    .element(screen.getByText(t.erasure.PENDING, { exact: false }))
    .toBeVisible();
});

test("pairs a screen with the code only in the request body", async () => {
  let paired = false;
  respond((url, request) => {
    if (url.pathname.endsWith("/devices") && request.method === "POST") {
      paired = true;
      return { status: 201, body: device({ name: "Vitrine", rotation: 90 }) };
    }
    if (url.pathname.endsWith("/devices"))
      return {
        body: {
          items: paired ? [device({ name: "Vitrine" })] : [],
          nextCursor: null,
        },
      };
    if (url.pathname.endsWith("/branches")) return { body: branches };
    return { body: company(["devices.view", "devices.manage"]) };
  });
  const { screen } = await open(screensPath);
  await expect.element(screen.getByText(t.empty)).toBeVisible();
  await screen.getByLabelText(t.fieldCode).fill("bcdf-ghjk");
  await screen.getByLabelText(t.fieldName).fill("Vitrine");
  await screen.getByLabelText(t.fieldBranch).selectOptions("Bairro");
  await screen.getByLabelText(t.rotationLabel).selectOptions(t.rotations[90]);
  await screen.getByRole("button", { name: t.pair }).click();
  await expect.element(screen.getByRole("status")).toMatchTextContent(t.paired);
  await expect
    .element(screen.getByText("Synthetic Player · 1920×1080", { exact: false }))
    .toBeVisible();
  expect(await sent("POST", "/devices")).toEqual({
    userCode: "BCDF-GHJK",
    name: "Vitrine",
    branchId: branchB,
    rotation: 90,
  });
  const urls = vi
    .mocked(fetch)
    .mock.calls.map(([input]) =>
      input instanceof Request ? input.url : String(input),
    );
  expect(urls.some((value) => value.includes("BCDF"))).toBe(false);
});

test("explains an invalid code without saying why it failed", async () => {
  respond((url, request) => {
    if (url.pathname.endsWith("/devices") && request.method === "POST")
      return {
        status: 409,
        body: { error: { code: "PAIRING_CODE_INVALID", message: "Invalid" } },
      };
    if (url.pathname.endsWith("/devices"))
      return { body: { items: [], nextCursor: null } };
    if (url.pathname.endsWith("/branches")) return { body: branches };
    return { body: company(["devices.view", "devices.manage"]) };
  });
  const { screen } = await open(screensPath);
  await screen.getByLabelText(t.fieldCode).fill("BCDF-GHJK");
  await screen.getByLabelText(t.fieldName).fill("Vitrine");
  await screen.getByRole("button", { name: t.pair }).click();
  await expect
    .element(screen.getByRole("alert"))
    .toMatchTextContent(t.errors.PAIRING_CODE_INVALID);
});

test("blocks repeated pairing while pending and reconciles a lost response before another attempt", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let writes = 0;
  let paired = false;
  respond(async (url, request) => {
    if (url.pathname.endsWith("/devices") && request.method === "POST") {
      writes += 1;
      await pending;
      paired = true;
      throw new TypeError("Synthetic lost response");
    }
    if (url.pathname.endsWith("/devices"))
      return {
        body: {
          items: paired ? [device({ name: "Vitrine" })] : [],
          nextCursor: null,
        },
      };
    if (url.pathname.endsWith("/branches")) return { body: branches };
    return { body: company(["devices.view", "devices.manage"]) };
  });
  const { screen } = await open(screensPath);
  try {
    await screen.getByLabelText(t.fieldCode).fill("BCDF-GHJK");
    await screen.getByLabelText(t.fieldName).fill("Vitrine");
    await screen.getByRole("button", { name: t.pair, exact: true }).click();
    await expect
      .element(screen.getByRole("button", { name: t.pairing }))
      .toHaveAttribute("aria-busy", "true");
    await expect
      .element(screen.getByRole("button", { name: t.pairing }))
      .toBeDisabled();
    release();
    await expect
      .element(screen.getByRole("alert"))
      .toMatchTextContent(t.unknownWrite);
    await expect
      .element(screen.getByRole("button", { name: t.pair, exact: true }))
      .toBeDisabled();
    document.querySelector<HTMLFormElement>(".devices-pair")!.requestSubmit();
    expect(writes).toBe(1);
    await screen.getByRole("button", { name: t.reload, exact: true }).click();
    await expect
      .element(screen.getByRole("link", { name: "Vitrine", exact: true }))
      .toBeVisible();
    expect(writes).toBe(1);
    await expect
      .element(screen.getByLabelText(t.fieldCode))
      .toHaveValue("BCDF-GHJK");
  } finally {
    release();
  }
});

test("asks for step-up when managing screens needs strong authentication", async () => {
  respond((url) => {
    if (url.pathname.endsWith("/devices"))
      return { body: { items: [], nextCursor: null } };
    if (url.pathname.endsWith("/branches")) return { body: branches };
    return { body: company(["devices.view"], ["devices.manage"]) };
  });
  const { screen } = await open(screensPath);
  await expect
    .element(screen.getByRole("link", { name: t.stepUpButton }))
    .toHaveAttribute(
      "href",
      `/api/auth/login?returnTo=${encodeURIComponent(screensPath)}&assurance=strong`,
    );
});

test("limits rotation to reported values and sends the edited version", async () => {
  let current = device();
  respond((url, request) => {
    if (
      url.pathname.endsWith(`/devices/${deviceId}`) &&
      request.method === "PATCH"
    ) {
      current = device({ rotation: 90, version: 2 });
      return { body: current };
    }
    if (url.pathname.endsWith(`/devices/${deviceId}`)) return { body: current };
    if (url.pathname.endsWith("/branches")) return { body: branches };
    return { body: company(["devices.view", "devices.manage"]) };
  });
  const { screen } = await open(`${screensPath}/${deviceId}`);
  const rotation = screen.getByLabelText(t.rotationLabel);
  await expect.element(rotation).toBeVisible();
  expect(
    [...(rotation.element() as HTMLSelectElement).options].map(
      (option) => option.value,
    ),
  ).toEqual(["0", "90"]);
  await rotation.selectOptions(t.rotations[90]);
  await screen.getByRole("button", { name: t.save }).click();
  await expect.element(screen.getByText(t.saved)).toBeVisible();
  expect(await sent("PATCH", `/devices/${deviceId}`)).toEqual({
    expectedVersion: 1,
    rotation: 90,
  });
});

test("unlinks only after confirmation and then offers a reset record", async () => {
  let current = device({ lastSeenAt: "2026-10-19T12:30:00.000Z" });
  respond((url, request) => {
    if (url.pathname.endsWith("/unlink")) {
      current = device({
        status: "REVOKED",
        erasure: "PENDING",
        revokedAt: "2026-10-19T13:00:00.000Z",
        version: 2,
      });
      return { body: current };
    }
    if (url.pathname.endsWith("/reset-record")) {
      current = { ...current, erasure: "RESET_RECORDED", version: 3 };
      return { body: current };
    }
    if (
      url.pathname.endsWith(`/devices/${deviceId}`) &&
      request.method === "GET"
    )
      return { body: current };
    if (url.pathname.endsWith("/branches")) return { body: branches };
    return { body: company(["devices.view", "devices.manage"]) };
  });
  const { screen } = await open(`${screensPath}/${deviceId}`);
  await expect.element(screen.getByText(t.authorizedUntil)).toBeVisible();
  const unlink = screen.getByRole("button", { name: t.unlink });
  await expect.element(unlink).toBeDisabled();
  await screen.getByLabelText(t.unlinkConfirm("Caixa 1")).click();
  await unlink.click();
  await expect.element(screen.getByText(t.unlinked)).toBeVisible();
  expect(await sent("POST", "/unlink")).toEqual({ expectedVersion: 1 });
  await expect
    .element(screen.getByRole("button", { name: t.save }))
    .not.toBeInTheDocument();
  await screen.getByRole("button", { name: t.reset }).click();
  await expect
    .element(
      screen.getByText(t.erasure.RESET_RECORDED, { exact: false }).first(),
    )
    .toBeVisible();
  expect(await sent("POST", "/reset-record")).toEqual({ expectedVersion: 2 });
});

test("asks to reload after a version conflict", async () => {
  respond((url, request) => {
    if (url.pathname.endsWith("/move"))
      return {
        status: 409,
        body: {
          error: { code: "RESOURCE_VERSION_CONFLICT", message: "Changed" },
        },
      };
    if (
      url.pathname.endsWith(`/devices/${deviceId}`) &&
      request.method === "GET"
    )
      return { body: device() };
    if (url.pathname.endsWith("/branches")) return { body: branches };
    return { body: company(["devices.view", "devices.manage"]) };
  });
  const { screen } = await open(`${screensPath}/${deviceId}`);
  await screen.getByRole("button", { name: t.move }).click();
  await expect
    .element(screen.getByRole("alert"))
    .toMatchTextContent(t.errors.RESOURCE_VERSION_CONFLICT);
  await expect
    .element(screen.getByRole("button", { name: t.move }))
    .toBeDisabled();
  expect(await sent("POST", "/move")).toEqual({
    expectedVersion: 1,
    branchId: branchB,
  });
});

test("shows and recovers a failed destination lookup before offering a move", async () => {
  let unavailable = true;
  respond((url) => {
    if (url.pathname.endsWith("/branches"))
      return unavailable
        ? {
            status: 503,
            body: {
              error: { code: "SERVICE_UNAVAILABLE", message: "Unavailable" },
            },
          }
        : { body: branches };
    if (url.pathname.endsWith(`/devices/${deviceId}`))
      return { body: device() };
    if (url.pathname.endsWith("/sync-state"))
      return {
        body: {
          deviceId,
          connection: "never",
          lastContactAt: null,
          source: "individual",
          desired: null,
          publication: "unknown",
          reported: null,
        },
      };
    return { body: company(["devices.view", "devices.manage"]) };
  });
  const { screen, client } = await open(`${screensPath}/${deviceId}`);
  await expect
    .element(
      screen.getByRole("region", { name: t.moveTitle }).getByRole("alert"),
    )
    .toMatchTextContent(t.errors.SERVICE_UNAVAILABLE);
  await expect
    .element(screen.getByRole("button", { name: t.move, exact: true }))
    .not.toBeInTheDocument();
  unavailable = false;
  await screen
    .getByRole("region", { name: t.moveTitle })
    .getByRole("button", { name: t.reload })
    .click();
  await expect
    .element(
      screen
        .getByRole("form", { name: t.moveTitle })
        .getByRole("button", { name: t.move, exact: true }),
    )
    .toBeEnabled();
  await expect.element(screen.getByLabelText(t.moveTo)).toHaveValue(branchB);
  unavailable = true;
  await client.invalidateQueries({
    queryKey: ["devices", "branches", companyId],
  });
  await expect
    .element(
      screen.getByRole("region", { name: t.moveTitle }).getByRole("alert"),
    )
    .toMatchTextContent(t.errors.SERVICE_UNAVAILABLE);
  await expect.element(screen.getByLabelText(t.moveTo)).not.toBeInTheDocument();
  expect(
    vi
      .mocked(fetch)
      .mock.calls.some(
        ([input]) => input instanceof Request && input.method === "POST",
      ),
  ).toBe(false);
});

const publicationId = "00000000-0000-4000-8000-0000000000b1";

test("shows a screen's synchronization as the screen reported it", async () => {
  const state = {
    deviceId,
    connection: "online",
    lastContactAt: "2026-10-19T12:00:00.000Z",
    source: "group",
    desired: { publicationId, generation: 2 },
    publication: "failed",
    reported: {
      receivedAt: "2026-10-19T12:00:00.000Z",
      appVersion: "1.2.0",
      protocol: 1,
      active: { publicationId, generation: 1, since: null },
      staging: {
        publicationId,
        generation: 2,
        state: "FAILED",
        failure: "STORAGE_FULL",
        bytesDone: 10,
        bytesTotal: 100,
      },
      playback: "PLAYING",
      storage: { freeBytes: 1.5e9, totalBytes: 8e9 },
    },
  };
  respond((url) => {
    if (url.pathname.endsWith(`/devices/${deviceId}/sync-state`))
      return { body: state };
    if (url.pathname.endsWith(`/devices/${deviceId}`))
      return { body: device() };
    if (url.pathname.endsWith("/publications/screen-states"))
      return { body: { items: [state] } };
    if (url.pathname.endsWith("/devices"))
      return { body: { items: [device()], nextCursor: null } };
    if (url.pathname.endsWith("/branches")) return { body: branches };
    return { body: company(["devices.view"]) };
  });
  const { screen } = await open(`${screensPath}/${deviceId}`);
  const sync = screen.getByTestId("screen-sync");
  await expect.element(sync).toBeVisible();
  await expect
    .element(sync.getByText(t.sync.connection.online, { exact: false }))
    .toBeVisible();
  await expect.element(sync.getByText(t.sync.publication.failed)).toBeVisible();
  await expect.element(sync.getByText(t.sync.desired(2, true))).toBeVisible();
  await expect.element(sync.getByText(t.sync.active(1))).toBeVisible();
  await expect
    .element(sync.getByText(t.sync.failure.STORAGE_FULL))
    .toBeVisible();
  await expect.element(sync.getByText(t.sync.playback.PLAYING)).toBeVisible();
  await expect.element(screen.getByText(t.sync.note)).toBeVisible();
  // The list shows each screen's connection and publication.
  const { screen: list } = await open(screensPath);
  await expect
    .element(
      list.getByText(
        `${t.sync.connection.online} · ${t.sync.publication.failed}`,
      ),
    )
    .toBeVisible();
});
