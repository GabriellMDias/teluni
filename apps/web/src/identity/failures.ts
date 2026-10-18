import { ApiFailure } from "../api-client.js";
import type { IdentityMessages } from "./messages.js";

/**
 * Localized failure text. A failed or lost write is an unknown outcome, never
 * proof that nothing changed.
 */
export function describeFailure(
  error: unknown,
  t: IdentityMessages,
  operation: "read" | "write",
): string {
  if (!(error instanceof ApiFailure))
    return operation === "write" ? t.errors.unknownWrite : t.errors.network;
  switch (error.code) {
    case "AUTHENTICATION_REQUIRED":
      return t.errors.signedOut;
    case "CSRF_VALIDATION_FAILED":
      return t.errors.csrf;
    case "SESSION_LIMIT_REACHED":
      return t.errors.limit;
    case "RESOURCE_NOT_FOUND":
      return t.errors.notFound;
    case "RATE_LIMITED":
      return t.errors.rateLimited;
    case "SERVICE_UNAVAILABLE":
      return t.errors.unavailable;
  }
  if (error.status >= 500)
    return operation === "write" ? t.errors.unknownWrite : t.errors.unavailable;
  return t.errors.generic;
}
