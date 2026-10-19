import { Type } from "typebox";
import { errorEnvelopeSchema } from "../../errors.js";

const uuid = Type.String({
  pattern:
    "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$",
});
const instant = Type.String({ format: "date-time" });
const sessionState = Type.Union([
  Type.Literal("ACTIVE"),
  Type.Literal("PENDING_LIMIT"),
]);
const protocolValue = Type.String({ minLength: 1, maxLength: 4096 });

export const sessionSummarySchema = Type.Object(
  {
    principalId: uuid,
    sessionId: uuid,
    state: sessionState,
    expiresAt: instant,
    assuranceLevel: Type.String({ maxLength: 64 }),
    authenticatedAt: instant,
    strongAuthenticatedAt: Type.Union([instant, Type.Null()]),
    csrfToken: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export const sessionListSchema = Type.Object(
  {
    items: Type.Array(
      Type.Object(
        {
          id: uuid,
          state: sessionState,
          createdAt: instant,
          lastActivityAt: instant,
          expiresAt: instant,
          current: Type.Boolean(),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

const failures = {
  429: errorEnvelopeSchema,
  500: errorEnvelopeSchema,
  503: errorEnvelopeSchema,
};
const sessionFailures = {
  ...failures,
  400: errorEnvelopeSchema,
  401: errorEnvelopeSchema,
};
const mutationFailures = {
  ...sessionFailures,
  403: errorEnvelopeSchema,
};
const sessionErrors = [
  "AUTHENTICATION_REQUIRED",
  "RATE_LIMITED",
  "SERVICE_UNAVAILABLE",
] as const;
const mutationErrors = [
  ...sessionErrors,
  "VALIDATION_FAILED",
  "CSRF_VALIDATION_FAILED",
] as const;

export const identityOperations = [
  {
    method: "GET",
    url: "/auth/login",
    operationId: "startLogin",
    access: "public",
    description:
      "Browser navigation that starts an OIDC authorization-code login with PKCE at the identity provider and redirects there. returnTo is a same-origin relative path opened after login; anything else becomes /. assurance=strong requests two-step verification (teluni-aal2), enrolling an authenticator when needed; assurance=recent also forces a new authentication for operations that need it within five minutes. A lower achieved level redirects to /sign-in?error=assurance_not_met.",
    schema: {
      querystring: Type.Object(
        {
          returnTo: Type.Optional(Type.String({ maxLength: 2048 })),
          assurance: Type.Optional(
            Type.Union([Type.Literal("strong"), Type.Literal("recent")]),
          ),
        },
        { additionalProperties: false },
      ),
      response: { 303: Type.Null(), 400: errorEnvelopeSchema, ...failures },
    },
    expectedErrors: [
      "VALIDATION_FAILED",
      "RATE_LIMITED",
      "SERVICE_UNAVAILABLE",
    ],
  },
  {
    method: "GET",
    url: "/auth/callback",
    operationId: "completeLogin",
    access: "public",
    description:
      "Provider redirect target. Validates the single-use login attempt, state, nonce and PKCE, provisions the application principal, sets the session cookie and redirects to the return path. Failures redirect to /sign-in?error= with login_failed, login_expired, email_unverified, account_unavailable, assurance_not_met or provider_unavailable.",
    schema: {
      querystring: Type.Object(
        {
          code: Type.Optional(protocolValue),
          state: Type.Optional(protocolValue),
          session_state: Type.Optional(protocolValue),
          iss: Type.Optional(protocolValue),
          error: Type.Optional(protocolValue),
          error_description: Type.Optional(protocolValue),
        },
        { additionalProperties: false },
      ),
      response: {
        303: Type.Null(),
        429: errorEnvelopeSchema,
        500: errorEnvelopeSchema,
      },
    },
    expectedErrors: ["RATE_LIMITED"],
  },
  {
    method: "GET",
    url: "/auth/session",
    operationId: "getSession",
    access: "session",
    description:
      "Describe the current session and return its CSRF token for unsafe requests. A PENDING_LIMIT session must end another session before protected operations. Send x-teluni-activity: background from automatic polling so it does not extend the idle limit.",
    schema: { response: { 200: sessionSummarySchema, ...sessionFailures } },
    expectedErrors: [...sessionErrors],
  },
  {
    method: "POST",
    url: "/auth/logout",
    operationId: "logout",
    access: "session",
    description:
      "End the current session here and at the identity provider and clear the cookie. Requires the session CSRF token in X-CSRF-Token and the panel Origin.",
    schema: { response: { 204: Type.Null(), ...mutationFailures } },
    expectedErrors: [...mutationErrors],
  },
  {
    method: "GET",
    url: "/auth/sessions",
    operationId: "listSessions",
    access: "session",
    description:
      "List the caller's unexpired sessions with minimal timing metadata, newest first.",
    schema: { response: { 200: sessionListSchema, ...sessionFailures } },
    expectedErrors: [...sessionErrors],
  },
  {
    method: "DELETE",
    url: "/auth/sessions/:id",
    operationId: "terminateSession",
    access: "session",
    description:
      "End one of the caller's sessions, including the current one. Another person's session is reported as not found. Requires the CSRF token and the panel Origin.",
    schema: {
      params: Type.Object({ id: uuid }, { additionalProperties: false }),
      response: {
        204: Type.Null(),
        404: errorEnvelopeSchema,
        ...mutationFailures,
      },
    },
    expectedErrors: [...mutationErrors, "RESOURCE_NOT_FOUND"],
  },
  {
    method: "POST",
    url: "/auth/sessions/terminate-all",
    operationId: "terminateAllSessions",
    access: "session",
    description:
      "End every session of the caller, here and at the identity provider, and clear the cookie. Requires the CSRF token and the panel Origin.",
    schema: { response: { 204: Type.Null(), ...mutationFailures } },
    expectedErrors: [...mutationErrors],
  },
  {
    method: "POST",
    url: "/auth/backchannel-logout",
    operationId: "receiveBackchannelLogout",
    access: "public",
    bodyContentType: "application/x-www-form-urlencoded",
    description:
      "OpenID Connect back-channel logout endpoint for the identity provider. A valid, fresh, unreplayed logout token revokes the matching sessions; an invalid one is rejected with 400.",
    schema: {
      body: Type.Object(
        { logout_token: Type.String({ minLength: 1, maxLength: 16_384 }) },
        { additionalProperties: false },
      ),
      response: { 200: Type.Null(), 400: errorEnvelopeSchema, ...failures },
    },
    expectedErrors: [
      "VALIDATION_FAILED",
      "RATE_LIMITED",
      "SERVICE_UNAVAILABLE",
    ],
  },
] as const;
