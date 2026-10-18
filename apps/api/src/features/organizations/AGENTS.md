# Organizations Module

This module owns companies (tenants), branches, memberships, standard role grants, the responsible administrator and organization audit. Read the [tenant data design](../../../../../docs/project/tenant-data-design.md) and the [permission matrix](../../../../../docs/project/identity-and-access.md#permission-model-and-default-matrix) before changing behavior.

- Every tenant-owned table with its own `id` keeps `(company_id, id)` unique and every tenant reference composite; the structural suite in `test/organizations/integration.test.ts` enforces it on the migrated schema. Join tables and one-to-one extensions without an `id` follow D-01's key exception. Never grant runtime `UPDATE` on `company_id` or `UPDATE`/`DELETE` on audit events.
- Resolve access on every request through `OrganizationService.access`; never cache it beyond the 30-second revocation bound, and never take company, branch or role from a request body as authority. Hidden resources answer `RESOURCE_NOT_FOUND`.
- Role capabilities live in `domain.ts`; administrator and branch-manager grants count only in strongly authenticated sessions (P12). Add a capability with the module that needs it, not speculatively.
- Each change writes its audit event in the same transaction. Other modules import only `public.ts`.
