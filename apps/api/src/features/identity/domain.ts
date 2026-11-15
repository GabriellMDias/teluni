// Framework-independent session rules from the identity and session design
// (docs/project/identity-session-design.md). PostgreSQL owns the clock; these
// values are the bounds it applies.

export const sessionPolicy = Object.freeze({
  /** P19: at most five active sessions per person. */
  maxActiveSessions: 5,
  /** P17: 12-hour absolute session duration. */
  absoluteLifetimeSeconds: 12 * 60 * 60,
  /** P17: administrative contexts, and principals without memberships. */
  administrativeIdleSeconds: 30 * 60,
  /** P17: operator-only access. */
  operatorIdleSeconds: 2 * 60 * 60,
  /** P20: revalidate the provider at least every 30 seconds. */
  providerRecheckSeconds: 30,
  /** Refresh provider tokens this long before they expire. */
  refreshMarginSeconds: 60,
  /** Single-flight refresh lease held by one request. */
  refreshLeaseSeconds: 10,
  /** Activity is persisted at most this often, bounding idle precision. */
  activityWriteIntervalSeconds: 15,
  /** Lifetime of one login attempt between redirect and callback. */
  loginAttemptSeconds: 10 * 60,
  /** Data handling policies: ended sessions and attempts are kept 30 days. */
  endedRetentionDays: 30,
  /** Rows deleted per table each time a login starts. */
  purgeBatchSize: 100,
});

/** Authentication context class the realm reports for a browser login. */
export const assuranceLevels = Object.freeze({
  standard: "teluni-aal1",
});

/** P14: sensitive operations need an authentication this recent. */
export const recentAuthenticationSeconds = 5 * 60;

/**
 * Account actions a login may carry out at the provider. Two-step
 * verification is optional for each person: enabling enrolls an
 * authenticator; disabling re-authenticates with the password and the
 * current code before the provider removes it.
 */
export type TwoStepAction = "enable" | "disable";

export type SessionState = "PENDING_LIMIT" | "ACTIVE" | "REVOKED";

export const revocationReasons = [
  "LOGOUT",
  "TERMINATED_BY_USER",
  "EXPIRED",
  "REPLACED",
  "PROVIDER_LOGOUT",
  "PROVIDER_INACTIVE",
  "REFRESH_REJECTED",
  "PRINCIPAL_DISABLED",
  "PRINCIPAL_MISMATCH",
] as const;
export type RevocationReason = (typeof revocationReasons)[number];

/** Browser-safe reasons a login callback reports to the panel. */
export type LoginFailureReason =
  | "login_failed"
  | "login_expired"
  | "email_unverified"
  | "account_unavailable"
  | "assurance_not_met"
  | "provider_unavailable";

export class LoginFailure extends Error {
  readonly reason: LoginFailureReason;
  constructor(reason: LoginFailureReason) {
    super(`Login failed: ${reason}`);
    this.reason = reason;
    this.name = "LoginFailure";
  }
}

export type SessionFailureCode =
  | "AUTHENTICATION_REQUIRED"
  | "CSRF_VALIDATION_FAILED"
  | "SESSION_LIMIT_REACHED"
  | "RECENT_AUTHENTICATION_REQUIRED"
  | "RESOURCE_NOT_FOUND"
  | "SERVICE_UNAVAILABLE";

export class SessionFailure extends Error {
  readonly code: SessionFailureCode;
  constructor(code: SessionFailureCode) {
    super(`Session failure: ${code}`);
    this.code = code;
    this.name = "SessionFailure";
  }
}

/** Assurance and identity facts a protected operation may rely on. */
export type HumanContext = Readonly<{
  principalId: string;
  sessionId: string;
  assuranceLevel: string;
  authenticatedAt: Date;
  /** Database-clock age of the session's provider authentication. */
  authenticationAgeSeconds: number;
  scopes: ReadonlySet<string>;
}>;

/**
 * Requires, for sensitive operations, an authentication no older than five
 * minutes (P14): the password again, plus the code for people who enabled
 * two-step verification. Throws a SessionFailure the API answers with 403
 * and no state change.
 */
export function requireRecentAuthentication(context: HumanContext): void {
  if (context.authenticationAgeSeconds > recentAuthenticationSeconds)
    throw new SessionFailure("RECENT_AUTHENTICATION_REQUIRED");
}

const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
export function isUnsafeMethod(method: string): boolean {
  return unsafeMethods.has(method.toUpperCase());
}

/**
 * Accepts only same-origin relative paths outside the API prefix, so a login
 * can never redirect to another site or loop back into the API.
 */
export function safeReturnPath(value: string | undefined): string {
  if (
    !value ||
    value.length > 2048 ||
    !/^\/(?![/\\])[^\s\\]*$/.test(value) ||
    /^\/api(\/|$|\?|#)/.test(value)
  )
    return "/";
  return value;
}

/** `__Host-` names require HTTPS; loopback development uses plain names. */
export function cookieNames(secure: boolean) {
  return secure
    ? { session: "__Host-teluni_session", login: "__Host-teluni_login" }
    : { session: "teluni_session", login: "teluni_login" };
}
