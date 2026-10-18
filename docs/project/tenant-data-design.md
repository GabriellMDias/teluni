# Teluni Tenant Data Ownership and Access Design

[Product architecture](architecture.md#pending-decisions) · [ADR-0018](../adr/0018-propose-tenant-owned-data-in-the-modular-backend.md) · [ADR-0025](../adr/0025-propose-application-owned-scoped-access-profiles.md) · [Identity and session design](identity-session-design.md) · [PH-20](human-actions.md#ph-20)

## Status and scope

**Approved detailed design for D-01, 2026-10-18.** The owner approved it as proposed under [PH-20](human-actions.md#ph-20). It applies accepted ADR-0018 (shared database and schema, company as tenant, relational tenant constraints) and ADR-0025 (application-owned memberships and scoped grants) to concrete persistence and data-access rules, and records the row-level-security evaluation that ADR-0018 requires before the first product migration. The first organizations increment applies these rules; [implementation status](#implementation-status) distinguishes it from the remaining scope. Approval authorizes PJ-03 and the dependent modules to apply these rules; the human session mechanism is [D-02](identity-session-design.md).

The inherited [database principles](../database/principles.md), [authorization policy](../security/authorization.md), [transactions policy](../database/transactions-and-concurrency.md) and the selected [permission matrix](identity-and-access.md#permission-model-and-default-matrix) still govern. Each module's implementation conventions will record its concrete tables, contracts and errors when the module is built; this document owns the rules every tenant-owned module shares.

## Table categories

| Category | First-slice examples | Rule |
| --- | --- | --- |
| Global identity | Principals and human sessions, owned by the identity capability | No `company_id`. Never read through a tenant query except by joining an authorized membership. A company administrator cannot list a principal's other memberships |
| Tenant root | Companies | `id` is the tenant identifier. Lifecycle is a state (active, suspended), not deletion; hard deletion waits for PH-13 retention rules |
| Tenant-owned | Branches, memberships, access profiles, grants and organization audit events; later devices, media, programming, catalogs and publications | Immutable `company_id uuid NOT NULL` and a tenant key `UNIQUE (company_id, id)` |
| Branch-scoped tenant-owned | Grant branch scopes; later devices and branch overrides | Tenant-owned plus `branch_id` referencing the branch through the tenant key |
| Platform operational | None in the first slice | Separate platform capability and accounts (P11); lifecycle metadata only, never implicit tenant-content reads |

## Keys and relational constraints

1. **Identifiers.** The backend generates an immutable random UUID for each row; it is the primary key and the public resource identifier, never authority. Clients cannot choose it.
2. **Tenant key.** Every tenant-owned table with its own `id` declares `UNIQUE (company_id, id)`. This is the only target that other tenant-owned rows may reference. Join tables and one-to-one extensions without an `id` (such as a grant's branch scope or a company's responsible administrator) cannot be referenced and need no tenant key, but their own references follow rule 3.
3. **Composite references.** Every reference from one tenant-owned row to another uses `FOREIGN KEY (company_id, <target>_id) REFERENCES <target> (company_id, id)`. A single-column foreign key into a tenant-owned table is prohibited. A mixed-company reference is therefore unrepresentable, independent of application predicates. An optional reference keeps the default `MATCH SIMPLE` semantics: a null target column means no reference, while `company_id` stays non-null.
4. **Immutable tenant.** The runtime role receives column-level `UPDATE` grants that exclude `company_id`, so no runtime statement can move a row between companies. Moving a device to another company is unlink plus new pairing (FR-02), never an ownership update.
5. **Tenant-scoped uniqueness.** Business keys such as branch names are unique within a company (for example `UNIQUE (company_id, lower(name))`, partial over non-archived rows where archival exists), never globally.
6. **Explicit referential actions.** Declare `ON DELETE RESTRICT` and `ON UPDATE RESTRICT` (Prisma `Restrict`) on every composite tenant reference. Prisma's implicit `SetNull` for optional relations would try to null the shared `company_id` and is never used on these relations. `CASCADE` is reserved for children inside one module whose lifecycle is genuinely owned by the parent, documented in that module's metadata.
7. **Cross-module references.** A downstream module may reference an upstream module's tenant key (for example future devices referencing `branches (company_id, id)`), following the module dependency direction. An upstream table never references a downstream one. Prisma requires a back-relation field on the referenced model; it is structural only, confers no read or write authority, and adapters never traverse it across a module boundary.

A structural test on the migrated database (catalog query, run with the integration suite) asserts rules 2, 3 and 4 for every table that has a `company_id` column. It fails when a new tenant table or foreign key omits the pattern, so the rule does not depend on review alone.

## Request scope resolution

Company-scoped operations carry the requested company in the path, for example `/companies/{companyId}/branches`. The path value is a request for a context, not proof of membership.

1. The session boundary ([D-02](identity-session-design.md)) supplies the verified principal and assurance.
2. The organizations capability resolves access with one current query joining the principal's active membership, the company's state and all unexpired grants in that company. It returns an opaque `CompanyAccess` value: company ID, membership ID, and each granted capability with its scope (whole company or an explicit branch set). Only the organizations capability can construct it.
3. No membership or a suspended membership returns `RESOURCE_NOT_FOUND` for the company path, without revealing that the company exists. Members of a suspended company receive an explicit company-state denial (code defined in PJ-03), kept distinct from limited commercial access under the [commercial policies](commercial-policies.md#payment-expiry-cancellation-and-retention). An in-scope actor missing a capability receives `PERMISSION_DENIED`. A resource outside the actor's scope is indistinguishable from an absent one (`RESOURCE_NOT_FOUND`).
4. Access is resolved on every request from PostgreSQL without caching, so membership removal, suspension, grant reduction and expiry deny the next operation, within the 30-second bound selected in [P20](identity-and-access.md#ph-11-decision-record). Introducing a cache later requires a lifetime below that bound plus explicit invalidation, recorded here first.
5. Sensitive authority changes (membership status, administrator promotion or restoration, grant and profile edits, responsibility transfer) lock the company row first and then the involved membership rows in ID order (`SELECT … FOR UPDATE`), and recheck the actor's current membership and administrator grant inside that transaction. Concurrent authority changes in one company therefore serialize instead of racing, and the fixed lock order avoids deadlocks. Every authority-changing writer must follow the same order.
6. Downstream modules receive `CompanyAccess`, ask it whether a capability applies to a branch, and obtain a branch filter (all branches or an explicit set) to put into SQL. They never accept a company, branch or role from the request body as authority.

## Persistence adapter rules

1. Every adapter operation on tenant-owned data takes the company scope from `CompanyAccess` as a mandatory parameter and uses it in every `WHERE`, `INSERT` and conditional `UPDATE`. Single-row lookups use the tenant key (`companyId_id` in Prisma), never a bare `id` lookup.
2. Branch filters and other authorization predicates are part of the query before pagination, counting and ordering. Nothing is loaded broadly and filtered afterwards.
3. A bulk request resolves its complete identifier set with the scope predicate in one query. If any element is absent or out of scope, the whole request fails as not found, with no partial effect.
4. Caller-supplied references (for example the branches of a grant) are validated by the composite foreign keys as the final guarantee. A tenant foreign-key violation maps to the module's not-found or validation error and never discloses whether the identifier exists in another company.
5. Cursors are bound to company, principal and list scope, and current predicates still apply on every page.
6. Deferred work and durable intents record company ID and the attributable actor; the executor resolves access again before any effect (IA-13). Workers that act as the system have their own explicitly reviewed capability.
7. Derived keys (caches, search entries, media object locations, manifests) include the company ID. A storage location never authorizes access; media access is checked against the owning row.

## Row-level security evaluation

ADR-0018 requires evaluating PostgreSQL row-level security (RLS) before relying on it or rejecting it. The evaluated mechanism was: enable RLS on each tenant-owned table with a policy such as `USING (company_id = current_setting('teluni.company_id', true)::uuid)`, keep the runtime role a non-owner (already true, because migrations own the tables), and set the tenant per transaction with `set_config('teluni.company_id', $1, true)`.

| Concern | Finding |
| --- | --- |
| Mixed-tenant references | PostgreSQL performs foreign-key checks without applying RLS policies, so RLS alone does not prevent a row from referencing another company's identifier. Composite tenant keys are required either way |
| Connection pooling | The tenant setting is safe with the pooled Prisma/`pg` adapter only when transaction-local, so every tenant request must run inside an interactive transaction: extra `BEGIN`/`set_config`/`COMMIT` round trips and a pooled connection held for the whole callback |
| Principal-centric flows | Listing a principal's companies, accepting an invitation before a membership exists and public signup creating a company need extra policy keys or `SECURITY DEFINER` functions, enlarging the reviewed surface |
| Roles and migrations | The runtime role is not the owner, so policies apply without `FORCE`; the migration owner bypasses them for migrations/backfills. Integration tests already run as the runtime role, so policies would be exercised |
| Failure mode | A missing setting yields no rows, which fails closed |

**Approved outcome: do not adopt RLS for the first slice.** The compensating controls are the composite tenant keys, immutable `company_id` grants, the mandatory scope parameter, per-request access resolution, the structural catalog test and the two-company adversarial suite below. **Reevaluate before PJ-14 admits real customer data or public signup**, when a second database consumer (worker, report or raw SQL path) appears, or immediately after any cross-tenant defect. Adapters already receive the scope, so adopting RLS later needs a new ADR, policy migrations and a transaction-local context in adapters, not contract changes.

## Platform and administrative scope

Platform administration is a separate capability held by individually provisioned platform accounts (P11), not a company membership and not a bypass of tenant predicates. The first slice exposes no platform routes. When added, platform operations may manage company lifecycle and commercial metadata; customer content requires an explicit, expiring, company-authorized support grant (P33/P34, IA-14) stored as tenant-owned data. Database, migration and backup access are operational access under [production access](../security/production-access.md), never product authorization.

## Organization audit in the first slice

The organizations capability owns an append-only, tenant-owned audit table. Each membership, invitation, grant, profile, responsibility and company-setting change writes its event in the same transaction as the change, so a failed change leaves no event and a committed change exactly one. The runtime role receives only `INSERT` and `SELECT` on it, which makes rows immutable through the application. Events record actor principal and membership, action, target type and ID, outcome and allowlisted details, never secrets or full payloads. Branch events include the branch name at the time of the event, so later renames or name reuse do not relabel past changes; older events without that detail remain readable. Company administrators read company scope; branch managers only their branch operations. Retention, IP metadata and cross-module audit integrity remain [D-09](architecture.md#pending-decisions) and [PH-13](human-actions.md#ph-13); no deletion job is introduced.

## Required verification

Every tenant-owned module reuses one synthetic two-company fixture: company A with branches A1 and A2, company B with branch B1, and principals for A's administrator, an A1 manager, an A1 operator, B's administrator, a principal holding memberships in both companies with different scopes, and an outsider. The first slice must show, against real migrated PostgreSQL:

1. Substituting another company's or branch's identifier in path, query or body returns not found, and lists, counts and cursors never include out-of-scope rows.
2. A direct runtime-role `INSERT` of a mixed-company reference fails with a foreign-key violation, and a runtime `UPDATE` of `company_id` is denied by privileges.
3. Membership removal or suspension and grant expiry deny the next request; no cached access survives.
4. A branch-restricted manager cannot act on another branch, and a bulk request containing one out-of-scope identifier is rejected entirely.
5. The multi-company principal sees only the requested company's data, and switching company relies only on the path plus current membership.
6. The structural catalog test passes for every tenant table and foreign key.
7. A failed authority change leaves no audit event; a committed one leaves exactly one, readable only within scope.

## Implementation status

The [`organizations` API module](../../apps/api/src/features/organizations/module.ts) owns companies, branches, memberships, standard-role grants and branch scopes, creator responsibility and append-only audit. Its [Prisma schema](../../apps/api/prisma/schema/organizations.prisma), [reviewed migration](../../apps/api/prisma/migrations/20261018010000_organizations/migration.sql), semantic metadata and runtime grants implement composite tenant references and immutable tenant columns. Company creation atomically creates the creator's membership, responsibility and administrator grant with one audit event; it confers no commercial entitlement. Creation retries compare an immutable fingerprint of the original normalized inputs, so later company-setting edits do not change the idempotency decision. Company and branch updates use expected versions; stale-write classification stays on the transaction connection. Access resolves current membership, company state and effective grants on every request; administrator/manager grants require strong authentication.

The [two-company integration suite](../../apps/api/test/organizations/integration.test.ts) exercises tenant/branch isolation, additive scopes, current revocation/expiry/suspension, idempotency, stale versions, name uniqueness, atomic audit, runtime privileges and migrated schema structure. Branch and audit cursors are validated and bound to company, principal and collection; branch cursors also bind the effective branch scope. The [web module](../../apps/web/src/organizations/routes.tsx) uses the generated SDK for company creation/listing, step-up recovery and branch creation/rename/archive with pt-BR/en-US copy. [Browser journeys](../../apps/web/test/e2e/organizations/companies.spec.ts) exercise real login and OTP enrollment.

Company lists use keyset pagination by immutable creation time and ID, newest first, with 50 entries by default and at most 100 per page. Cursors bind the principal and collection; active-membership and effective-role predicates run again before each page. Renaming a company does not move its page boundary. Lists are live rather than snapshots: new companies appear on a restarted first page, and removed/suspended memberships disappear immediately. The web panel preserves company cursors in the URL and provides capability-gated settings and change-history views. Settings capture the edited version and require review after a conflict or unknown write outcome; the history translates allowlisted actions/field names and distinguishes the current actor from another member without exposing raw payloads. Member administration lists memberships with presentation names and emails taken from each person's last verified sign-in (identity's presentation port, called only with principal IDs from the authorized page), never as authority or account-linking evidence.

Strongly authenticated company administrators can page through the company's memberships and suspend, reactivate or remove (terminally, in this company only) a membership with its observed version, each with one audit event. The responsible administrator cannot be suspended or removed, the last active administrator is protected, and reactivating an administrator requires the responsible administrator with strong authentication no older than five minutes (P10/P14). An unchanged status is a no-op. The panel confirms each change with the version observed when it was requested, reloads after a conflict or unknown outcome before another change, and offers recent re-authentication when restoring an administrator.

Grant administration (adding or changing roles and branch scopes), invitations and their durable email-delivery design, approval of new administrators, responsibility transfer, custom profiles, support access, bulk operations and branch-scoped audit reads are not implemented. Their rules above remain requirements; fixture SQL used to test alternate memberships is not a product administration flow. RLS reevaluation remains due before real customer data under PJ-14. Validation evidence and incomplete work remain in [PJ-03/PJ-24](implementation-plan.md#current-work).

These cases implement the tenant portion of [IA-03](identity-and-access.md#required-verification-cases), IA-08 and IA-10 and the NF-01 boundary. They do not replace the identity, session and assurance cases owned by D-02 and PJ-24.
