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
import type {
  DeviceProgramming,
  Group,
  Playlist,
  Program,
} from "../src/programming/api.js";
import { programmingMessages } from "../src/programming/messages.js";

const companyId = "00000000-0000-4000-8000-000000000001";
const branchA = "00000000-0000-4000-8000-0000000000a1";
const playlistId = "00000000-0000-4000-8000-0000000000c1";
const otherPlaylistId = "00000000-0000-4000-8000-0000000000c2";
const assetId = "00000000-0000-4000-8000-0000000000e1";
const videoId = "00000000-0000-4000-8000-0000000000e2";
const groupId = "00000000-0000-4000-8000-0000000000f1";
const deviceId = "00000000-0000-4000-8000-0000000000d1";
const base = `/companies/${companyId}/programming`;
const locale = browserLocale();
const t = programmingMessages[locale];
const organizations = organizationMessages[locale];

afterEach(() => vi.unstubAllGlobals());

function playlist(overrides: Partial<Playlist> = {}): Playlist {
  return {
    id: playlistId,
    name: "Manhã",
    branch: null,
    transition: "CUT",
    fadeMs: null,
    items: [
      {
        mediaAssetId: assetId,
        name: "Promoção",
        kind: "IMAGE",
        mediaStatus: "READY",
        durationMs: 10_000,
      },
    ],
    durationMs: 10_000,
    videoCount: 0,
    createdAt: "2026-10-19T12:00:00.000Z",
    updatedAt: "2026-10-19T12:00:00.000Z",
    version: 2,
    ...overrides,
  };
}

function group(overrides: Partial<Group> = {}): Group {
  return {
    id: groupId,
    name: "Vitrines",
    allBranches: false,
    branches: [{ id: branchA, name: "Centro", timeZone: "America/Sao_Paulo" }],
    members: [],
    createdAt: "2026-10-19T12:00:00.000Z",
    updatedAt: "2026-10-19T12:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

const emptyProgram: Program = {
  version: 0,
  outputs: [{ key: "screen", defaultPlaylist: null, rules: [] }],
};

const timeline = {
  source: { kind: "individual" },
  timeZone: "America/Sao_Paulo",
  segments: [
    {
      start: "2026-10-19T11:00:00.000Z",
      end: "2026-10-26T11:00:00.000Z",
      localStart: "2026-10-19T08:00",
      localEnd: "2026-10-26T08:00",
      source: "none",
      ruleId: null,
      playlist: null,
    },
  ],
  notes: [],
};

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

const editor = ["programming.view", "programming.edit"];

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
          : url.pathname.endsWith("/timeline")
            ? { body: timeline }
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
    .find(
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

test("links to programming from the company page only with programming.view", async () => {
  respond(["programming.view"]);
  const { screen } = await open(`/companies/${companyId}`);
  await expect
    .element(screen.getByRole("link", { name: organizations.programmingTitle }))
    .toHaveAttribute("href", base);
});

test("denies the page without programming.view", async () => {
  respond(["media.view"]);
  const { screen } = await open(base);
  await expect
    .element(screen.getByRole("alert"))
    .toMatchTextContent(t.errors.PERMISSION_DENIED);
});

test("lists playlists for viewers without the create form", async () => {
  respond(["programming.view"], (url) =>
    url.pathname.endsWith("/programming/playlists")
      ? { body: { items: [playlist()], nextCursor: null } }
      : undefined,
  );
  const { screen } = await open(base);
  await expect
    .element(screen.getByRole("link", { name: "Manhã" }))
    .toHaveAttribute("href", `${base}/playlists/${playlistId}`);
  await expect
    .element(
      screen.getByText(t.playlistSummary(1, "0:10", 0), { exact: false }),
    )
    .toBeVisible();
  await expect
    .element(screen.getByRole("heading", { name: t.createPlaylistTitle }))
    .not.toBeInTheDocument();
});

test("creates a playlist and opens it", async () => {
  respond(editor, (url, request) => {
    if (url.pathname.endsWith("/programming/playlists"))
      return request.method === "POST"
        ? { status: 201, body: playlist({ items: [], durationMs: 0 }) }
        : { body: { items: [], nextCursor: null } };
    if (url.pathname.endsWith(`/playlists/${playlistId}`))
      return { body: playlist({ items: [], durationMs: 0 }) };
    if (url.pathname.endsWith("/media"))
      return { body: { items: [], nextCursor: null } };
    return undefined;
  });
  const { screen, router } = await open(base);
  await screen.getByLabelText(t.fieldName).fill("Manhã");
  await screen.getByLabelText(t.fieldScope).selectOptions("Centro");
  await screen.getByRole("button", { name: t.create }).click();
  await expect
    .element(screen.getByRole("heading", { level: 1, name: "Manhã" }))
    .toBeVisible();
  expect(router.state.location.pathname).toBe(
    `${base}/playlists/${playlistId}`,
  );
  expect(await sent("POST", "/programming/playlists")).toEqual({
    name: "Manhã",
    branchId: branchA,
  });
});

test("edits items in order with image seconds and saves the version", async () => {
  let current = playlist();
  respond(editor, (url, request) => {
    if (url.pathname.endsWith(`/playlists/${playlistId}/items`)) {
      current = playlist({ version: 3, items: [], durationMs: 0 });
      return { body: current };
    }
    if (url.pathname.endsWith(`/playlists/${playlistId}`))
      return { body: current };
    if (url.pathname.endsWith("/programming/playlists"))
      return { body: { items: [current], nextCursor: null } };
    if (url.pathname.endsWith("/media") && request.method === "GET")
      return {
        body: {
          items: [
            {
              id: videoId,
              name: "Vitrine",
              kind: "VIDEO",
              status: "READY",
              branch: null,
              version: 1,
            },
          ],
          nextCursor: null,
        },
      };
    return undefined;
  });
  const { screen } = await open(`${base}/playlists/${playlistId}`);
  await screen.getByRole("button", { name: t.add("Vitrine") }).click();
  await expect
    .element(screen.getByText(t.itemPosition(2, "Vitrine")))
    .toBeVisible();
  await screen
    .getByRole("button", {
      name: `${t.moveUp}: ${t.itemPosition(2, "Vitrine")}`,
    })
    .click();
  await screen.getByLabelText(t.itemSeconds("Promoção")).fill("25");
  await screen.getByRole("button", { name: t.saveItems }).click();
  await expect
    .element(screen.getByRole("status"))
    .toMatchTextContent(t.itemsSaved);
  expect(await sent("PUT", "/items")).toEqual({
    expectedVersion: 2,
    items: [
      { mediaAssetId: videoId, durationSeconds: null },
      { mediaAssetId: assetId, durationSeconds: 25 },
    ],
  });
});

test("deletes a playlist only after confirmation and explains use", async () => {
  respond(editor, (url, request) => {
    if (url.pathname.endsWith(`/playlists/${playlistId}`))
      return request.method === "DELETE"
        ? {
            status: 409,
            body: { error: { code: "PLAYLIST_IN_USE", message: "In use" } },
          }
        : { body: playlist() };
    if (url.pathname.endsWith("/media"))
      return { body: { items: [], nextCursor: null } };
    return undefined;
  });
  const { screen } = await open(`${base}/playlists/${playlistId}`);
  const remove = screen.getByRole("button", { name: t.deletePlaylist });
  await expect.element(remove).toBeDisabled();
  await screen
    .getByRole("checkbox", { name: t.deletePlaylistConfirm("Manhã") })
    .click();
  await remove.click();
  await expect
    .element(screen.getByText(t.errors.PLAYLIST_IN_USE))
    .toBeVisible();
  expect(await sent("DELETE", `/playlists/${playlistId}`)).toEqual({
    expectedVersion: 2,
  });
});

test("shows conflicts per schedule and saves only a clean set", async () => {
  let conflicting = true;
  respond(editor, (url) => {
    if (url.pathname.endsWith(`/groups/${groupId}/program/outputs/screen`))
      return {
        body: {
          version: 1,
          outputs: [{ key: "screen", defaultPlaylist: null, rules: [] }],
        },
      };
    if (url.pathname.endsWith(`/groups/${groupId}/program`))
      return { body: emptyProgram };
    if (url.pathname.endsWith(`/groups/${groupId}`)) return { body: group() };
    if (url.pathname.endsWith("/programming/playlists"))
      return {
        body: {
          items: [playlist(), playlist({ id: otherPlaylistId, name: "Tarde" })],
          nextCursor: null,
        },
      };
    if (url.pathname.endsWith("/rule-checks"))
      return {
        body: {
          issues: [],
          conflicts: conflicting
            ? [{ first: 0, second: 1, date: "2026-10-19" }]
            : [],
        },
      };
    return undefined;
  });
  const { screen } = await open(`${base}/groups/${groupId}`);
  await screen.getByRole("button", { name: t.addRule }).click();
  await screen.getByRole("button", { name: t.addRule }).click();
  const selects = screen.getByLabelText(t.rulePlaylist);
  await selects.first().selectOptions("Manhã");
  await selects.last().selectOptions("Tarde");
  await screen.getByRole("button", { name: t.saveSchedules }).click();
  const date = new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeZone: "UTC",
  }).format(new Date("2026-10-19T00:00:00Z"));
  await expect.element(screen.getByText(t.ruleConflict(2, date))).toBeVisible();
  await expect.element(screen.getByText(t.ruleConflict(1, date))).toBeVisible();
  expect(sentCount("PUT", "/outputs/screen")).toBe(0);
  conflicting = false;
  await screen.getByRole("button", { name: t.removeRule(2) }).click();
  await screen.getByRole("button", { name: t.saveSchedules }).click();
  await expect
    .element(screen.getByRole("status"))
    .toMatchTextContent(t.schedulesSaved);
  const body = (await sent("PUT", "/outputs/screen")) as {
    expectedVersion: number;
    rules: unknown[];
  };
  expect(body.expectedVersion).toBe(0);
  expect(body.rules).toEqual([
    expect.objectContaining({
      playlistId,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      allDay: false,
      startTime: "08:00",
      endTime: "18:00",
      endsOn: null,
    }),
  ]);
});

test("assigns a screen to a group only after confirming the neutral screen", async () => {
  const current: DeviceProgramming = {
    device: {
      id: deviceId,
      name: "Entrada",
      branch: { id: branchA, name: "Centro", timeZone: "America/Sao_Paulo" },
      timeZone: null,
    },
    group: null,
    individual: false,
    source: "individual",
    version: 0,
  };
  respond([...editor, "programming.assign"], (url) => {
    if (url.pathname.endsWith(`/devices/${deviceId}/assignment`))
      return {
        body: {
          ...current,
          group: { id: groupId, name: "Vitrines" },
          source: "group",
          version: 1,
        },
      };
    if (url.pathname.endsWith(`/devices/${deviceId}/program`))
      return { body: emptyProgram };
    if (url.pathname.endsWith(`/devices/${deviceId}`)) return { body: current };
    if (url.pathname.endsWith("/programming/groups"))
      return { body: { items: [group()] } };
    if (url.pathname.endsWith("/programming/playlists"))
      return { body: { items: [], nextCursor: null } };
    return undefined;
  });
  const { screen } = await open(`${base}/screens/${deviceId}`);
  await expect
    .element(screen.getByText(t.branchZone("America/Sao_Paulo")))
    .toBeVisible();
  await screen.getByLabelText(t.groupLabel).selectOptions("Vitrines");
  const save = screen.getByRole("button", { name: t.assign });
  await expect.element(save).toBeDisabled();
  await screen.getByRole("checkbox", { name: t.confirmUnpublished }).click();
  await save.click();
  await expect.element(screen.getByText(t.assigned)).toBeVisible();
  expect(await sent("PUT", "/assignment")).toEqual({
    expectedVersion: 0,
    groupId,
    individual: false,
    confirmUnpublished: true,
  });
});

test("asks for step-up before assigning screens", async () => {
  respond([], (url) => {
    if (url.pathname.endsWith(`/companies/${companyId}`))
      return { body: company(["programming.view"], ["programming.assign"]) };
    if (url.pathname.endsWith(`/devices/${deviceId}/program`))
      return { body: emptyProgram };
    if (url.pathname.endsWith(`/devices/${deviceId}`))
      return {
        body: {
          device: {
            id: deviceId,
            name: "Entrada",
            branch: { id: branchA, name: "Centro", timeZone: "UTC" },
            timeZone: "UTC",
          },
          group: null,
          individual: false,
          source: "individual",
          version: 0,
        },
      };
    if (url.pathname.endsWith("/programming/playlists"))
      return { body: { items: [], nextCursor: null } };
    return undefined;
  });
  const { screen } = await open(`${base}/screens/${deviceId}`);
  await expect
    .element(screen.getByRole("link", { name: t.stepUpButton }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("heading", { name: t.assignmentTitle }))
    .not.toBeInTheDocument();
});
