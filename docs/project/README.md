# Teluni Product Documentation

This is the entry point for Teluni-specific product and architecture planning. The product owner's brief of 2026-10-17 is the source of the initial requirements. Engineering documentation is in English; product copy can be localized. Foundation-wide policy remains in the [documentation task index](../README.md).

## Reading routes and ownership

| Question | Canonical document |
| --- | --- |
| What is Teluni, who uses it, and what is the commercial hypothesis? | [Product vision](product.md) |
| What name/domains and visual identity are approved? | [Teluni brand identity](branding/README.md) |
| What belongs in the initial release, and how will it be accepted? | [Release requirements and acceptance](mvp.md) |
| Which product policies were selected, including the PH-09 questionnaire and delegated choices? | [Release policies](release-policies.md) |
| What numeric limits and qualification goals were selected, and which measurements remain pending? | [Release acceptance targets](release-targets.md) |
| Which pilot/trial, pricing, license, quota, support and cancellation policies are approved? | [Initial commercial policies](commercial-policies.md) |
| What are the accepted architecture directions, proposed module details and unresolved technical choices? | [Product architecture](architecture.md) |
| How must publication, local playback, and recovery behave? | [Offline playback and synchronization](playback-and-sync.md) |
| How can the residential pilot operate and later move to another host? | [Deployment and migration planning](operations.md) |
| What must tenancy, identity, data protection, and localization protect? | [Security and internationalization](security-and-i18n.md) |
| Which human login, recovery, session and permission policies did the owner select? | [Human identity and access](identity-and-access.md) |
| What evidence supports the accepted identity provider, and what remains unqualified? | [Identity-provider evaluation](identity-provider-evaluation.md) |
| How will tenant-owned data be constrained and scoped in persistence (approved D-01)? | [Tenant data ownership and access design](tenant-data-design.md) |
| How will Keycloak, principals, browser sessions and assurance integrate with the API (approved D-02)? | [Human identity and session integration design](identity-session-design.md) |
| How will company invitations and durable transactional email work (approved D-13)? | [Company invitation and durable email delivery design](invitation-delivery-design.md) |
| How will screens be enrolled, authenticated, moved and unlinked (approved D-03 server side)? | [Device enrollment and lifecycle design](device-enrollment-design.md) |
| How are media files uploaded, validated, converted, stored and deleted (approved D-05)? | [Media library design](media-library-design.md) |
| How are playlists, groups and schedules modeled, validated and evaluated in local time (approved D-06)? | [Programming design](programming-design.md) |
| How are programs published, and how do screens synchronize, verify and report them (approved D-04 server side)? | [Publication and synchronization design](publication-sync-design.md) |
| How does the Android TV player store, verify, schedule and play publications, keep time and update (decided D-07)? | [Player design](player-design.md) |
| How do catalogs, prices, promotions, layouts and automatic price publication work (decided D-11)? | [Catalog and composition design](catalog-composition-design.md) |
| How is the pilot host reached, composed, backed up and recovered, and which email and sign-in providers does it use (decided D-08)? | [Pilot deployment and recovery design](deployment-design.md) |
| What may customers upload, how long is each kind of data kept, and how do export, deletion and incidents work (PH-13 decisions)? | [Data handling policies](data-handling-policies.md) |
| What could prevent delivery or safe operation? | [Risks and dependencies](risks.md) |
| What is the phase sequence and current execution state? | [Implementation plan](implementation-plan.md) |
| Which decisions or external prerequisites need a human? | [Human actions](human-actions.md) |

The owning contributor updates each document with changes to its subject, links related requirements rather than copying them, and regenerates the documentation portal through the [contributing workflow](../contributing.md). Stable requirement, decision, risk, task, and human-action IDs support traceability; they are documentation references, not implemented registries or API identifiers.

## Meaning of status

| Product/design status | Meaning |
| --- | --- |
| **Decided** | A product requirement or inherited accepted direction agreed for planning. It does not mean implemented. |
| **Proposed** | A candidate solution or acceptance policy requiring evaluation/review. New ADRs start as `proposed` and become accepted only through explicit review/approval under the [ADR process](../adr/authoring.md). |
| **Pending** | An unanswered choice or investigation; no default has been silently selected. |
| **Future** | Outside the approved initial release and not authorized for immediate implementation. |
| **Implemented** | Supported by repository code and verification evidence. |

Task statuses (`pending`, `in progress`, `completed`, `blocked`, `changed`) have the separate meaning defined by the implementation plan. A completed documentation task establishes a specification, not a completed product capability.

## Verified baseline

The [manifest](../../.orion/project.json) identifies a derived Teluni project, initialized from Orion commit `53bcc705a9f68f01aa1bbea3a0f4df4a009577ea`. [API composition](../../apps/api/src/modules.ts) and [web composition](../../apps/web/src/modules.tsx) contain `identity` and `organizations`: sign-in, server-managed sessions, OTP step-up, company creation with creator membership/responsibility, scoped standard-role access, branches and atomic audit. Their tables and references exist; their local tests use disposable Keycloak and PostgreSQL. Membership administration and the broader identity/access scope remain in progress in PJ-03/PJ-24. No player application, media service, deployment manifest or provisioned real environment exists.

This documentation stage does not authorize implementation, deployment, external publication, or acquisition of paid services. The [plan](implementation-plan.md#phase-sequence-and-exit-criteria) identifies the next review and delivery gates.
