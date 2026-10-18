# ADR-0024: Propose Keycloak and Server-Managed Human Sessions

**Status:** proposed
**Date:** 2026-10-18

## Context

The owner answered PH-11's identity questionnaire, selecting self-hosted Keycloak as candidate, email/password with optional passkeys, Google as the only external login, and server-managed browser sessions. Public company activation, strong administrative assurance, safe recovery and bounded revocation must work within an initially unfunded residential deployment. A concrete provider/version has not been provisioned or qualified.

Accepted ADR-0012 governs the existing API's signed JWT access-token boundary. Its header/claims are not ordinary provider defaults, and its current principal result does not expose session or authentication-assurance evidence. The web shell's in-memory bearer support is not a login/refresh implementation. This decision must distinguish product-policy approval from technical acceptance and implementation.

## Decision

Propose Keycloak as the human identity provider, self-hosted subject to PH-10 feasibility, with a server-managed browser session integrated into the modular backend where appropriate. Use established OIDC Authorization Code with PKCE and maintained session/security components; keep provider credentials server-side and an opaque protected session cookie in the browser. Do not introduce a new microservice by default or an API-owned password/cryptographic implementation.

Preserve ADR-0012's API boundary and stable application principal. A reviewed session boundary must obtain legitimate issuer access tokens and establish trusted session/assurance context; a cookie or caller-supplied MFA/session assertion cannot bypass the existing verifier. Define protected cookies, explicit CSRF protection, OIDC state/nonce/redirect validation, session fixation defenses, refresh rotation/replay/concurrency and local/global logout reconciliation before implementation. No session library, route, schema or provider version is selected by this proposal.

Apply the owner's canonical identity policies, including strong/recent authentication, distinct platform accounts, recovery, inactivity/absolute expiry, session-count and 30-second revocation requirements. Current account/session/membership state must supplement JWT verification. Keep Google brokering/account linking and provider/email credentials at trusted boundaries. A human actor mapper must not accidentally make machine flows authenticate as humans.

Before acceptance, review pinned-version compatibility, immutable principal mapping, every required token claim and trusted session/assurance linkage using the evidence/gaps in the provider evaluation. Where evidence is insufficient, retain an explicit qualification task; do not modify accepted checks to make a default provider token pass. Review deployment/recovery resources separately under PH-10/PH-15. This proposal neither supersedes ADR-0012 nor authorizes provisioning.

## Rationale

The candidate matches the owner's control/budget direction and has relevant documented identity primitives. Server-managed sessions reduce browser exposure of provider tokens and permit accountable session lifecycle controls, at the cost of persistent state and CSRF/refresh coordination. A five-minute token alone cannot enforce the selected 30-second revocation bound. Local JWT verification can remain useful without pretending it provides a complete session or authorization system.

The documentation review establishes plausible compatibility, including Keycloak's configurable `at+jwt` header, not passed interoperability, recovery or capacity tests. Public signup still needs commercial/privacy and abuse readiness; choosing it does not authorize a free plan or immediate public exposure.

## Alternatives Considered

- **Managed OIDC provider:** may reduce some operating responsibilities, but costs/limits/claim compatibility require evaluation beyond the current no-procurement direction. No vendor benchmark or unconditional free-tier assumption is made.
- **Browser-token SPA with Authorization Code and PKCE:** preserves a simpler server session topology but leaves browser token exposure and refresh/lifecycle tradeoffs; the owner selected server-managed sessions instead. This does not reject the client-first React/Vite application or require server rendering.
- **Another established self-hosted provider:** fallback if qualification rejects Keycloak; no unperformed comparative assessment is claimed.
- **Custom issuer/password storage or relaxed JWT checks:** violates governing controls and is not an acceptable workaround.

## Consequences

### Positive

- Keeps human credentials with an established provider and browser tokens out of JavaScript-accessible persistence.
- Preserves provider-independent identity and explicit failure/revocation/assurance boundaries.
- Defines compatibility and operational evidence before a production integration is claimed.

### Negative

- Self-hosting adds patching, resources, recovery and mail-delivery responsibilities despite no procurement budget.
- Server sessions introduce persistence, CSRF, concurrency and logout synchronization work.
- Current foundation principal/configuration contracts do not yet carry all needed session/assurance semantics.

### Operational or Migration Impact

No runtime, dependency, API contract, migration or deployment changes accompany this proposal. Future delivery must pin a maintained provider version/image, define protected credentials/configuration, qualify claim/assurance/session behavior and reconcile revocations on restore. Provider migration preserves application IDs but may require password resets or factor reenrollment. PH-15–PH-17 track external identity, Google and mail prerequisites; PH-11 technical acceptance remains open.

## References

- [Canonical identity and access policies](../project/identity-and-access.md)
- [Provider evidence and qualification gaps](../project/identity-provider-evaluation.md)
- [Existing JWT access-token decision](0012-verify-jwt-access-tokens-at-the-first-api-boundary.md)
- [Authentication policy](../security/authentication.md)
- [Application boundaries](../architecture/application-boundaries.md)
- [OAuth security best current practice](https://www.rfc-editor.org/rfc/rfc9700.html)
