# Teluni Security and Internationalization Requirements

[Project documentation](README.md) · [MVP acceptance](mvp.md) · [Pending architecture decisions](architecture.md#pending-decisions)

## Governing controls and implementation boundary

**Decided requirements:** HTTPS, secure established authentication, server-side authorization and tenant isolation, separate device identities with revocable credentials, relevant audit, validated private media, recoverable backups, structured redacted telemetry and controlled updates. These are acceptance obligations; the foundation runtime alone does not implement tenant/device security.

Apply the inherited [authentication](../security/authentication.md), [authorization](../security/authorization.md), [data classification](../security/data-classification.md), [retention](../security/data-retention.md), [redaction](../security/telemetry-redaction.md), [secrets](../security/secrets-management.md), [production access](../security/production-access.md), and [error handling](../architecture/error-handling.md) policies. Do not invent cryptography, token schemes or password implementations. Accepted [ADR-0012](../adr/0012-verify-jwt-access-tokens-at-the-first-api-boundary.md) remains authoritative for human API access-token verification; Keycloak, server-managed sessions and scoped access are accepted under ADR-0024/ADR-0025 and the [identity/access policies](identity-and-access.md). PH-11 decision selection is complete; actual provider/session qualification remains PJ-24, and device-authentication design remains separate.

## Actors and authorization

The actor categories and capability allocation are **decided product policies** from the owner's 38 PH-11 answers. The [canonical identity policy](identity-and-access.md#permission-model-and-default-matrix) owns the full matrix, custom profiles, scoped sharing, responsible-administrator approval, strong authentication, recovery/session limits and support rules. The first standard-role and tenant/branch access enforcement exists in the organizations module; [D-01 implementation status](tenant-data-design.md#implementation-status) and [D-02 implementation status](identity-session-design.md#implementation-status) distinguish verified capabilities from the remaining policy scope. Device identities, code-based pairing, revocation and erasure tracking exist on the server side per the [device enrollment design](device-enrollment-design.md#implementation-status); the Android player and its device-side enforcement remain PJ-12. Custom profiles cover only the organization and device capabilities that exist today; administrator approval requests and support access remain pending.

Platform operation has no default unrestricted customer-content access. Customer support needs explicit scoped, expiring consent with its real actor; no impersonation is selected. Player identities remain separate, restricted to their own authorized assignment/media/reports. Public company signup and automatic activation are selected, with completed PH-12 policy selection and PH-13/PH-15–PH-19 readiness gates; no existing company can be claimed by matching an email domain or name.

Check membership, tenant ownership, branch scope, operation and current resource state on the server. Cover detail/list/search/count/export, uploads/downloads/previews, manifests, synchronization reports and caches. Scope background work and reference validation as carefully as direct requests. Never trust a caller's tenant/role field or rely solely on a hidden button.

The first product slice needs both allow/deny tests with two companies and differently scoped branches, including resource-ID substitution, mixed-tenant references, stale membership, privilege escalation, unsafe assignment and bulk operations. The organizations suite covers its implemented company/branch operations; assignment, bulk and catalog cases arrive with their owning modules. Custom catalog fields, schema definitions, record/media bindings and imported layouts are subject to the same enforcement. [D-01](tenant-data-design.md) records implemented composite constraints and the approved decision to defer row-level security with compensating controls and reevaluation before real customer data.

Designated price saves automatically publish affected published content under completed PH-09. Server authorization must cover both the data mutation and its distribution targets; a draft-only edit permission cannot silently acquire publication power. Expose that consequence in the editing flow, keep unrelated drafts unpublished and audit actor/scope/revision/outcome. The [selected impact/approval rules](identity-and-access.md#publication-impact-and-delayed-work) reject an entire out-of-scope price mutation without partial publication or automatic approval fallback. Optional independent approvals distinguish a proposal from a saved effective price. Automatic work cannot bypass branch or tenant checks; technical verification remains pending.

## Pairing and device lifecycle

Pairing codes must be temporary, single-use, bound to the requesting device/enrollment intent, rate-limited and safe under concurrent claims; length/entropy/expiry are reviewed protocol decisions, not values invented in this plan. The claiming human must already be authorized for the destination company/branch. A displayed code is not an enduring device credential.

Use established platform protections for local credential storage, protected transport, rotation/revocation and controlled updates. Keep raw codes, tokens, signing material and credential-bearing links out of logs, public errors, screenshots and support bundles. Rooted/stolen or physically accessible devices are a separate exposure risk; offline playback cannot guarantee protection against a person who controls the hardware.

Revocation denies future server access; an unreachable device cannot receive an immediate wipe or new policy. [Selected release policies](release-policies.md#offline-authorization-and-clock-trust) and AT-15/AT-16 define the bounded authorization/clock behavior, distinct pending/confirmed erasure and verified cleanup/reset before another tenant's pairing. The device credential mechanism is selected in [ADR-0027](../adr/0027-propose-device-generated-credentials-and-code-based-enrollment.md); time estimation and hardware verification remain D-07. Do not claim instant remote erasure of cached data. No general remote shell or unattended support access is part of the release. [Commercial expiry/entitlement policies](commercial-policies.md#payment-expiry-cancellation-and-retention) add the known trial/paid/grace bound without exceeding AT-15, retroactive unreachable revocation or a bypass for suspended identities. Explicit limited commercial access is not security suspension.

## Initial data inventory

This classifies anticipated data using inherited levels; exact field inventories and retention periods must be recorded with future schemas. Customer media is not automatically public just because it will appear on a physical display.

| Anticipated data | Baseline handling/classification | Collection/retention purpose |
| --- | --- | --- |
| Public marketing and deliberately public product documentation | `PUBLIC` after approval | Product communication; exclude secrets/customer examples |
| User contact/identity references, memberships, branch assignments | `CONFIDENTIAL` | Access administration; minimize identity attributes and review removal |
| Customer media, drafts, schedules, custom catalog schemas/records, prices, publications and file metadata | `CONFIDENTIAL` by default; restricted content requires explicit review | Private content, data-driven display and reliable distribution; reference-aware lifecycle |
| Device configuration, linked IDs, addresses and diagnostics | `CONFIDENTIAL` where linked to people/companies; minimize network identifiers | Fleet operation, security and troubleshooting |
| Credentials, refresh/session material, pairing secrets and signing/backup keys | `RESTRICTED` | Authentication/recovery only; dedicated protected storage and narrow access |
| Audit and operational telemetry | Classification inherited from contained fields; generally private | Attributable actions, incident investigation and reliability; bounded independent retention |

The release does not require patient records, biometrics, card data, surveillance footage or other sensitive personal records. Configurable fields and a weekly-agenda view do not authorize collecting them; use public/synthetic events for examples and qualification. Prevent unsupported data collection and agree customer upload restrictions, purpose, retention/deletion/export, privacy notices, customer/operator responsibilities and incident handling under [PH-13](human-actions.md#ph-13). LGPD and international privacy applicability require qualified review against actual operation; this is not a legal compliance certification.

Catalog/layout imports and values are untrusted data. Validate type/size/reference/schema evolution and prevent arbitrary code, SQL, executable markup or implicit external fetches. Rendering text or selecting a typed reference must not expose private record/media access. Operational report/history defaults in the acceptance targets do not decide legal or security-audit retention.

## Media and audit protections

Validate type using trustworthy inspection as well as declared metadata; define size, dimensions, duration and supported codec/container bounds, safe names/paths and parser isolation. Arbitrary user uploads are not executable content. Malware/content inspection and processing tools are pending risk decisions; no unvalidated transcoding framework is selected. Download authorization must cover tenant/device/retained-publication access and prevent public object exposure.

Audit relevant membership/role changes, device pair/revoke/reassignment, publication and important media lifecycle operations with attributable actor, scope, target, time and outcome. Do not use sampled debug logs as the sole durable audit mechanism. Decide integrity, retention, authorized audit access and failure handling before implementing the affected actions. Expected failures have safe explicit errors; unexpected failures remain observable under the inherited error contract.

## Internationalization

**Decided:** engineering source/identifiers/docs remain English; interfaces must be designed for localization, initially `pt-BR` and `en-US`. Do not put user-interface copy inside domain rules or use translated labels as persisted identifiers. No i18n library is selected yet.

- Separate message keys/parameters from display text, including validation, accessibility labels, device setup and operational states. Translate safely without permitting arbitrary executable markup.
- Present dates, times and numeric values using the selected locale. User-facing server errors need stable codes and safe parameters rather than coupling business rules to localized sentences.
- Explicitly model timezone per branch/device. PH-09 selected [calendar/DST behavior](release-policies.md#time-and-scheduling), device override then deliberately selected branch timezone and per-target local business time. Never inherit host timezone. D-06/D-10 implement matching preview/player fixtures and qualify trusted-time behavior against AT-16; business policy is no longer an unanswered PH-09 choice.
- Locale is independent of timezone, currency and country. Monetary catalog fields use explicit currency and exact representation with scoped branch overrides; precision/rounding contracts must be reviewed before schema implementation. Formatting is not conversion; no automatic exchange service is selected. A generic catalog is not required to contain money fields.
- Localize units and numeric presentation without changing persisted semantic meaning. Currency, decimal/grouping separators, longer translations and different date conventions must be tested.
- Define the Android schedule/time interpretation with the same contract fixtures as backend preview. Changing UI language must not change actual publication timing or tenant permission.

The identity web module establishes this boundary with a typed pt-BR/en-US message catalog, Portuguese by default unless the browser prefers English, without selecting a library (D-10 remains open). Localization of the existing foundation shell and documentation portal is not performed.
