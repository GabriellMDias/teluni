import { queryOptions } from "@tanstack/react-query";
import { createApiClient } from "@teluni/sdk";
import { ApiFailure, unwrap } from "../api-client.js";
import { loadClientConfig } from "../config.js";

// Public codes the identity module returns besides the shared runtime codes.
export const identityErrorCodes: ReadonlySet<string> = new Set([
  "CSRF_VALIDATION_FAILED",
  "SESSION_LIMIT_REACHED",
  "STRONG_AUTHENTICATION_REQUIRED",
  "RECENT_AUTHENTICATION_REQUIRED",
]);

// The session's CSRF token lives only in memory and only for unsafe requests.
let csrfToken: string | null = null;

/** SDK client that sends the session cookie and, on unsafe methods, the CSRF token. */
export function sessionApiClient() {
  return createApiClient(loadClientConfig().apiBaseUrl, () => null, {
    getCsrfToken: () => csrfToken,
  });
}

export type CurrentSession = Readonly<{
  principalId: string;
  sessionId: string;
  state: "ACTIVE" | "PENDING_LIMIT";
  expiresAt: string;
  assuranceLevel: string;
  authenticatedAt: string;
  strongAuthenticatedAt: string | null;
}>;

export type SessionItem = Readonly<{
  id: string;
  state: "ACTIVE" | "PENDING_LIMIT";
  createdAt: string;
  lastActivityAt: string;
  expiresAt: string;
  current: boolean;
}>;

/** The current session, or null when the browser has none. */
export async function fetchSession(
  options: { background?: boolean } = {},
): Promise<CurrentSession | null> {
  const result = await sessionApiClient().GET("/auth/session", {
    headers: options.background ? { "x-teluni-activity": "background" } : {},
  });
  if (result.response.status === 401) {
    csrfToken = null;
    return null;
  }
  const { csrfToken: token, ...session } = unwrap(result, identityErrorCodes);
  csrfToken = token;
  return session;
}

export const sessionKey = ["identity", "session"] as const;
export const sessionsKey = ["identity", "sessions"] as const;

export const sessionQuery = queryOptions({
  queryKey: sessionKey,
  queryFn: () => fetchSession(),
  staleTime: 30_000,
});

export async function listSessions(): Promise<readonly SessionItem[]> {
  return unwrap(
    await sessionApiClient().GET("/auth/sessions"),
    identityErrorCodes,
  ).items;
}

function expectNoContent(result: {
  data?: unknown;
  error?: unknown;
  response: Response;
}) {
  if (result.response.ok) return;
  unwrap(result, identityErrorCodes);
  throw new ApiFailure(result.response.status, "UNKNOWN_ERROR", null, "");
}

export async function logout(): Promise<void> {
  expectNoContent(await sessionApiClient().POST("/auth/logout"));
  csrfToken = null;
}

export async function terminateSession(id: string): Promise<void> {
  expectNoContent(
    await sessionApiClient().DELETE("/auth/sessions/{id}", {
      params: { path: { id } },
    }),
  );
}

export async function terminateAllSessions(): Promise<void> {
  expectNoContent(
    await sessionApiClient().POST("/auth/sessions/terminate-all"),
  );
  csrfToken = null;
}

/**
 * Login is a full browser navigation to the API, never a fetch. `strong`
 * requests two-step verification; `recent` also forces a new authentication
 * for operations that need one within five minutes.
 */
export function loginHref(
  returnTo: string,
  assurance?: "strong" | "recent",
): string {
  return `${loadClientConfig().apiBaseUrl}/auth/login?returnTo=${encodeURIComponent(returnTo)}${assurance ? `&assurance=${assurance}` : ""}`;
}
