import { createApiClient } from "@teluni/sdk";
import { loadClientConfig } from "./config.js";

// Codes the shared API runtime can return. Modules pass their own codes when
// unwrapping so that their registry messages are shown as published.
export const coreErrorCodes: ReadonlySet<string> = new Set([
  "AUTHENTICATION_REQUIRED",
  "VALIDATION_FAILED",
  "RESOURCE_NOT_FOUND",
  "RATE_LIMITED",
  "SERVICE_UNAVAILABLE",
  "INTERNAL_ERROR",
]);

export class ApiFailure extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly requestId: string | null,
    message: string,
  ) {
    super(message);
    this.name = "ApiFailure";
  }
}

/** The generated SDK bound to the browser's same-origin API path. */
export function apiClient(token: string | null = null) {
  return createApiClient(loadClientConfig().apiBaseUrl, () => token);
}

export function unwrap<T>(
  {
    data,
    error,
    response,
  }: {
    data?: T;
    error?: unknown;
    response: Response;
  },
  knownCodes: ReadonlySet<string> = coreErrorCodes,
): T {
  if (data !== undefined) return data;
  const envelope =
    error && typeof error === "object" && "error" in error ? error.error : null;
  const detail = envelope && typeof envelope === "object" ? envelope : null;
  const code =
    detail &&
    "code" in detail &&
    typeof detail.code === "string" &&
    /^[A-Z][A-Z0-9_]{0,79}$/.test(detail.code)
      ? detail.code
      : "UNKNOWN_ERROR";
  const requestId =
    detail && "requestId" in detail && typeof detail.requestId === "string"
      ? detail.requestId
      : null;
  const message =
    detail &&
    "message" in detail &&
    typeof detail.message === "string" &&
    (coreErrorCodes.has(code) || knownCodes.has(code))
      ? detail.message
      : "The request could not be completed.";
  throw new ApiFailure(response.status, code, requestId, message);
}

export type FailureOperation = "read" | "create" | "write";

/**
 * User-facing failure text. A failed or lost write is an unknown outcome;
 * `messages` lets a module word its own stable codes.
 */
export function failureMessage(
  error: unknown,
  operation: FailureOperation = "read",
  messages: Readonly<Record<string, string>> = {},
) {
  if (
    operation !== "read" &&
    (!(error instanceof ApiFailure) || error.status >= 500)
  )
    return operation === "create"
      ? "Creation outcome is unknown. Check whether it was created, or retry the same details with the same idempotency key."
      : "Update outcome is unknown. Reload the current data before deciding whether to try again.";
  if (!(error instanceof ApiFailure))
    return "The service could not be reached. Check the connection and try again.";
  const custom = messages[error.code];
  if (custom) return custom;
  switch (error.code) {
    case "AUTHENTICATION_REQUIRED":
      return "Your access token is missing, invalid, or expired. Enter a current token.";
    case "RATE_LIMITED":
      return "Too many requests. Wait a moment and try again.";
    default:
      return error.message;
  }
}
