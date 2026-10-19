import type { paths } from "@teluni/sdk";
import { ApiFailure, unwrap } from "../api-client.js";
import { loadClientConfig } from "../config.js";
import { currentCsrfToken, sessionApiClient } from "../identity/api.js";
import { organizationErrorCodes } from "../organizations/api.js";

export const mediaErrorCodes: ReadonlySet<string> = new Set([
  ...organizationErrorCodes,
  "MEDIA_TYPE_UNSUPPORTED",
  "MEDIA_TOO_LARGE",
  "MEDIA_UPLOAD_INCOMPLETE",
  "MEDIA_NOT_UPLOADING",
  "MEDIA_NOT_READY",
  "MEDIA_IN_USE",
  "MEDIA_STORAGE_FULL",
  "MEDIA_INVALID_STATE",
]);

export type Media =
  paths["/companies/{companyId}/media/{assetId}"]["get"]["responses"][200]["content"]["application/json"];
export type MediaStatus = Media["status"];
export type MediaKind = Media["kind"];
export type RejectionReason = NonNullable<Media["rejectionReason"]>;
export type MediaView = "library" | "archived" | "trash";
export type MediaVariant = "thumbnail" | "display" | "original";
export type MediaContentType = NonNullable<
  paths["/companies/{companyId}/media"]["post"]["requestBody"]
>["content"]["application/json"]["contentType"];
export type MediaFilter = Readonly<{
  cursor?: string;
  view?: MediaView;
  kind?: MediaKind;
  scope?: string;
  text?: string;
}>;

/** Content types the server admits, mapped to their kind. */
export const acceptedTypes: Readonly<Record<MediaContentType, MediaKind>> = {
  "image/jpeg": "IMAGE",
  "image/png": "IMAGE",
  "image/webp": "IMAGE",
  "video/mp4": "VIDEO",
  "video/quicktime": "VIDEO",
  "video/x-m4v": "VIDEO",
  "video/webm": "VIDEO",
  "video/x-matroska": "VIDEO",
};
/** Mirrors the server's admission limits so obvious failures stay local. */
export const maxBytes: Readonly<Record<MediaKind, number>> = {
  IMAGE: 20 * 1024 * 1024,
  VIDEO: 1024 * 1024 * 1024,
};

export const mediaListKey = (companyId: string) =>
  ["media", "list", companyId] as const;
export const mediaKey = (companyId: string, assetId: string) =>
  ["media", "item", companyId, assetId] as const;

const client = sessionApiClient;

export async function listMedia(companyId: string, filter: MediaFilter) {
  return unwrap(
    await client().GET("/companies/{companyId}/media", {
      params: { path: { companyId }, query: { limit: 48, ...filter } },
    }),
    mediaErrorCodes,
  );
}

export async function getMedia(
  companyId: string,
  assetId: string,
): Promise<Media> {
  return unwrap(
    await client().GET("/companies/{companyId}/media/{assetId}", {
      params: { path: { companyId, assetId } },
    }),
    mediaErrorCodes,
  );
}

export async function createMedia(
  companyId: string,
  input: {
    name: string;
    branchId: string | null;
    contentType: MediaContentType;
    size: number;
  },
): Promise<Media> {
  return unwrap(
    await client().POST("/companies/{companyId}/media", {
      params: { path: { companyId } },
      body: input,
    }),
    mediaErrorCodes,
  );
}

export const isAccepted = (type: string): type is MediaContentType =>
  Object.hasOwn(acceptedTypes, type);

/** The display name proposed for a file: its name without the extension. */
export function nameFromFile(fileName: string): string {
  const base = fileName.replace(/\.[^.]{1,8}$/, "").trim();
  return (base || fileName).slice(0, 120);
}

/**
 * Streams a file to an item created for it. XMLHttpRequest reports upload
 * progress, which fetch cannot; the session cookie and CSRF token go as for
 * every other unsafe request.
 */
export function uploadMediaContent(
  companyId: string,
  assetId: string,
  file: Blob,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<Media> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const base = loadClientConfig().apiBaseUrl.replace(/\/$/, "");
    request.open(
      "PUT",
      `${base}/companies/${encodeURIComponent(companyId)}/media/${encodeURIComponent(assetId)}/content`,
    );
    request.withCredentials = true;
    request.setRequestHeader("Content-Type", "application/octet-stream");
    const csrf = currentCsrfToken();
    if (csrf) request.setRequestHeader("X-CSRF-Token", csrf);
    request.responseType = "json";
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0)
        onProgress(event.loaded / event.total);
    };
    request.onerror = () => reject(new TypeError("Upload failed"));
    request.onabort = () => reject(new DOMException("Aborted", "AbortError"));
    request.onload = () => {
      const body: unknown = request.response;
      try {
        resolve(
          unwrap(
            request.status === 200
              ? { data: body as Media, response: new Response(null) }
              : {
                  error: body,
                  response: new Response(null, { status: request.status }),
                },
            mediaErrorCodes,
          ),
        );
      } catch (error) {
        reject(
          error instanceof ApiFailure ? error : new TypeError("Upload failed"),
        );
      }
    };
    signal?.addEventListener("abort", () => request.abort(), { once: true });
    request.send(file);
  });
}

export async function updateMedia(
  companyId: string,
  item: Media,
  input: { name?: string; tags?: string[] },
): Promise<Media> {
  return unwrap(
    await client().PATCH("/companies/{companyId}/media/{assetId}", {
      params: { path: { companyId, assetId: item.id } },
      body: { expectedVersion: item.version, ...input },
    }),
    mediaErrorCodes,
  );
}

type Transition = "archive" | "restore" | "delete" | "restore-deleted";

export async function changeMedia(
  companyId: string,
  item: Media,
  transition: Transition,
): Promise<Media> {
  const options = {
    params: { path: { companyId, assetId: item.id } },
    body: { expectedVersion: item.version },
  };
  const api = client();
  const result =
    transition === "archive"
      ? await api.POST(
          "/companies/{companyId}/media/{assetId}/archive",
          options,
        )
      : transition === "restore"
        ? await api.POST(
            "/companies/{companyId}/media/{assetId}/restore",
            options,
          )
        : transition === "delete"
          ? await api.POST(
              "/companies/{companyId}/media/{assetId}/delete",
              options,
            )
          : await api.POST(
              "/companies/{companyId}/media/{assetId}/restore-deleted",
              options,
            );
  return unwrap(result, mediaErrorCodes);
}

/** Discards an upload that never became usable. */
export async function discardMedia(
  companyId: string,
  item: Media,
): Promise<void> {
  const { error, response } = await client().DELETE(
    "/companies/{companyId}/media/{assetId}",
    {
      params: { path: { companyId, assetId: item.id } },
      body: { expectedVersion: item.version },
    },
  );
  if (response.status === 204) return;
  unwrap({ error, response }, mediaErrorCodes);
}

/** Same-origin URL of a rendition; the session cookie authorizes it. */
export function contentUrl(
  companyId: string,
  item: Media,
  variant: MediaVariant,
): string {
  const base = loadClientConfig().apiBaseUrl.replace(/\/$/, "");
  // Responses are revalidated against the content hash on every use.
  return `${base}/companies/${encodeURIComponent(companyId)}/media/${encodeURIComponent(item.id)}/content?variant=${variant}`;
}

/** Whether an item is still changing on the server and worth polling. */
export function isPending(item: Media): boolean {
  return item.status === "UPLOADING" || item.status === "PROCESSING";
}
