# Authentication

This policy owns trusted identity, credential, and session requirements. [Authorization](authorization.md) owns permission decisions; [secrets management](secrets-management.md) owns credential lifecycle and [redaction](telemetry-redaction.md) owns telemetry handling. Start with the [task index](../README.md) for other concerns.

## Current implementation and scope

The API verifies JWT bearer access tokens according to [ADR-0012](../adr/0012-verify-jwt-access-tokens-at-the-first-api-boundary.md) when token settings are configured. The shared [verifier](../../apps/api/src/authentication.ts) is the executable source for accepted claims and algorithms; it yields a principal ID and issuer scopes, and each module maps scopes to its own capabilities. The [API README](../../apps/api/README.md) describes configuration and the current token contract; the [web README](../../apps/web/README.md) describes the in-memory credential boundary.

Teluni accepted Keycloak and server-managed sessions under ADR-0024/ADR-0025 and approved [product login/recovery/session policies](../project/identity-and-access.md). PH-11 decision selection is complete. The API `identity` module now implements the Keycloak login, PostgreSQL-backed browser sessions, CSRF checks and revocation described in the [identity and session design](../project/identity-session-design.md#implementation-status); step-up assurance, recovery flows and the web workflow remain PJ-24 work, and no real environment is provisioned. Authentication mechanisms for other applications remain separately reviewed. Requirements below apply when those capabilities are introduced; they do not imply implementation. Do not reopen the accepted JWT decision by treating the first API's token format or verification library as undecided.

The current verifier rejects invalid credentials without disclosing token details. Key retrieval, malformed trusted JWKS data, and unexpected verifier failures raise a separate availability error; the API returns a safe 503 and records bounded diagnostics. This distinguishes an authentication infrastructure failure from a routine invalid token while still failing closed. Provider login, refresh, and revocation remain conditional on a provider decision recorded as a human action in the repository's human-action checklist (linked from the README's [Current state](../../README.md#current-state)).

## Authentication boundary

Authentication establishes who an actor is; authorization determines what that actor may do. Verify credentials at a trusted backend boundary before constructing a principal. Browser, mobile, and desktop clients are untrusted: client-supplied identity, role, tenant, email, or permission fields are not proof.

Classify important claims by source and validation: verified identity, application-derived state, or untrusted client input. Use a stable, preferably opaque subject identifier instead of mutable email, username, or display name. Email remains personal data; mailbox verification proves mailbox control, not legal identity.

Keep protocol and provider SDK logic at authentication boundaries. Domain entities must not parse tokens or cookies. Pass the minimum explicit principal/context required by an application operation; avoid mutable global identity and arbitrary request objects. Share identity semantics across applications without forcing one session implementation or creating a shared package before responsibilities are actually shared.

Human and machine identities should remain distinct and attributable. Services should use scoped machine identities rather than shared human credentials; human operations should not borrow service credentials. Anonymous and system actors must be explicit rather than fake users. Delegation, jobs acting on behalf of users, and impersonation must preserve the real actor and effective actor where relevant. Impersonation must retain its start/end and audit trail; an AI agent must not silently become an unrestricted system identity.

Tenant claims, provider roles/groups, and successful authentication do not automatically authorize application access. Define claim mapping, ownership, freshness, revocation, tenant membership, and account-status semantics. Specify what happens to existing credentials when an account is disabled, suspended, deleted, or pending verification. Soft deletion must not accidentally leave an account authenticatable.

## Credentials and token verification

Credentials that grant access are `RESTRICTED`, including session identifiers, access/refresh tokens, API keys, reset links, recovery codes, and signing material. Never intentionally put them in telemetry, public errors, documentation, source control, or support artifacts. Server-only secrets must never reach clients. Prefer secure derived representations for stored verification material when recoverable bearer values are unnecessary.

For every token type, define its purpose, owner, audience, issuer, lifetime, storage, verification, rotation, and revocation. Signed tokens must be cryptographically verified; decoding is not verification, and signing does not encrypt their contents. Explicitly allow intended algorithms and trusted issuers, validate audience and required time/identity claims, and keep clock-skew tolerance bounded. Unknown claims must not silently become trusted state. Minimize token contents rather than embedding profiles or private application data.

Shorter-lived access credentials reduce exposure. Refresh credentials require explicit replay, concurrency, expiration, storage, rotation, and revocation behavior. If immediate revocation is required, design for it before choosing stateless verification. Caching must not retain changed/revoked identity beyond acceptable limits. Signing-key transitions must define valid key identifiers and overlap without accepting obsolete keys indefinitely.

Do not send credentials in URLs except where an explicit protocol requires a short-lived one-time value and its exposure risks are understood. URLs can reach history, proxies, analytics, referrers, and screenshots. One-time credentials should be high-entropy, short-lived, single-purpose, and single-use where appropriate. Deep links must minimize leakage and verify callback ownership. Redirect destinations must be controlled; protocol state/correlation values must use the chosen protocol's generation and validation rules.

API keys need scoped ownership, attribution, expiration, rotation, and revocation. Non-secret prefixes may support lookup/display while the secret portion stays protected. Authenticate service-to-service calls across meaningful trust boundaries using the selected infrastructure; prefer stronger workload identity over long-lived shared secrets when available. Inbound webhooks must verify provider-supported authenticity and integrity and consider timestamps, nonces, or event IDs for replay protection: a signature alone need not prove freshness.

## Password storage

If passwords are supported, never store plaintext or implement custom password hashing or cryptographic primitives. Use an established password-storage implementation for both hashing and verification; choose algorithm and parameters with the authentication stack. Hashes remain `RESTRICTED` because disclosure enables offline attacks. Limit plaintext lifetime in memory and keep hashes out of APIs, telemetry, support tools, and AI prompts.

Recovery is another authentication mechanism and must receive comparable protection. Reset credentials and recovery codes need strong entropy, limited purpose/lifetime, and single-use semantics where appropriate; recovery codes should not remain recoverable in plaintext after initial display where practical. Credential changes require assurance proportionate to risk, such as current-password verification, recent authentication, or MFA. Retry, duplicate request, delivery failure, and expired-token behavior must remain safe for email-based flows.

## Sessions

A session is authenticated continuity, not the user itself. Multiple sessions may differ by device, application, method, creation time, and assurance. Choose server-side, token-based, or hybrid storage against explicit expiration, revocation, multi-device, and operational requirements. Do not create unlimited sessions accidentally.

Define absolute/idle/credential/refresh expiration as applicable and the effect of logout, password change, compromise, administrator action, and user revocation. If “log out everywhere” is required, the architecture must support it. Clearing client UI state alone does not invalidate still-usable server credentials. Prevent session fixation and consider identifier rotation after login, privilege elevation, or security-sensitive changes. Credential-bearing session identifiers must be unguessable and protected in transit, storage, and telemetry.

Use platform-appropriate client storage. Browser choices must account for XSS, CSRF, refresh, revocation, and cross-tab behavior. Cookie authentication needs suitable `Secure`, `HttpOnly`, `SameSite`, and narrow domain/path scope plus an explicit CSRF defense when applicable. Token storage alone does not solve XSS. Persisted mobile credentials should use platform-protected storage; desktop credentials should use operating-system credential facilities rather than plain configuration files.

Client authentication state and cached roles are presentation aids. Offline state is not current server permission; re-evaluate protected actions on reconnection where required. User-visible device/session management must not justify unnecessary device or IP collection.

## Assurance, abuse, and identity providers

Match authentication assurance to operation risk; do not assume all users have passwords or mandate MFA for every future application. Represent stronger/recent authentication explicitly when required for credential, financial, or administrative operations. Define “recent” from risk rather than inventing a global interval.

Avoid unnecessary account enumeration in login, registration, reset, and recovery responses. Choose public response equivalence deliberately against product requirements. Detect repeated failures and apply justified rate limits, progressive delays, or challenges without allowing attacker-controlled attempts to permanently lock out legitimate users. Risk scoring, device fingerprints, CAPTCHA, and third-party bot services need actual requirements, privacy review, and consideration of false positives.

Validate identity-provider assertions using established protocols. Do not link accounts solely by mutable attributes such as email unless verified provider semantics justify it. Collect only required identity attributes and distinguish profile ownership from authentication; do not persist complete provider payloads by default. Provider selection should assess security, standards, availability, recovery/session behavior, export/migration, supported assurance, cost, and lock-in through an ADR.

## Failure handling and observability

Validate required authentication configuration at startup. Distinguish invalid/missing credentials from provider, session-store, or key-refresh failure in safe operational diagnostics. Security-sensitive verification should fail closed unless an explicitly documented offline security model permits otherwise. Provider outage must not silently disable authentication. Avoid unnecessary synchronous provider calls for each request when safe local verification is supported.

Use the canonical [error contract](../api/error-contract.md) for public failures rather than creating illustrative codes as implemented contracts. Expected invalid credentials are not automatically incidents; infrastructure failure must be observable. Keep public messages privacy-safe, with safe internal result categories and request/trace correlation. Metric labels must not contain actor identifiers or credentials. Audit sensitive credential, MFA, identity-link, and revocation changes without values; domain events, security events, and audit records have distinct purposes.

Collect only justified security/device/IP data with explicit classification and retention. Follow [incident response](incident-response.md) and [secrets management](secrets-management.md) for takeover, hijacking, bypass, provider compromise, or exposed credentials; containment may require scoped session revocation, rotation, provider action, audit review, and notification according to actual impact.

## Authentication integration tests

Automated tests must use synthetic identities and credentials. Unit tests may construct principals when transport verification is outside their scope. Boundary tests should cover valid, missing, invalid, expired, and applicable revoked credentials; wrong audience/issuer/algorithm; provider/key failures; claim mapping; production-bypass rejection; and credential redaction. Add regression tests for security defects whenever practical. End-to-end login, logout, refresh, recovery, MFA, and session tests apply only when those flows exist.

Development authentication must not require production credentials. Any development/test bypass must be explicit, isolated, testable, and unreachable in production. Preserve account and authorization checks rather than weakening security for convenience.

## New authentication mechanism checklist

Before introducing or materially changing authentication, document:

1. Actor, identity proof, trusted verification boundary, principal/claim mapping, and provider dependencies.
2. Credential purpose, storage by platform, lifetime, rotation, revocation, logout/global logout, account disablement, and recovery semantics.
3. Assurance and abuse risks, collected data, safe errors/telemetry, audit ownership, and tests.
4. Compatibility of old/new token claims, session formats, keys, cookies, and clients during migration; temporary coexistence and removal where necessary.

Provider, recovery, MFA, impersonation, delegation, and session changes warrant security review. Document implementation-specific behavior near its owner, derive structural contracts from schemas where practical, and use an ADR for significant choices. Do not invent a provider, global session architecture, mobile/desktop mechanism, or shared authentication package to fill a documentation gap.
