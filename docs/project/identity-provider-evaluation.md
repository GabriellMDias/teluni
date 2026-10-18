# Teluni Identity Provider Evaluation

[Selected policies](identity-and-access.md) · [PH-11](human-actions.md#ph-11) · [ADR-0024 proposal](../adr/0024-propose-keycloak-and-server-managed-human-sessions.md)

## Evaluation scope and result

On **2026-10-18**, the owner selected self-hosting and **Keycloak as the preferred candidate**, conditional on host feasibility and compatibility. No recurring identity/email procurement budget is available. This is a documentation/source review, not a deployed-provider experiment, security assessment or proof of operational capacity. No version/image digest has been selected or installed. Public documentation at mutable `latest` URLs does not pin a deployment version.

The existing [verifier](../../apps/api/src/authentication.ts) and accepted [ADR-0012](../adr/0012-verify-jwt-access-tokens-at-the-first-api-boundary.md) are the executable/governing boundary. Do not weaken it because a candidate emits different defaults. Keycloak's documented capabilities support proceeding to technical review, but do not yet close PH-11. Required policies and measured bounds remain in the [identity policy](identity-and-access.md), not vendor defaults.

## Evidence and remaining qualification

| Concern | Evidence available | Required qualification before integration/readiness claims |
| --- | --- | --- |
| `typ=at+jwt` | Official [release notes](https://www.keycloak.org/docs/latest/release_notes/index.html#new-client-configuration-for-access-token-header-type) document an explicit client setting, disabled by default | Pin a maintained compatible version, enable the setting and verify a real synthetic-user access token; do not substitute an ID token or accept default `JWT` headers |
| Signature, issuer, API audience and JWKS | [OIDC integration documentation](https://www.keycloak.org/securing-apps/oidc-layers) and [protocol mappers](https://www.keycloak.org/admin-api/protocol-mappers) provide integration primitives | Confirm exact issuer/audience/JWKS, allowed RS256/ES256 signing and rotation, required `sub`/`iat`/`exp`/`scope`, and wrong-environment/audience rejection through the unchanged verifier |
| Stable application principal and human assertion | Attribute/hardcoded mapping primitives are documented; the repository requires `orion_principal_id` and `orion_actor_type=human` | Specify trusted provisioning/immutable principal mapping and human-only client/flow restrictions; prove users cannot self-edit privileged attributes or issue accepted machine tokens with a hardcoded human assertion |
| Google, credentials and assurance | The [administration guide](https://www.keycloak.org/docs/latest/server_admin/index.html) documents Google brokering, passkeys, authenticators and recovery capabilities | Qualify selected-version maturity, proven linking, email trust, assurance/recency mapping, non-bypassable privileged flows, and recovery/session invalidation; do not assume every Google/passkey login satisfies MFA |
| Browser sessions and refresh | Provider protocols supply a basis; the current web shell has only in-memory bearer handling | Review ADR-0024 and trusted session linkage; qualify server token storage, cookie/CSRF controls, logout/refresh replay/concurrency and selected idle/absolute/session-count bounds. No session library is chosen |
| Application authorization and revocation | Existing verification returns principal ID/scopes only; no product membership/session store exists | Review ADR-0025 and required adapter/context changes; prove 30-second account/session/membership revocation and current-state sensitive confirmation. JWT expiry is insufficient |
| Hosting and recovery | The official [container guide](https://www.keycloak.org/server/containers) describes production setup and recommends a 2 GB container memory limit for small production-ready deployments | PH-10 must measure total host headroom, durable provider state, restricted management, patching, backup and isolated restore. That recommendation is not a measured Teluni capacity result |
| Mail, external accounts and portability | Capabilities exist, but no Teluni sender, Google OAuth client or deployment is verified | PH-15–PH-17 must supply controlled resources/configuration and safe evidence; PH-12/PH-13 govern public activation. Assess migration limits without adding P37=B's unselected mandatory pre-pilot export/import proof |

The `orion_*` claim names are an inherited application contract, not a demand to rebrand them or use Keycloak subjects as application IDs. Mapping a UUID-looking user-editable attribute is insufficient. Pin principal creation, authoritative ownership, `(issuer, subject)` association, uniqueness and migration semantics during design. Do not add machine-client grants to a human client and assume a hardcoded actor mapper distinguishes them. Provider roles may inform trusted mapping but cannot replace current application memberships/resource permissions.

## Alternatives and tradeoffs

| Direction | Assessment for the current decision |
| --- | --- |
| Self-hosted Keycloak | Owner-preferred candidate; operational control with responsibility for resources, upgrades, mail and recovery. Documentation indicates relevant primitives; integration remains unqualified |
| Managed established OIDC provider | Could reduce some hosting responsibilities, but recurring cost, limits, claim compatibility and migration would need a new evaluation. No vendor price/free-tier comparison or rejection on unsupported cost claims is asserted |
| Another established self-hosted provider | Remains a fallback if Keycloak cannot meet required compatibility/operations. No comparative benchmark has been performed |
| API-owned passwords, home-grown issuer or weakened JWT checks | Not an acceptable shortcut under inherited authentication policy/ADR-0012 |

The owner also selected server-managed browser sessions over a browser-token SPA direction. This keeps provider credentials off browser JavaScript but adds session persistence, CSRF defenses and lifecycle/revocation work. It can compose into the modular backend; it neither mandates a new service nor changes the client-first web architecture to server rendering.

## Closing the decision gate

1. Review proposed ADR-0024/ADR-0025, candidate version/claim provisioning and the selected verification cases IA-01–IA-16. Record explicit repository acceptance only when the required technical evidence supports it.
2. Establish a pinned-version compatibility assessment for every mandatory claim and trusted session/assurance linkage. If documentation/source evidence leaves a gap, retain it openly and use a separately authorized isolated qualification task; do not fabricate a passed token/login test or turn a proposal into an accepted decision.
3. Once the decision gate is satisfied, PH-11 can close its decision portion. Keep external provisioning PH-15–PH-17, implementation PJ-03/PJ-24, host recovery PH-10/PJ-13 and release acceptance independently pending until their evidence exists.

No provider provisioning, test login, email delivery, Google callback, token interoperability, session revocation, MFA recovery or restore was performed in this documentation task. Foundation `pnpm validate` cannot qualify those future flows. The policies are ready for design review; PH-11 is **in progress**, with owner answers complete and technical qualification/acceptance remaining.
