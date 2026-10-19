# Teluni Human Identity and Session Integration Design

[Identity and access policies](identity-and-access.md) · [Provider evaluation](identity-provider-evaluation.md) · [ADR-0024](../adr/0024-propose-keycloak-and-server-managed-human-sessions.md) · [ADR-0012](../adr/0012-verify-jwt-access-tokens-at-the-first-api-boundary.md) · [Tenant data design](tenant-data-design.md) · [PH-20](human-actions.md#ph-20)

## Status and scope

**Approved detailed design for D-02, 2026-10-18.** The owner approved it as proposed under [PH-20](human-actions.md#ph-20). It turns accepted ADR-0024 (Keycloak, server-managed browser sessions) and ADR-0025 (application-owned access) into concrete trust boundaries, flows, state and controls, and preserves accepted ADR-0012 unchanged. It answers the [new authentication mechanism checklist](../security/authentication.md#new-authentication-mechanism-checklist). PJ-24 implements it incrementally; [implementation status](#implementation-status) separates what exists and is qualified from what remains. A Keycloak behavior below is established only where that section names the passing test.

Out of scope here: company, membership, grant and invitation semantics ([tenant data design](tenant-data-design.md) and the organizations implementation conventions), invitation email delivery (specified by the approved D-13 [invitation and email delivery design](invitation-delivery-design.md) under the [delivery policy](../architecture/delivery-and-side-effects.md)), player/device credentials (D-03) and real environment provisioning (PH-15–PH-17).

## Components and trust boundaries

| Component | Responsibility | Holds |
| --- | --- | --- |
| Keycloak realm, one per environment | Credentials, registration, email verification, MFA/passkeys, recovery, Google brokering (after PH-16), token issuance | Human credentials and provider sessions |
| API `identity` module, inside the existing API process | OIDC relying party, principal provisioning, server-managed sessions, CSRF checks, back-channel logout, and the session boundary used by other modules | `principals`, `human_sessions`, single-use login attempts and logout-token replay records in PostgreSQL |
| ADR-0012 verifier | Unchanged signature/issuer/audience/claim verification of the provider access token on every request | Nothing persistent |
| Browser panel | Navigation and UI state only | An opaque `HttpOnly` session cookie and an in-memory CSRF token; never provider tokens |

No new service, broker or cache is introduced. Keycloak runs as a separate process on the same host (ADR-0021), with its own database under PH-10/PH-15.

## Keycloak configuration contract

The realm definition is committed without secrets and applied by an idempotent provisioning script; test fixtures generate synthetic client secrets per run. Production values come from PH-15. The realm uses the `teluni` login theme, a child of Keycloak's `keycloak.v2` theme that changes only styles (palette, typeface and mark from the [branding guide](branding/README.md)); its files live in [`apps/api/keycloak/themes/teluni`](../../apps/api/keycloak/themes/teluni/login/theme.properties), and every Keycloak that serves the realm, including a real deployment under PH-15, installs them.

**Realm.** Public registration enabled (P06); email as login identifier; duplicate emails disallowed; email verification required before any code is issued (P07). Brute-force detection uses temporary lockout with increasing waits and never permanent lockout (P36). Password policy is minimum length 12, maximum 128, not equal to username or email, with no composition rules (approved under PH-20). Required actions: verify email, configure OTP, passkey registration and recovery codes. The reset-credentials action token lasts 15 minutes and is single-use (P15). Refresh-token rotation is on with zero reuse. SSO session limits never exceed the application's (12-hour maximum).

**Declarative user profile.** Unmanaged attributes are disabled. The `orion_principal_id` attribute is viewable and editable by administrators only, absent from registration and account forms, and validated as a UUID, so users, signup, brokered imports and company administrators cannot create or replace it.

**Assurance levels.** The browser flow maps `teluni-aal1` (password, or Google once enabled) and `teluni-aal2` (password plus OTP or recovery code, or a passkey with user verification) through Keycloak's level-of-authentication conditions. A step-up request for `teluni-aal2` makes a user without an adequate factor enroll one before completing (P12/P13).

**`teluni-web` client.** Confidential; standard flow with mandatory PKCE `S256`; direct access grants, implicit flow, service accounts, device and CIBA grants, token exchange and impersonation disabled; one exact redirect URI per environment at the API callback; no web origins (all provider calls are server-side); front-channel logout off and back-channel logout on with session required; RFC 9068 `at+jwt` access-token header enabled; access-token lifetime five minutes (P20); full scope disabled. A dedicated client scope adds the API audience, maps `orion_principal_id` from the protected attribute, adds the constant `orion_actor_type=human` only on this human-login client, and emits `acr`, `auth_time` and `amr` in the ID token.

**`teluni-provisioner` client.** Confidential; service account only, every login flow disabled. Its service account holds `view-users` and `manage-users` in the realm-management client and nothing else. These roles grant user management as a whole, broader than setting one attribute; PJ-24 checks whether the pinned version's fine-grained administrative permissions can narrow them. Its credential is `RESTRICTED`, used only by principal provisioning, audited through Keycloak admin events and never present in the browser or in tests beyond synthetic values. A Keycloak extension that generates the identifier internally was considered and rejected for now: it adds a Java build, deployment and upgrade coupling.

## Principal provisioning

The application, not Keycloak, creates the stable principal UUID required by ADR-0012, and PostgreSQL is its authority.

1. The callback exchanges the code (state, nonce and PKCE validated by the client library) and verifies the ID token. An unverified email is denied.
2. The identity module inserts `principals (id, issuer, subject)` with a new random UUID under `UNIQUE (issuer, subject)`, using `ON CONFLICT DO NOTHING` followed by a read, so concurrent first logins converge on one principal.
3. If the provider access token lacks `orion_principal_id`, the module reads the Keycloak user. It sets the attribute to the database principal ID only when the attribute is absent; a different existing value fails closed and records a security event. It then refreshes the tokens.
4. The refreshed access token must pass the unchanged ADR-0012 verifier with exactly the database principal ID. Until it does, no session becomes active.

Google brokering (after PH-16) uses a first-broker-login flow that links an existing account only after re-authentication of that account; email-based automatic linking is removed and the Google identity provider does not mark emails as trusted (P08). Global disablement is a platform operation that sets the principal disabled in PostgreSQL, which denies immediately, and disables the Keycloak user, reconciled if that call fails.

## Server-managed sessions

| Property | Design |
| --- | --- |
| Credential | 32 random bytes, base64url, in the session cookie. The database stores only its SHA-256 hash and never the recoverable value |
| Stored state | Principal, provider session ID (`sid`), state, creation, last human activity, absolute expiry, assurance level, last strong-authentication time, encrypted provider tokens, provider check time and a refresh lease |
| Provider tokens | Refresh, access and ID-token-hint values encrypted with AES-256-GCM using a key ring from `RESTRICTED` configuration; a key identifier per value allows rotation with overlap |
| Idle limit | 30 minutes when the principal holds an administrative or branch-manager grant in any active membership, or has no membership; two hours when every active membership is operator access, including operators with additional grants (P17). Applying the stricter limit across memberships avoids trusting a client-selected company for session lifetime; switching company is revalidated per request by the [tenant data design](tenant-data-design.md#request-scope-resolution). Background polling marks requests as non-activity and never extends the session |
| Absolute limit | 12 hours, or a shorter company setting when one exists (P17); no remember-me and no persistent cookie lifetime (P18) |
| Session count | At activation, a principal with five active sessions gets a pending session that can only list and terminate sessions until one is ended; activation locks the principal row to serialize concurrent logins (P19). The two-context platform limit applies when platform accounts exist |
| Termination | The user ends one or all sessions; password recovery and provider-side logout arrive by back-channel logout; global disablement and refresh failure revoke; membership removal denies company access without ending the session |
| Logout | Revoke the application session, end the provider session server-side with the refresh token, clear the cookie. A provider failure still leaves the application session revoked and is reported diagnostically |

## Session boundary for API requests

Product modules that need a human require a session; a bearer-only request without a session is rejected with `AUTHENTICATION_REQUIRED`, because the 30-second session-termination bound cannot be enforced for it. For each request the boundary runs, in order:

1. Request limiting (already required before authentication), then cookie parsing and lookup by hash: active, not expired by idle or absolute limit, principal active.
2. For unsafe methods, CSRF validation (below).
3. Provider revalidation: if the provider was last checked more than 30 seconds ago, introspect the stored access token with the client credentials; inactive means revoke and deny. If the access token has under 60 seconds left, refresh under a single-flight database lease; concurrent requests wait briefly for the winner and otherwise fail as temporarily unavailable rather than skip the check. `invalid_grant` revokes the session; network or provider failure fails closed with `SERVICE_UNAVAILABLE` without revoking.
4. Run the stored access token through the unchanged ADR-0012 verifier and require its principal ID to equal the session's principal.
5. Record human activity when applicable and pass a minimal context to the module: principal ID, session ID, assurance level and last strong-authentication time. Domain code never sees cookies or provider tokens.

Together with per-request membership resolution in the [tenant data design](tenant-data-design.md#request-scope-resolution), this bounds global disablement, session termination and membership reduction to 30 seconds (P20, IA-08). The cost is availability coupling: if Keycloak is unreachable, protected panel operations stop within 30 seconds by design (P22). Players are unaffected.

## Assurance and step-up

Assurance comes only from the ID token verified at the callback (signature, issuer, client audience, nonce): `acr` sets the session level and, for `teluni-aal2`, `auth_time` becomes the last strong-authentication time. Browser-supplied flags are never trusted.

The organizations capability declares which grants require strong authentication (administrators, branch managers and any publication or automatic-price capability, P12) and which operations require strong authentication no older than five minutes (P14). The API answers missing assurance with new public codes (`STRONG_AUTHENTICATION_REQUIRED` or `RECENT_AUTHENTICATION_REQUIRED`, 403) and no state change. The panel then starts a step-up login requesting `teluni-aal2` and, for recency, `max_age=0`. The callback checks that the requested level and recency were met, rotates the session credential (fixation defense on elevation) and updates assurance. A company option can require strong authentication for all members.

## Browser protections

- **Cookies.** Session: `__Host-` prefixed, `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`, no `Domain`, no `Max-Age`. Login attempt: `__Host-` prefixed, `Secure`, `HttpOnly`, `SameSite=Lax` (it must accompany the provider redirect), 10-minute lifetime. Development and test over loopback HTTP may drop the prefix and `Secure`; production configuration rejects a non-HTTPS public origin.
- **CSRF.** Unsafe methods require an `Origin` header equal to the configured public origin and an `X-CSRF-Token` header equal to an HMAC of the session ID under a configured key, compared in constant time. The panel obtains the token from the no-store session endpoint and keeps it in memory.
- **Login integrity.** State, nonce and PKCE verifier live server-side in a single-use attempt row bound to the login-attempt cookie; the callback consumes it with a conditional update and rejects reuse or expiry. A new session credential is always minted at the callback, replacing any existing one.
- **Redirects and leakage.** The return path accepts only same-origin relative paths; otherwise `/`. Authentication responses use `Cache-Control: no-store` and `Referrer-Policy: no-referrer`; the callback redirects immediately so the code does not linger. Cookies, codes and tokens are never logged, consistent with the existing raw-URL and header redaction.

## Back-channel logout

Keycloak posts a logout token to the API when a provider session ends (logout elsewhere, administrator action, password recovery that ends other sessions). The endpoint verifies signature, issuer, client audience, freshness, the back-channel logout event and absence of a nonce; rejects a replayed `jti`; and revokes sessions by provider `sid`, or every session of the subject when no `sid` is present. It is rate-limited and exempt from CSRF because it is a server-to-server call.

## Routes and module composition

The identity module serves, under the API's existing `/api` path prefix: login start (including step-up), callback, session summary with CSRF token, logout, list and terminate own sessions, and back-channel logout. Exact paths, schemas and new error codes are defined as executable contracts in PJ-24 and published through OpenAPI.

This is the first collaboration between API modules. `modules.ts` constructs the identity module first and passes its session-boundary port into dependent module factories. The shared [module contract](../../apps/api/src/module.ts) gains one narrow addition: a module can declare that it requires another module, and activation skips it outside production, or refuses to start in production, when that module did not activate. No dependency-injection framework or global registry is introduced.

## Libraries and configuration

- **OIDC client:** `openid-client` (OpenID-certified relying-party library by the author of the `jose` library the verifier already uses), current major pinned at implementation. It performs discovery, PKCE, state/nonce validation, code exchange, refresh, introspection and ID-token validation.
- **Cookies:** `@fastify/cookie`, used only for parsing and serialization.
- **Not used:** generic Fastify session plugins. Stateless encrypted cookies cannot be revoked, and server-store plugins still need a custom store while lacking the selected session-count, per-role idle, assurance and revocation semantics. Session state remains ordinary application data; all cryptography uses Node's standard primitives (random bytes, SHA-256, HMAC-SHA256, AES-256-GCM), with no custom algorithm.
- **Configuration:** a public HTTPS origin; OIDC client credentials, provisioner credentials and the session/CSRF key ring, all `RESTRICTED`; existing issuer, audience and JWKS settings reused. Names and schemas are added to the canonical [API configuration](../generated/configuration/api.md) only when implemented.

## Local development and automated qualification

Integration and browser tests start disposable containers, as PostgreSQL already does: Keycloak 26.8.1 (`quay.io/keycloak/keycloak`, pinned by digest at implementation, after rechecking its security status) with a generated test realm, and Mailpit as a local SMTP sink for verification and recovery mail. A manual local stack starts the same containers with the API and Vite and prints URLs, using synthetic users only. No production credential is needed in development or CI.

| Case | Verification in PJ-24 |
| --- | --- |
| IA-01, IA-02 (identity part) | Browser signup through the Keycloak pages with Mailpit verification; principal provisioning races; email-only linking rejected |
| IA-05 | Step-up to `teluni-aal2` with OTP enrollment; recency at five minutes; aal1 denied for strong-authentication capabilities |
| IA-06 | Reset link expires after 15 minutes and is single-use; recovery ends earlier sessions through back-channel logout |
| IA-07 | Idle, absolute and pending-session-limit behavior across tabs and concurrent refresh; no remember-me |
| IA-08 | Session termination, global disablement and Keycloak-side logout deny within 30 seconds; stale tokens rejected |
| IA-09 | State/nonce/PKCE/redirect tampering, login-attempt replay, cookie attributes, CSRF/Origin rejection, fixation, token redaction |
| IA-15 | Keycloak, JWKS and database outages fail closed with safe errors and recover |

Each Keycloak assumption in this document (header type, protected attribute mapping, human-only client restrictions, level-of-authentication step-up and OTP enrollment, passkey user verification counting as `teluni-aal2`, recovery codes, introspection reflecting session end and disablement, back-channel logout on recovery, reset-token lifetime, brute-force behavior) is a qualification item. If the pinned version cannot meet one, PJ-24 records the gap and proposes a reviewed change rather than relaxing a check.

## Implementation status

**Implemented and verified on 2026-10-18:**

| Capability | Source | Evidence |
| --- | --- | --- |
| Pinned Keycloak 26.8.1 container and idempotent realm provisioning | [`scripts/keycloak.ts`](../../apps/api/scripts/keycloak.ts), [`scripts/identity-realm.ts`](../../apps/api/scripts/identity-realm.ts) | [Realm contract test](../../apps/api/test/identity/keycloak-contract.test.ts): `at+jwt` header, API audience and human-actor claims; the unchanged verifier rejects tokens until principal provisioning and then accepts them; refresh rotation without reuse; password, client-credential and implicit grants refused; users cannot write the principal attribute through the account console; introspection reports ended sessions and disabled users |
| `identity` API module: principals, PostgreSQL sessions, login attempts, logout-token replay records | [`src/features/identity/`](../../apps/api/src/features/identity/module.ts), [migration](../../apps/api/prisma/migrations/20261018000000_identity_sessions/migration.sql), [grants](../../apps/api/prisma/runtime-grants/identity.sql) | [Integration test](../../apps/api/test/identity/integration.test.ts) against real Keycloak and PostgreSQL |
| Login with PKCE/state/nonce, principal provisioning through the provisioner account, return-path validation | `service.ts`, `provider.ts` | One principal per provider identity across browsers; unbound, forged-state and replayed callbacks fail; external and `/api` return paths become `/` |
| Session boundary: cookie lookup by digest, idle/absolute expiry, CSRF and Origin checks, 30-second introspection, single-flight refresh, ADR-0012 verification, background activity | `service.ts`, `routes.ts`, `public.ts` | CSRF/Origin rejection; idle expiry and background requests; disabled principals and provider-disabled users denied; three waves of ten concurrent requests share one refresh each (a regression test for a stale-token race found during validation); bearer-only requests rejected |
| Session list/termination, five-session limit with pending activation, logout ending the provider session, back-channel logout | `service.ts`, `routes.ts` | Foreign session IDs not found; sixth session pending until one ends; next login after logout asks for credentials; provider-side logout revokes through back-channel logout |
| Web sign-in, sessions page and header sign-out; SDK CSRF header on unsafe methods; pt-BR/en-US copy | [`apps/web/src/identity/`](../../apps/web/src/identity/routes.tsx), [`packages/sdk/src/index.ts`](../../packages/sdk/src/index.ts) | [Browser journeys](../../apps/web/test/e2e/identity/login.spec.ts) through the real Keycloak pages: sign in, cookie attributes and empty browser storage, sessions list, sign-out, ending the current session, localized forged-callback guidance, English copy and axe scans |
| Step-up to `teluni-aal2` with OTP enrollment and recent re-authentication; `requireStrongAuthentication` for modules | Versioned `teluni-browser-v1` flow in `identity-realm.ts`; `service.ts`, `domain.ts`, `public.ts`; sessions page | [Realm contract test](../../apps/api/test/identity/keycloak-contract.test.ts): standard logins report `teluni-aal1`; a strong request from a standard SSO session forces OTP enrollment; a fresh browser needs password and code; `max_age=0` forces a newer authentication. [Integration](../../apps/api/test/identity/integration.test.ts) and [assurance](../../apps/api/test/identity/assurance.test.ts) tests: only stepped-up sessions are strong, strength older than five minutes is not recent, a lower achieved level is rejected. [Browser journey](../../apps/web/test/e2e/identity/login.spec.ts) enrolls an authenticator from the sessions page |
| Presentation profile snapshots | `principals.display_name`/`verified_email`, refreshed only at a verified login; `HumanProfilePort` in `public.ts` | [Integration test](../../apps/api/test/identity/integration.test.ts): the snapshot follows the provider's current name at the next login. The organizations module reads it only for principals on an authorized membership page; it never authorizes, links accounts or accepts invitations |
| Teluni sign-in theme over `keycloak.v2`, installed by the test containers and the persistent development services | [`apps/api/keycloak/themes/teluni`](../../apps/api/keycloak/themes/teluni/login/theme.properties), `teluniThemeFiles()` in `scripts/keycloak.ts` | The identity and organizations browser journeys sign in through the themed pages; form fields keep Keycloak's identifiers |
| Persistent local development services | [`scripts/dev-services.ts`](../../apps/api/scripts/dev-services.ts) | Manual use; see [setup](../setup.md#persistent-local-environment) |
| Disposable local identity stack | [`scripts/local-identity.ts`](../../apps/api/scripts/local-identity.ts), [manual stack](../../apps/web/test/e2e/identity/manual.ts) | Used by the browser journeys; [setup](../setup.md#try-sign-in-locally) |

Also implemented: the narrow `requiresModules` contract and `public.ts` dependency rule, the `access`/`bodyContentType` operation metadata with cookie security in OpenAPI, and the six `TELUNI_` settings in the [configuration reference](../generated/configuration/api.md).

The organizations module now enforces strong authentication for standard company-administrator and branch-manager grants on each operation; its [implementation status](tenant-data-design.md#implementation-status) records the scope. A company administrator without strong assurance can list their company entry and start step-up, but cannot read its detail or administer branches.

**Not yet implemented:** idle-timeout warnings and draft protection in the panel; passkeys and recovery codes as `teluni-aal2` factors (OTP is the only second factor so far); signup, email verification and password recovery through Mailpit (IA-01, IA-06); per-membership idle limits (every session currently uses the 30-minute administrative bound, the stricter value); global disablement as a platform operation; cleanup of expired attempts and replay records; Google (PH-16). Real environments still need PH-10 and PH-15–PH-17.

## Alternatives considered

| Alternative | Disposition |
| --- | --- |
| Refresh every 30 seconds instead of introspection | Also meets the bound but rotates refresh tokens far more often and multiplies rotation races; introspection is read-only |
| Use the Keycloak subject as the application principal | Rejected by the provider evaluation: it ties stored ownership to one provider |
| Keycloak Organizations for memberships | Contradicts ADR-0025's application-owned memberships and scoped grants |
| Accept bearer-only human requests | Cannot enforce session termination within 30 seconds; kept only for the existing verifier tests and non-product routes |
| Separate authentication service | ADR-0024 keeps sessions in the modular backend; no measured need |
