# Teluni Implementation Plan

[Project human actions](human-actions.md) · [Project derivation](../project-derivation.md) · [Validation](../validation.md) · [Documentation index](../README.md)

## Purpose and baseline

This is Teluni's living execution plan and the current plan for this repository. It tracks product and repository work; the [README](../../README.md), current policies, and [accepted ADRs](../adr/README.md) govern implementation.

Teluni was initialized on 2026-10-17 from Orion commit `53bcc705a9f68f01aa1bbea3a0f4df4a009577ea` of https://github.com/GabriellMDias/Orion. The [project manifest](../../.orion/project.json) records that immutable initialization commit and the Orion baseline currently integrated. The repository starts with the foundation's architecture, policies, ADRs, tooling, validation gate, CI, generated references, and Living Documentation Portal, and with no product modules. Results recorded for the Orion repository are not results for this repository until they pass in this checkout and in this repository's CI.

## Maintaining this plan

Every contributor or coding agent performing implementation work must maintain this plan and the [project human actions](human-actions.md) within the user's authorized scope.

1. Before implementation, inspect actual repository state, the relevant task, its prerequisites, governing policy, and linked human actions. Do not treat a planned capability or unchecked action as available.
2. Mark a task `in progress` when work actually starts. Update statuses when evidence, scope, dependencies, or blockers change, and before each handoff or completion report.
3. Allocate stable task IDs as `PJ-NN`; never reuse or renumber them. Add finer tasks when needed; do not hide unfinished subtasks inside a completed row.
4. Record concise evidence in the task row: implementation paths, validation commands and results, review references, or a linked decision. Record evidence produced for this repository—local validation, this repository's CI runs, and this repository's external settings. Do not store secret values or sensitive output.
5. A task becomes `completed` only when its deliverables and acceptance criteria are satisfied with evidence. A partial implementation or an unavailable required check is not completion.
6. When human intervention is necessary, add or update a project human action, link it from the affected task, mark that task `blocked`, and tell the user what is needed. Continue independent authorized work where possible.
7. A future prerequisite is `pending`, not automatically `blocked`.
8. When scope or sequencing changes, use `changed`, explain why and what replaces the work, and link supporting decisions. Do not delete unresolved obligations to make the plan look complete.
9. Update command availability, current documentation, generated artifacts, and the human actions in the same coherent change where applicable. Do not change ADR status merely to record implementation progress.

| Status | Meaning |
| --- | --- |
| `pending` | Not started; includes conditional work whose trigger has not occurred. |
| `in progress` | Work has started and is incomplete. |
| `completed` | Applicable deliverables and acceptance criteria are satisfied with evidence. |
| `blocked` | The identified work cannot proceed without a recorded dependency, decision, access, or correction. |
| `changed` | Scope, applicability, or sequencing was explicitly revised; reason and replacement or disposition are recorded. |

## Constraints throughout implementation

- Retain the accepted stack recorded in the [technology map](../architecture/technology-decisions.md); incompatibilities require explicit resolution rather than silent substitution.
- Add product capabilities as [API modules](../../apps/api/README.md#modules) and [web modules](../../apps/web/README.md#modules) composed in `apps/api/src/modules.ts` and `apps/web/src/modules.tsx`; Orion's [reference implementation](../project-derivation.md#orions-reference-implementation) shows a complete example.
- Deliver tests, security controls, telemetry, and documentation with the behavior they protect.
- Keep generated artifacts reproducible and subordinate to canonical sources. Reviewed SQL migrations follow their separate release-history rules.
- Require non-mutating `pnpm validate` for substantial changes, using the same capabilities locally and in CI.
- Adopt newer Orion revisions only through the reviewed [upgrade workflow](../project-derivation.md#upgrade-to-a-newer-orion-revision).

## Current work

| Task | Scope | Status | Evidence / dependency |
| --- | --- | --- | --- |
| PJ-01 | Publish the default branch to this project's `origin`, then verify that `pnpm install --frozen-lockfile` and `pnpm validate` pass and that this repository's required CI gate runs and passes. | completed | 2026-10-17: [PH-01](human-actions.md#ph-01) publication/fresh-clone installation and provenance verified. Full local `pnpm validate` passed (PJ-02/PJ-06); remote [push run 39077703462](https://github.com/GabriellMDias/teluni/actions/runs/39077703462) and [PR #2 run 39078757654](https://github.com/GabriellMDias/teluni/actions/runs/39078757654) passed `Validate` and `Orion required gate`. [PH-02](human-actions.md#ph-02) effective rules and merge settings verified, including no bypass/linear-history requirement. PR-gate evidence is for head `98a87a896fce6126566ba1521c8954b1fdb5866a`; later commits must pass their own gate. |
| PJ-02 | Define the product scope, actors, first capabilities, data classification, and acceptance criteria; replace the README introduction. | completed | 2026-10-17: [product documentation](README.md) records the owner brief, FR/NF acceptance, conceptual modules/entities, offline/deployment/security requirements, risks and phased dependencies. README updated; ADR-0018 to ADR-0021 remain proposed; [PH-05](human-actions.md#ph-05) completed. Frozen install and full `pnpm validate` passed locally, including 16 E2E tests; product implementation and pending policy/target review remain in PJ-03 and PJ-07 onward. |
| PJ-03 | Implement the first tenant-safe organization/membership vertical slice with schema, reviewed migration, API contract, generated SDK use, localized web workflow, allow/deny tests, audit and documentation. | pending | Phase 2; depends on PJ-02, reviewed D-01/D-02, [PH-11](human-actions.md#ph-11), and a subsequent implementation request. |
| PJ-04 | Replace the neutral placeholder brand mark and touch icon with the product's visual identity. | pending | [Web identity](../../apps/web/README.md#identity); product decision. |
| PJ-05 | Coordinate identity selection and environment-specific operation; delivery is tracked by PJ-07 and PJ-13 rather than hidden in one foundation task. | changed | The product brief activates planning of identity and a residential pilot. [PH-10](human-actions.md#ph-10), [PH-11](human-actions.md#ph-11); operational/security policy remains in the linked product specifications. No provider or environment is provisioned. |
| PJ-06 | Repair documentation validation when local tool skills are installed, preserving project documentation checks. | completed | 2026-10-17: `tooling/validate/docs.ts` excludes installed tool skill directories; regression coverage in `tooling/validate/docs.test.mjs` runs with `pnpm docs:check`. `pnpm install --frozen-lockfile` and full `pnpm validate` passed locally, including all 16 E2E tests. No new human action required. |
| PJ-07 | Review the product architecture, proposed ADRs, role matrix, media/time/offline policies and measurable MVP envelope before dependent implementation. | pending | Phase 1; [pending decisions](architecture.md#pending-decisions), [PH-08](human-actions.md#ph-08), [PH-09](human-actions.md#ph-09), [PH-11](human-actions.md#ph-11). Review each choice before its first dependent slice; no need to select future layout/AI providers now. |
| PJ-08 | Deliver device identities, temporary-code enrollment, branch assignment, orientation/capabilities, revocation and safe reassignment. | pending | Phase 2; PJ-03, reviewed D-03/D-07; FR-02/FR-03; PH-08/PH-09. |
| PJ-09 | Deliver tenant-safe validated private media, metadata, reusable asset references and deletion lifecycle. | pending | Phase 2; PJ-03, reviewed D-05; FR-04; hardware profiles from PH-08. |
| PJ-10 | Deliver playlists, device assignments, schedules/defaults and a preview with deterministic time rules. | pending | Phase 2; PJ-08/PJ-09, reviewed D-06/D-10; FR-05/FR-06; PH-09 resolves group scope. |
| PJ-11 | Deliver immutable publication, compatible device sync, version reconciliation and basic scoped monitoring/audit. | pending | Phase 2; PJ-08/PJ-09/PJ-10, reviewed ADR-0019 and D-09; FR-07/FR-09; contract coordination with PJ-12. |
| PJ-12 | Deliver the Android TV player, durable staging/playback, offline scheduling, reboot/power-loss recovery and controlled packaging/updates. | pending | Phase 2; reviewed ADR-0020 and D-03/D-04/D-07, PH-08 hardware and PJ-08/PJ-11 contracts; FR-08 and playback acceptance. Can proceed alongside backend work after contract review. |
| PJ-13 | Prepare and verify pilot deployment, private ingress, off-host backups/restore, telemetry and host/endpoint migration procedures. | pending | Phase 1 planning already documented; Phase 2 delivery depends on PH-10, PH-13, reviewed ADR-0021 and working artifacts. No production changes authorized by this plan. |
| PJ-14 | Run integrated MVP acceptance and the candidate customer pilot; record usability, offline/recovery, operating cost and support evidence. | pending | Phase 2 exit; PJ-08 through PJ-13, applicable PJ-01/PH-06/PH-07/PH-08/PH-09/PH-12/PH-13 prerequisites. No real-customer acceptance until the security/operations gates pass. |
| PJ-15 | Evaluate and prioritize professional layouts/editor, catalog/dynamic prices, campaigns and advanced monitoring/history/version recovery. | pending | Future Phase 3; PJ-14 evidence, reviewed D-11, separate scope/ADRs and implementation authorization. |
| PJ-16 | Evaluate commercial expansion: integrations, fleet capabilities, other players, AI, subscriptions, white-label and infrastructure scaling. | pending | Future Phase 4; validated demand/costs and independent discovery before committing to each feature; no mandatory sequence between unrelated expansions. |
| PJ-17 | Apply the owner's Apache-2.0 product license choice and verify Renovate/security activation with repository evidence. | completed | 2026-10-17: PH-03 dashboard verified; PH-06 Apache-2.0 scope and metadata recorded in ADR-0022. PH-04 security settings verified and [PR #3 run 39080134706](https://github.com/GabriellMDias/teluni/actions/runs/39080134706) passed validation, dependency review and the required gate at `e92673af60fe99d23023aaedccfde004a6984c16`. Frozen install and full local `pnpm validate` passed, including 16 E2E tests. PH-14 preserves conditional named-attribution work; existing vulnerability remediation is PJ-18. |
| PJ-18 | Investigate and remediate the existing high-severity `source-map-js` dependency advisory through a focused dependency change and regression validation. | pending | [Dependabot alert #1](https://github.com/GabriellMDias/teluni/security/dependabot/1), verified open on 2026-10-17 in `pnpm-lock.yaml`; advisory identifies an event-loop denial of service and first patched version 1.2.2. Evaluate dependency paths and compatible remediation under existing dependency/supply-chain policy. No dependency upgrade is included in PJ-17. |

## Phase sequence and exit criteria

These phases are an initial roadmap, not permission to implement. Dependencies can be refined using pilot evidence without deleting unresolved work. No dates, staffing, price or capacity commitments are inferred from the brief.

| Phase | Scope and task owners | Exit criteria / current position |
| --- | --- | --- |
| 1 — Project foundation | Derivation/repository gate (PJ-01); product identity/requirements/documentation (PJ-02/PJ-04); entity/module and architecture review (PJ-07); deployment strategy (PJ-13 planning) | Product brief and traceable MVP acceptance documented; proposed decisions reviewed before their dependent slices; pilot hardware/identity/operating inputs recorded. Documentation alone does not complete the phase. |
| 2 — Operational MVP | Tenant-safe first slice (PJ-03); devices (PJ-08); media (PJ-09); programming (PJ-10); publication/sync/monitoring (PJ-11); Android offline player (PJ-12); deploy/recover (PJ-13); integrated acceptance (PJ-14) | Full [MVP release journey](mvp.md#release-acceptance-journey) passes, including cross-tenant denial, real hardware/power/network tests, restore/migration rehearsal and nontechnical pilot observation. Record measurements against agreed targets and residual risk; no partial subsystem is an operational MVP. |
| 3 — Professional features | PJ-15, reprioritized after pilot | Separate approved requirements and evidence for each selected feature; not all items must be delivered as one release. |
| 4 — Commercial expansion | PJ-16, based on demand and sustainable operation | Separate approved scope, compatibility/security/cost review and demonstrated customer need for each expansion. |

## Professional and expansion backlog

All items here are **future** and require further design. Baseline audit, staging/recovery and scoped status remain MVP requirements; these later features deepen them.

| Phase / area | Candidate scope | Important design dependency |
| --- | --- | --- |
| 3 — Layouts and editor | Reusable images, videos, text, products/prices, QR codes, clocks, external information and independent content regions; preview and personalization | Structured versioned textual representation (JSON, XML or evaluated alternative), validation/migration, easy copy/import/export and eventual AI authorship. Do not depend only on flattened images. D-11 |
| 3 — Catalog | Products, descriptions/images, categories, regular/promotional prices, combos, availability and layout bindings | Currency/rounding/ownership and dynamic-data propagation; a price change should update dependent content without manually rebuilding artwork |
| 3 — Campaigns | Promotional periods, priorities, automatic start/end, scheduling and publication history | Deterministic conflicts/expiry and version semantics, extending the MVP playlist schedule |
| 3 — Professional operation | Advanced monitoring, change history and operator-directed version recovery | Version retention and validity, privacy and audit; MVP last-valid recovery already required |
| 4 — Integrations | Public documented APIs, ERP/POS price/product updates, webhooks, file imports and dynamic sources | Scoped machine identities, versioned OpenAPI documentation available to partners, idempotency/replay and rate limits |
| 4 — Enterprise fleets | Device groups, shared programming, multi-branch publication, playback reports, operational alerts and support tools | Confirm basic group scope in D-06; measured fleet scale, safe support access and minimized reporting data |
| 4 — Commercial features | Plans/subscriptions, optional payment automation, advanced personalization and white-label | Validated pricing/limits/support/cancellation/tax and provider costs; no gateway dependency for MVP |
| 4 — Players | Web player, other Smart TVs, computers/dedicated devices; possible synchronized screens | Platform-specific capability/update tests and feasibility/clock/network evidence before synchronized-playback promises |
| 4 — AI | Assisted artwork, campaign suggestions, advertising text and layout adaptation | Explicit budgets, privacy/IP review, operator approval and portability; paid inference must not gate core signage |
| 4 — Infrastructure | VPS/cloud, optional S3-compatible storage and capacity expansion | Measured bottlenecks/revenue or operating needs; preserve tested migration and recovery rather than adding microservices by default |

## Progress and plan changes

Current task statuses own progress. Git preserves detailed editing history. Do not remove unresolved tasks or activation conditions when consolidating completed work.
