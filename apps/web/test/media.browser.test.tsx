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
import type { Media } from "../src/media/api.js";
import { mediaMessages } from "../src/media/messages.js";
import { ModuleNavigation } from "../src/module-navigation.js";
import { moduleNavigation, routeTree } from "../src/modules.js";
import { shellMessages } from "../src/shell-messages.js";
import { organizationMessages } from "../src/organizations/messages.js";

const companyId = "00000000-0000-4000-8000-000000000001";
const branchA = "00000000-0000-4000-8000-0000000000a1";
const assetId = "00000000-0000-4000-8000-0000000000e1";
const mediaPath = `/companies/${companyId}/media`;
const locale = browserLocale();
const t = mediaMessages[locale];
const organizations = organizationMessages[locale];

afterEach(() => vi.unstubAllGlobals());

function media(overrides: Partial<Media> = {}): Media {
  return {
    id: assetId,
    name: "Promoção de verão",
    tags: ["promo"],
    kind: "IMAGE",
    status: "READY",
    rejectionReason: null,
    branch: null,
    declaredContentType: "image/jpeg",
    declaredSize: 2_000_000,
    width: 1920,
    height: 1080,
    durationMs: null,
    hasAudio: null,
    processing: null,
    createdAt: "2026-10-19T12:00:00.000Z",
    readyAt: "2026-10-19T12:00:05.000Z",
    archivedAt: null,
    deletedAt: null,
    purgeAfter: null,
    version: 3,
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

/** Records uploads and answers them after reporting progress. */
function stubUploads(
  answer: (url: string) => { status: number; body: unknown },
) {
  const uploads: {
    method: string;
    url: string;
    headers: Record<string, string>;
    size: number;
  }[] = [];
  class FakeRequest {
    upload: { onprogress: ((event: ProgressEvent) => void) | null } = {
      onprogress: null,
    };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    withCredentials = false;
    responseType = "";
    status = 0;
    response: unknown = null;
    #method = "";
    #url = "";
    #headers: Record<string, string> = {};
    open(method: string, url: string) {
      this.#method = method;
      this.#url = url;
    }
    setRequestHeader(name: string, value: string) {
      this.#headers[name.toLowerCase()] = value;
    }
    abort() {
      this.onabort?.();
    }
    send(body: Blob) {
      uploads.push({
        method: this.#method,
        url: this.#url,
        headers: this.#headers,
        size: body.size,
      });
      setTimeout(() => {
        this.upload.onprogress?.({
          lengthComputable: true,
          loaded: body.size / 2,
          total: body.size,
        } as ProgressEvent);
        const { status, body: response } = answer(this.#url);
        this.status = status;
        this.response = response;
        this.onload?.();
      }, 10);
    }
  }
  vi.stubGlobal("XMLHttpRequest", FakeRequest);
  return uploads;
}

test("links to media from the company page only with media.view", async () => {
  respond((url) =>
    url.pathname.endsWith("/branches")
      ? { body: branches }
      : { body: company(["media.view"]) },
  );
  const { screen } = await open(`/companies/${companyId}`);
  await expect
    .element(screen.getByRole("link", { name: organizations.mediaTitle }))
    .toHaveAttribute("href", mediaPath);
});

test("lists media with filters in the URL and no upload for viewers", async () => {
  respond((url) => {
    if (url.pathname.endsWith("/media"))
      return {
        body: {
          items:
            url.searchParams.get("kind") === "VIDEO"
              ? [
                  media({
                    name: "Vídeo da vitrine",
                    kind: "VIDEO",
                    durationMs: 75_000,
                    branch: { id: branchA, name: "Centro" },
                  }),
                ]
              : [media()],
          nextCursor: null,
        },
      };
    if (url.pathname.endsWith("/branches")) return { body: branches };
    return { body: company(["media.view"]) };
  });
  const { screen, router } = await open(mediaPath);
  await expect
    .element(screen.getByRole("link", { name: "Promoção de verão" }))
    .toHaveAttribute("href", `${mediaPath}/${assetId}`);
  await expect
    .element(screen.getByText(t.companyScope, { exact: false }).last())
    .toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: t.upload }))
    .not.toBeInTheDocument();
  await expect
    .element(screen.getByRole("link", { name: t.views.trash }))
    .not.toBeInTheDocument();
  await screen.getByLabelText(t.filterKind).selectOptions(t.kinds.VIDEO);
  await expect
    .element(screen.getByRole("link", { name: "Vídeo da vitrine" }))
    .toBeVisible();
  expect(router.state.location.search).toEqual({ kind: "VIDEO" });
  await expect
    .element(screen.getByText("1:15", { exact: false }))
    .toBeVisible();
});

test("explains rejections and shows preparation progress", async () => {
  respond((url) => {
    if (url.pathname.endsWith("/media"))
      return {
        body: {
          items: [
            media({
              id: "00000000-0000-4000-8000-0000000000e2",
              name: "Arquivo ruim",
              status: "REJECTED",
              rejectionReason: "MEDIA_UNREADABLE",
              width: null,
              height: null,
            }),
            media({
              id: "00000000-0000-4000-8000-0000000000e3",
              name: "Vídeo longo",
              kind: "VIDEO",
              status: "PROCESSING",
              processing: { stage: "converting", progress: 40 },
              width: null,
              height: null,
            }),
          ],
          nextCursor: null,
        },
      };
    if (url.pathname.endsWith("/branches")) return { body: branches };
    return { body: company(["media.view"]) };
  });
  const { screen } = await open(mediaPath);
  await expect
    .element(screen.getByText(t.rejections.MEDIA_UNREADABLE, { exact: false }))
    .toBeVisible();
  await expect
    .element(screen.getByText(`${t.stages.converting} 40%`, { exact: false }))
    .toBeVisible();
});

test("creates each item, then streams its bytes with progress", async () => {
  let created = 0;
  respond((url, request) => {
    if (url.pathname.endsWith("/media") && request.method === "POST") {
      created += 1;
      return {
        status: 201,
        body: media({
          status: "UPLOADING",
          version: 1,
          width: null,
          height: null,
        }),
      };
    }
    if (url.pathname.endsWith("/media"))
      return { body: { items: [], nextCursor: null } };
    if (url.pathname.endsWith("/branches")) return { body: branches };
    return { body: company(["media.view", "media.upload"]) };
  });
  const uploads = stubUploads(() => ({
    status: 200,
    body: media({ status: "PROCESSING", version: 2 }),
  }));
  const { screen } = await open(mediaPath);
  await expect.element(screen.getByText(t.empty)).toBeVisible();
  const files = screen.getByLabelText(t.uploadFiles);
  await files.upload([
    new File([new Uint8Array(1200)], "Promoção de verão.jpg", {
      type: "image/jpeg",
    }),
    new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" }),
  ]);
  await screen.getByLabelText(t.uploadScope).selectOptions("Centro");
  await screen.getByRole("button", { name: t.upload }).click();
  await expect.element(screen.getByText(t.uploadDone)).toBeVisible();
  await expect.element(screen.getByText(t.uploadUnsupported)).toBeVisible();
  expect(created).toBe(1);
  expect(await sent("POST", "/media")).toEqual({
    name: "Promoção de verão",
    branchId: branchA,
    contentType: "image/jpeg",
    size: 1200,
  });
  expect(uploads).toEqual([
    {
      method: "PUT",
      url: `/api/companies/${companyId}/media/${assetId}/content`,
      headers: { "content-type": "application/octet-stream" },
      size: 1200,
    },
  ]);
});

test("shows a failed upload with the server's explanation", async () => {
  respond((url, request) => {
    if (url.pathname.endsWith("/media") && request.method === "POST")
      return {
        status: 503,
        body: { error: { code: "MEDIA_STORAGE_FULL", message: "Full" } },
      };
    if (url.pathname.endsWith("/media"))
      return { body: { items: [], nextCursor: null } };
    if (url.pathname.endsWith("/branches")) return { body: branches };
    return { body: company(["media.view", "media.upload"]) };
  });
  const { screen } = await open(mediaPath);
  await screen
    .getByLabelText(t.uploadFiles)
    .upload(new File([new Uint8Array(10)], "a.png", { type: "image/png" }));
  await screen.getByRole("button", { name: t.upload }).click();
  await expect
    .element(screen.getByText(t.errors.MEDIA_STORAGE_FULL))
    .toBeVisible();
});

test("asks for step-up when media actions need strong authentication", async () => {
  respond((url) => {
    if (url.pathname.endsWith("/media"))
      return { body: { items: [], nextCursor: null } };
    if (url.pathname.endsWith("/branches")) return { body: branches };
    return { body: company(["media.view"], ["media.upload"]) };
  });
  const { screen } = await open(mediaPath);
  await expect
    .element(screen.getByRole("link", { name: t.stepUpButton }))
    .toHaveAttribute(
      "href",
      `/api/auth/login?returnTo=${encodeURIComponent(mediaPath)}&assurance=strong`,
    );
});

test("renames with the current version and archives a ready item", async () => {
  let current = media();
  respond((url, request) => {
    if (
      url.pathname.endsWith(`/media/${assetId}`) &&
      request.method === "PATCH"
    ) {
      current = media({
        name: "Verão 2027",
        tags: ["promo", "verão"],
        version: 4,
      });
      return { body: current };
    }
    if (url.pathname.endsWith("/archive")) {
      current = { ...current, status: "ARCHIVED", version: 5 };
      return { body: current };
    }
    if (url.pathname.endsWith(`/media/${assetId}`)) return { body: current };
    return {
      body: company(["media.view", "media.upload", "media.archive"]),
    };
  });
  const { screen } = await open(`${mediaPath}/${assetId}`);
  await expect
    .element(screen.getByRole("img", { name: "Promoção de verão" }))
    .toHaveAttribute(
      "src",
      `/api/companies/${companyId}/media/${assetId}/content?variant=display`,
    );
  await screen.getByLabelText(t.fieldName).fill("Verão 2027");
  await screen.getByLabelText(t.fieldTags).fill("promo, Verão");
  await screen.getByRole("button", { name: t.save }).click();
  await expect.element(screen.getByText(t.saved)).toBeVisible();
  expect(await sent("PATCH", `/media/${assetId}`)).toEqual({
    expectedVersion: 3,
    name: "Verão 2027",
    tags: ["promo", "Verão"],
  });
  await screen.getByRole("button", { name: t.archive }).click();
  await expect.element(screen.getByText(t.archived)).toBeVisible();
  expect(await sent("POST", "/archive")).toEqual({ expectedVersion: 4 });
  await expect
    .element(screen.getByRole("button", { name: t.restore }))
    .toBeVisible();
});

test("deletes only after confirmation and explains media in use", async () => {
  respond((url) => {
    if (url.pathname.endsWith("/delete"))
      return {
        status: 409,
        body: { error: { code: "MEDIA_IN_USE", message: "In use" } },
      };
    if (url.pathname.endsWith(`/media/${assetId}`))
      return { body: media({ status: "ARCHIVED", version: 5 }) };
    return {
      body: company(["media.view", "media.archive", "media.delete"]),
    };
  });
  const { screen } = await open(`${mediaPath}/${assetId}`);
  const remove = screen.getByRole("button", { name: t.delete });
  await expect.element(remove).toBeDisabled();
  await screen.getByLabelText(t.deleteConfirm("Promoção de verão")).click();
  await remove.click();
  await expect
    .element(screen.getByRole("alert"))
    .toMatchTextContent(t.errors.MEDIA_IN_USE);
  expect(await sent("POST", "/delete")).toEqual({ expectedVersion: 5 });
});

test("restores from the trash and discards unusable uploads", async () => {
  let current = media({
    status: "DELETED",
    deletedAt: "2026-10-19T13:00:00.000Z",
    purgeAfter: "2026-11-18T13:00:00.000Z",
    version: 6,
  });
  respond((url, request) => {
    if (url.pathname.endsWith("/restore-deleted")) {
      current = {
        ...current,
        status: "ARCHIVED",
        purgeAfter: null,
        version: 7,
      };
      return { body: current };
    }
    if (url.pathname.endsWith(`/media/${assetId}`) && request.method === "GET")
      return { body: current };
    return {
      body: company(["media.view", "media.archive", "media.delete"]),
    };
  });
  const { screen } = await open(`${mediaPath}/${assetId}`);
  await expect.element(screen.getByText(t.fieldPurge)).toBeVisible();
  await screen.getByRole("button", { name: t.restoreDeleted }).click();
  await expect.element(screen.getByText(t.restored)).toBeVisible();
  expect(await sent("POST", "/restore-deleted")).toEqual({
    expectedVersion: 6,
  });
});

test("discards a rejected upload and returns to the library", async () => {
  respond((url, request) => {
    if (
      url.pathname.endsWith(`/media/${assetId}`) &&
      request.method === "DELETE"
    )
      return { status: 204 };
    if (url.pathname.endsWith(`/media/${assetId}`))
      return {
        body: media({
          status: "REJECTED",
          rejectionReason: "MEDIA_TYPE_MISMATCH",
          version: 3,
        }),
      };
    if (url.pathname.endsWith("/media"))
      return { body: { items: [], nextCursor: null } };
    if (url.pathname.endsWith("/branches")) return { body: branches };
    return { body: company(["media.view", "media.upload"]) };
  });
  const { screen, router } = await open(`${mediaPath}/${assetId}`);
  await expect
    .element(
      screen
        .getByText(t.rejections.MEDIA_TYPE_MISMATCH, { exact: false })
        .first(),
    )
    .toBeVisible();
  await screen.getByRole("button", { name: t.discard }).click();
  await expect.element(screen.getByText(t.empty)).toBeVisible();
  expect(router.state.location.pathname).toBe(mediaPath);
  expect(await sent("DELETE", `/media/${assetId}`)).toEqual({
    expectedVersion: 3,
  });
});
