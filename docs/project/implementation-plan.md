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
| PJ-01 | Publish the default branch to this project's `origin`, then verify that `pnpm install --frozen-lockfile` and `pnpm validate` pass and that this repository's required CI gate runs and passes. | pending | [PH-01](human-actions.md#ph-01), [PH-02](human-actions.md#ph-02). |
| PJ-02 | Define the product scope, actors, first capabilities, data classification, and acceptance criteria; replace the README introduction. | pending | [PH-05](human-actions.md#ph-05). |
| PJ-03 | Implement the first product module with its schema, migration, API contract, generated SDK use, web workflow, tests, and documentation. | pending | Depends on PJ-02. |
| PJ-04 | Replace the neutral placeholder brand mark and touch icon with the product's visual identity. | pending | [Web identity](../../apps/web/README.md#identity); product decision. |
| PJ-05 | Select an identity provider when the product needs one, and establish deployment-specific operation (hosting, secrets, database, telemetry, backups, alerts, runbooks) when real environment requirements exist. | pending | Conditional; add project human actions when triggered. Governing policies: [production access](../security/production-access.md), [secrets](../security/secrets-management.md), [retention](../security/data-retention.md), [alerting](../reliability/alerting.md), [incident response](../security/incident-response.md), [runbook authoring](../runbooks/authoring.md). |

## Progress and plan changes

Current task statuses own progress. Git preserves detailed editing history. Do not remove unresolved tasks or activation conditions when consolidating completed work.
