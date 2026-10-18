# ADR-0025: Adopt Application-Owned Scoped Access Profiles

**Status:** accepted
**Date:** 2026-10-18

**Acceptance scope:** The owner explicitly approved all pending Teluni ADRs on 2026-10-18. Acceptance establishes the architectural direction, not implementation or production readiness. The design reviews, security controls and qualification evidence below remain mandatory delivery gates in the [implementation plan](../project/implementation-plan.md).

## Context

PH-11 approved multiple company memberships, branch-specific grants, customizable profiles and explicit resource sharing. A designated responsible administrator approves additional administrators. The backend must enforce the selected role matrix, strong authentication, 30-second revocation and publication impact, including automatically published prices. Company administration and platform operation must not imply unrestricted customer-content support.

The foundation verifies human identity but has no product membership/permission implementation. ADR-0018 establishes the accepted tenant-owned modular-data direction; its concrete constraints/enforcement remain design and implementation work. Provider-native groups or immutable token roles alone cannot express current resource scope, temporary grants and all-target price effects safely.

## Decision

Adopt application-owned memberships, explicit scoped capability grants and company-customized profiles, with readable standard role presets. Scope grants to a company and explicit branches/resources; combine valid grants additively within their scopes. Account/membership suspension and grant expiration deny access regardless of profile labels. No implicit access to future branches, arbitrary negative-rule language, cyclic inheritance or universal administrator shortcut is selected.

Keep authorization meaning with the owning application/module capabilities; identity/provider adapters establish trusted principals and assurance but do not own company permissions. The organizations capability owns membership/profile meaning. Modules use explicit public capabilities for authorization facts rather than arbitrary cross-module table reads or a generic global switch over domain rules. Exact schema, persistence constraints, caching/invalidation and any row-level-security design require review with ADR-0018 before implementation. No external permission engine or shared framework is selected.

Enforce resource ownership, operation, current state, assurance and scope on every protected entry point, including reads/collections, media, imports, bulk work and delayed effects. Revalidate sensitive effects and ensure the selected freshness bound. Grantors cannot delegate authority they lack, responsible-administrator approval cannot be bypassed, and local membership administration cannot reset global identities.

Authorize every published dependency/target affected by a price save before accepting the mutation; deny the entire out-of-scope mutation without partial publication or automatic approval fallback. Optional company approval policies distinguish a proposal from an effective saved price and prohibit self-approval where required. Pending protected work rechecks authority; an already-issued valid publication continues its delivery lifecycle unless explicitly revoked by the appropriate control.

Routine support uses the real support identity and a visible, expiring customer-authorized scope, read-only by default and separate write grants. No impersonation is selected. Emergency access requires a separately reviewed, exceptional controlled procedure; there is no standing unrestricted content-browsing right.

## Rationale

Application ownership keeps mutable company permissions and resources independent of provider migration and stale identity claims. Explicit capabilities/scopes accommodate both small-business presets and teams working across branches without making every operator an administrator. Attributable publication/support checks preserve the approved product behavior and tenant boundaries.

The owner approved policy and required allow/deny cases, not a database model or proven permission evaluator. Custom profiles, optional approvals and bounded asynchronous revocation add real implementation work and must not be claimed merely from a matrix.

## Alternatives Considered

- **Fixed roles only:** simpler, but cannot satisfy the selected customizable capability/scoping policy without revisiting the product requirements.
- **Provider roles/groups as complete authorization:** insufficient for current memberships, mutable resource relationships, publication fan-out and tenant-safe support; would couple application permission meaning to identity infrastructure.
- **General-purpose policy engine:** no measured need or evaluation justifies another dependency or distributed component at this stage. Review if actual policy complexity warrants it later.
- **Platform superuser and silent price partial success:** obscure authority and violate selected customer-content boundaries and complete price-impact validation.

## Consequences

### Positive

- Makes granted authority, tenant/resource scope, responsibility and delegated support explainable and testable.
- Keeps identity migration independent from company permission ownership.
- Preserves safe all-target publication and attributable pending-work behavior.

### Negative

- Custom profiles, shared resources and optional approvals increase UX, schema and test complexity.
- Freshness, grant races and background work require explicit consistency/invalidation design.
- A safe role matrix alone cannot prevent unsafe queries, caches or credential mapping.

### Operational or Migration Impact

No permission identifiers, schema, migration or running engine is created here. Implementation/release qualification under PJ-03/PJ-07/PJ-24 requires reviewed capability ownership, consistency/enforcement design and passing IA-01–IA-16 cases, including two-company negative fixtures and trustworthy session/assurance context. Later renaming persisted grants or broadening presets is a compatibility/security change. Audit/privacy retention and host recovery remain separate gates.

## References

- [Selected identity policy and permission matrix](../project/identity-and-access.md)
- [Tenant-owned data decision](0018-propose-tenant-owned-data-in-the-modular-backend.md)
- [Human provider/session decision](0024-propose-keycloak-and-server-managed-human-sessions.md)
- [Authorization policy](../security/authorization.md)
- [Release publication policies](../project/release-policies.md)
- [Delivery and side effects](../architecture/delivery-and-side-effects.md)
