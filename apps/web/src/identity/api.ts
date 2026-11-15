import { queryOptions } from "@tanstack/react-query";
import { createApiClient } from "@teluni/sdk";
import { ApiFailure, unwrap } from "../api-client.js";
import { loadClientConfig } from "../config.js";

// Public codes the identity module returns besides the shared runtime codes.
export const identityErrorCodes: ReadonlySet<string> = new Set([
  "CSRF_VALIDATION_FAILED",
  "SESSION_LIMIT_REACHED",
  "RECENT_AUTHENTICATION_REQUIRED",
]);

// The session's CSRF token lives only in memory and only for unsafe requests.
let csrfToken: string | null = null;

/**
 * The session's CSRF token for unsafe requests the SDK cannot send, such as
 * uploads that report progress. Never store or log it.
 */
export function currentCsrfToken(): string | null {
  return csrfToken;
}

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
export const twoStepKey = ["identity", "two-step"] as const;

export const sessionQuery = queryOptions({
  queryKey: sessionKey,
  queryFn: () => fetchSession(),
  staleTime: 30_000,
});

/** Whether the account has two-step verification enabled (optional per person). */
export const twoStepQuery = queryOptions({
  queryKey: twoStepKey,
  queryFn: async () =>
    unwrap(await sessionApiClient().GET("/auth/two-step"), identityErrorCodes),
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
 * Login is a full browser navigation to the API, never a fetch.
 * `reauthenticate` forces a new authentication (the password, plus the code
 * when two-step verification is enabled) for operations that need one within
 * five minutes.
 */
export function loginHref(
  returnTo: string,
  options: { reauthenticate?: boolean } = {},
): string {
  return `${loadClientConfig().apiBaseUrl}/auth/login?returnTo=${encodeURIComponent(returnTo)}${options.reauthenticate ? "&reauthenticate=true" : ""}`;
}

/**
 * Enables (enrolls an authenticator app) or disables (asks for the password
 * and current code) two-step verification at the provider, then returns.
 */
export function twoStepHref(
  action: "enable" | "disable",
  returnTo: string,
): string {
  return `${loadClientConfig().apiBaseUrl}/auth/login?returnTo=${encodeURIComponent(returnTo)}&twoStep=${action}`;
}

/** Account creation at the provider, returning to `returnTo` once signed in. */
export function signUpHref(returnTo: string): string {
  return `${loadClientConfig().apiBaseUrl}/auth/login?returnTo=${encodeURIComponent(returnTo)}&intent=signup`;
}
