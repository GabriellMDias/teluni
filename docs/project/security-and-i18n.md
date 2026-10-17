# Teluni Security and Internationalization Requirements

[Project documentation](README.md) · [MVP acceptance](mvp.md) · [Pending architecture decisions](architecture.md#pending-decisions)

## Governing controls and implementation boundary

**Decided requirements:** HTTPS, secure established authentication, server-side authorization and tenant isolation, separate device identities with revocable credentials, relevant audit, validated private media, recoverable backups, structured redacted telemetry and controlled updates. These are acceptance obligations; the foundation runtime alone does not implement tenant/device security.

Apply the inherited [authentication](../security/authentication.md), [authorization](../security/authorization.md), [data classification](../security/data-classification.md), [retention](../security/data-retention.md), [redaction](../security/telemetry-redaction.md), [secrets](../security/secrets-management.md), [production access](../security/production-access.md), and [error handling](../architecture/error-handling.md) policies. Do not invent cryptography, token schemes or password implementations. Accepted [ADR-0012](../adr/0012-verify-jwt-access-tokens-at-the-first-api-boundary.md) remains authoritative for human API access-token verification; a provider, full session lifecycle and device-authentication design are pending.

## Actors and authorization

The named actor categories are **decided**; this initial capability allocation is **proposed** for review under D-02/PH-11. Roles are not yet implemented permission identifiers.

| Actor | Intended permitted scope | Boundary to preserve |
| --- | --- | --- |
| Platform administrator | Operate Teluni and establish/manage customer lifecycle | No automatic unrestricted customer-content browsing or impersonation; support elevation must be attributable, scoped and audited |
| Company administrator | Company settings, branches, memberships and allowed company resources | Cannot administer another company or grant platform authority |
| Branch manager | Resources/devices/programming in authorized branches | Shared company assets and publication targets need explicit permissions; no implicit access to every branch |
| Operator | Explicit operational capabilities such as preparing media/playlists, publishing or observing status | Publication/delete/member-management privileges are not implied by a label; agree the matrix |
| Player identity | Its own assignment, required media and reports | No human-admin capability, cross-device browsing or arbitrary tenant selector |

Check membership, tenant ownership, branch scope, operation and current resource state on the server. Cover detail/list/search/count/export, uploads/downloads/previews, manifests, synchronization reports and caches. Scope background work and reference validation as carefully as direct requests. Never trust a caller's tenant/role field or rely solely on a hidden button.

The first product slice needs both allow/deny tests with two companies and differently scoped branches, including resource-ID substitution, mixed-tenant references, stale membership, privilege escalation, unsafe assignment and bulk operations. Physical tenant enforcement remains proposed under ADR-0018.

## Pairing and device lifecycle

Pairing codes must be temporary, single-use, bound to the requesting device/enrollment intent, rate-limited and safe under concurrent claims; length/entropy/expiry are reviewed protocol decisions, not values invented in this plan. The claiming human must already be authorized for the destination company/branch. A displayed code is not an enduring device credential.

Use established platform protections for local credential storage, protected transport, rotation/revocation and controlled updates. Keep raw codes, tokens, signing material and credential-bearing links out of logs, public errors, screenshots and support bundles. Rooted/stolen or physically accessible devices are a separate exposure risk; offline playback cannot guarantee protection against a person who controls the hardware.

Revocation denies future server access; an unreachable device cannot receive an immediate wipe or new policy. Decide a bounded offline authorization/retention policy, local unlink/reset behavior and safe company reassignment. Do not claim immediate remote revocation of already cached content. No general remote shell or unattended support access is part of the MVP.

## Initial data inventory

This classifies anticipated data using inherited levels; exact field inventories and retention periods must be recorded with future schemas. Customer media is not automatically public just because it will appear on a physical display.

| Anticipated data | Baseline handling/classification | Collection/retention purpose |
| --- | --- | --- |
| Public marketing and deliberately public product documentation | `PUBLIC` after approval | Product communication; exclude secrets/customer examples |
| User contact/identity references, memberships, branch assignments | `CONFIDENTIAL` | Access administration; minimize identity attributes and review removal |
| Customer media, drafts, schedules, prices, publications and file metadata | `CONFIDENTIAL` by default; restricted content requires explicit review | Private customer content and reliable distribution; reference-aware lifecycle |
| Device configuration, linked IDs, addresses and diagnostics | `CONFIDENTIAL` where linked to people/companies; minimize network identifiers | Fleet operation, security and troubleshooting |
| Credentials, refresh/session material, pairing secrets and signing/backup keys | `RESTRICTED` | Authentication/recovery only; dedicated protected storage and narrow access |
| Audit and operational telemetry | Classification inherited from contained fields; generally private | Attributable actions, incident investigation and reliability; bounded independent retention |

The MVP does not require patient records, biometrics, card data, surveillance footage or other sensitive personal records. Serving clinics/hospitals does not authorize their collection. Prevent unsupported data collection and agree customer upload restrictions, purpose, retention/deletion/export, privacy notices, customer/operator responsibilities and incident handling under [PH-13](human-actions.md#ph-13). LGPD and international privacy applicability require qualified review against actual operation; this is not a legal compliance certification.

## Media and audit protections

Validate type using trustworthy inspection as well as declared metadata; define size, dimensions, duration and supported codec/container bounds, safe names/paths and parser isolation. Arbitrary user uploads are not executable content. Malware/content inspection and processing tools are pending risk decisions; no unvalidated transcoding framework is selected. Download authorization must cover tenant/device/retained-publication access and prevent public object exposure.

Audit relevant membership/role changes, device pair/revoke/reassignment, publication and important media lifecycle operations with attributable actor, scope, target, time and outcome. Do not use sampled debug logs as the sole durable audit mechanism. Decide integrity, retention, authorized audit access and failure handling before implementing the affected actions. Expected failures have safe explicit errors; unexpected failures remain observable under the inherited error contract.

## Internationalization

**Decided:** engineering source/identifiers/docs remain English; interfaces must be designed for localization, initially `pt-BR` and `en-US`. Do not put user-interface copy inside domain rules or use translated labels as persisted identifiers. No i18n library is selected yet.

- Separate message keys/parameters from display text, including validation, accessibility labels, device setup and operational states. Translate safely without permitting arbitrary executable markup.
- Present dates, times and numeric values using the selected locale. User-facing server errors need stable codes and safe parameters rather than coupling business rules to localized sentences.
- Explicitly model timezone per branch/device; **proposed** precedence is device override then branch timezone, with a deliberate choice required for new branches. Never silently inherit the backend host timezone. D-06/D-10 must resolve scheduling/DST ambiguity and cross-zone preview.
- Locale is independent of timezone, currency and country. Money uses an explicit currency and exact representation, with precision/rounding rules evaluated before the future catalog/billing schemas; formatting is not conversion. No currency conversion service is selected.
- Localize units and numeric presentation without changing persisted semantic meaning. Currency, decimal/grouping separators, longer translations and different date conventions must be tested.
- Define the Android schedule/time interpretation with the same contract fixtures as backend preview. Changing UI language must not change actual publication timing or tenant permission.

The first product UI slice should establish this boundary. Localization of the existing foundation shell is not performed in this task.
