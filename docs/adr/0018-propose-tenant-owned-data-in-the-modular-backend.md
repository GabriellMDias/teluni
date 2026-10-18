# ADR-0018: Adopt Tenant-Owned Data in the Modular Backend

**Status:** accepted
**Date:** 2026-10-18

**Acceptance scope:** The owner explicitly approved all pending Teluni ADRs on 2026-10-18. Acceptance establishes the architectural direction, not implementation or production readiness. The design reviews, security controls and qualification evidence below remain mandatory delivery gates in the [implementation plan](../project/implementation-plan.md).

## Context

Teluni requires independent customer companies with branches, memberships, media and devices. The derived repository has PostgreSQL infrastructure and composable API modules but no product tables or tenant enforcement. Tenant isolation must exist in the first product slice, within Orion's modular backend boundaries.

## Decision

Adopt one customer company as the tenant ownership boundary in a shared PostgreSQL database and schema. Model explicit tenant-scoped ownership and references, server-derived membership/branch authorization, and database constraints that prevent cross-tenant associations. Keep capabilities in the existing modular backend, with explicit application interfaces and owned tables; no microservice split is proposed.

Row-level security is an additional option to evaluate, not assumed protection. Review its connection-pooling, runtime-role and migration implications before selecting it. Platform administration remains a separate scoped capability, not an implicit bypass for tenant data access.

## Rationale

A shared deployment fits the initial cost and operational constraints. Explicit ownership allows branch scoping and future company scale without treating a branch as another tenant. It also places substantial responsibility on query/reference design, constraints and adversarial authorization tests; the accepted architecture has not yet been proven by a schema or implementation.

## Alternatives Considered

- **Database or schema per company:** provides a different isolation boundary, but adds migration, connection, backup and recovery coordination for every tenant. Revisit if contractual isolation or measured scale justifies it.
- **Application filters without relational tenant constraints:** simpler initially, but insufficient to protect mixed-tenant references or accidental omitted scope checks. Not a sufficient candidate for the product requirement.

## Consequences

### Positive

- Preserves one operational backend while giving each module clear ownership and tenant semantics.
- Enables negative integration tests against real PostgreSQL from the first vertical slice.

### Negative

- Every data access, reference, cache, media path and asynchronous operation must preserve scope.
- Isolation in a shared database requires continuing review; application administrator access and recovery operations remain sensitive.

### Operational or Migration Impact

No tables or migrations are introduced by this decision. Before dependent implementation/release, complete the ownership/constraint design and row-level-security evaluation and verify the selected role matrix with cross-tenant tests under PJ-03/PJ-07. Later changing tenant partitioning may require a deliberate data migration.

## References

- [Teluni conceptual ownership and modules](../project/architecture.md)
- [Authorization](../security/authorization.md)
- [Database principles](../database/principles.md)
- [Application boundaries](../architecture/application-boundaries.md)
