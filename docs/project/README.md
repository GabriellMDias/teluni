# Teluni Product Documentation

This is the entry point for Teluni-specific product and architecture planning. The product owner's brief of 2026-10-17 is the source of the initial requirements. Engineering documentation is in English; product copy can be localized. Foundation-wide policy remains in the [documentation task index](../README.md).

## Reading routes and ownership

| Question | Canonical document |
| --- | --- |
| What is Teluni, who uses it, and what is the commercial hypothesis? | [Product vision](product.md) |
| What name/domains and visual identity are approved? | [Teluni brand identity](branding/README.md) |
| What belongs in the MVP, and how will it be accepted? | [MVP requirements and acceptance](mvp.md) |
| What are the proposed components, modules, entities, and unresolved technical choices? | [Product architecture](architecture.md) |
| How must publication, local playback, and recovery behave? | [Offline playback and synchronization](playback-and-sync.md) |
| How can the residential pilot operate and later move to another host? | [Deployment and migration planning](operations.md) |
| What must tenancy, identity, data protection, and localization protect? | [Security and internationalization](security-and-i18n.md) |
| What could prevent delivery or safe operation? | [Risks and dependencies](risks.md) |
| What is the phase sequence and current execution state? | [Implementation plan](implementation-plan.md) |
| Which decisions or external prerequisites need a human? | [Human actions](human-actions.md) |

The owning contributor updates each document with changes to its subject, links related requirements rather than copying them, and regenerates the documentation portal through the [contributing workflow](../contributing.md). Stable requirement, decision, risk, task, and human-action IDs support traceability; they are documentation references, not implemented registries or API identifiers.

## Meaning of status

| Product/design status | Meaning |
| --- | --- |
| **Decided** | A product requirement or inherited accepted direction agreed for planning. It does not mean implemented. |
| **Proposed** | A candidate solution or acceptance policy requiring evaluation/review. New ADRs remain `proposed` under the [ADR process](../adr/authoring.md). |
| **Pending** | An unanswered choice or investigation; no default has been silently selected. |
| **Future** | Outside the MVP and not approved for immediate implementation. |
| **Implemented** | Supported by repository code and verification evidence. |

Task statuses (`pending`, `in progress`, `completed`, `blocked`, `changed`) have the separate meaning defined by the implementation plan. A completed documentation task establishes a specification, not a completed product capability.

## Verified baseline

The [manifest](../../.orion/project.json) identifies a derived Teluni project, initialized from Orion commit `53bcc705a9f68f01aa1bbea3a0f4df4a009577ea`. [API composition](../../apps/api/src/modules.ts) is empty; [web composition](../../apps/web/src/modules.tsx) contains the core shell/portal only. There are no product tables/migrations, player application, media service, deployment manifests, or tenant workflows. The API runtime has health routes, configuration, telemetry, PostgreSQL infrastructure, and optional JWT access-token verification. These are foundation capabilities, not a working SaaS sign-in or tenant system.

This documentation stage does not authorize implementation, deployment, external publication, or acquisition of paid services. The [plan](implementation-plan.md#phase-sequence-and-exit-criteria) identifies the next review and delivery gates.
