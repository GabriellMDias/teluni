import createClient from "openapi-fetch";
import type { paths } from "./generated/api-types.js";

export type { paths } from "./generated/api-types.js";

const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Credentials are supplied by the host application and never retained by the
 * SDK. Session-cookie operations send the browser's same-origin cookie
 * automatically; `getCsrfToken` supplies the session's CSRF token, which is
 * added to unsafe requests only.
 */
export function createApiClient(
  baseUrl: string,
  getAccessToken: () => string | null,
  options: { getCsrfToken?: () => string | null } = {},
) {
  const client = createClient<paths>({ baseUrl, credentials: "same-origin" });
  client.use({
    onRequest({ request }) {
      const token = getAccessToken();
      if (token) request.headers.set("Authorization", `Bearer ${token}`);
      const csrf = options.getCsrfToken?.();
      if (csrf && unsafeMethods.has(request.method.toUpperCase()))
        request.headers.set("X-CSRF-Token", csrf);
      return request;
    },
  });
  return client;
}

export type ApiClient = ReturnType<typeof createApiClient>;
