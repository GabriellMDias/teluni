# Teluni Offline Playback and Synchronization

[Requirements](mvp.md) · [Release policies](release-policies.md) · [Acceptance targets](release-targets.md) · [ADR-0019 decision](../adr/0019-propose-immutable-publications-and-atomic-player-activation.md)

## Required guarantees and implementation boundary

**Decided requirements:** local media and catalog rendering through the bounded offline envelope, integrity validation, complete-generation activation and last-valid recovery. Normal video playback does not stream repeatedly from the backend. Freeform composition, independently scheduled areas with optional page coordination, multiple videos/audio and typed custom catalogs must meet the same obligations.

PH-09 has selected product behavior and numeric qualification targets. Protocol/schema serialization, integrity metadata/algorithms, local transactions/storage, processing/rendering libraries, transport and credential/trusted-time mechanisms remain engineering review under D-03/D-04/D-05/D-07/D-11. [ADR-0023](../adr/0023-propose-versioned-catalog-and-composition-publications.md) establishes the accepted versioned catalog/composition boundary; neither ADR is an implemented protocol or evidence of durability.

## Publication lifecycle

1. An authorized publisher deliberately publishes ordinary draft state. A designated price save instead automatically records publication intent for affected published bindings under the release policies; it does not release unrelated layout/schema/record drafts.
2. Validate actor/target tenant and branch scope, schema/record/field bindings, compatible rendering/media profiles, scheduling, effective prices and durable media. Build an immutable complete snapshot with the rules/data needed for offline interpretation. Desired availability must not precede durable assets and metadata.
3. Record the desired generation and required work durably. A database update and media filesystem writes are not one transaction. Stage/verify objects, then commit references/intent with recoverable cleanup and reconciliation. Follow delivery policy; an in-memory after-commit callback alone cannot guarantee price/publication fan-out.
4. The independently authenticated device reconciles its authorized desired generation and local active/staged state. It receives only compatible tenant-scoped rules, schema/record snapshots and media descriptors. A content path is not immutable identity when its bytes can change.
5. Preflight space for staged plus protected active/recovery resources and the target reserve, counting shared files once. Download absent/changed assets with bounded timeouts/retries. Interrupted files cannot masquerade as complete; refreshing download authorization cannot make private media public.
6. Verify expected length/integrity, references, schema interpretation and renderer/media capability before accepting resources. A checksum detects corruption but does not authenticate an untrusted manifest by itself. Preserve valid active output on invalid or incomplete staging.
7. Prepare the complete supported local generation, then durably activate it. Keep publication selection distinct from the schedule that chooses its eligible output. Atomic-generation recovery and safe resource release need actual power-cut tests; do not overwrite active files progressively.
8. Report desired, received/staged and reported-active facts separately. Repeated/lost acknowledgements must reconcile; server acceptance is not proof of TV activation. The panel represents active A plus failed staging B without calling every sync failure a playback outage.
9. Retain the previous valid generation and protected staging resources under retention/reference rules. Restore only if still authorized, compatible and commercially valid. Do not resurrect expired promotions, deleted ownership or revoked credentials.

Confirmed assignment/source changes use the latest published programming without another content publish action. An explicitly confirmed destination with no first publication produces authorized neutral no-programming output after the assignment is applied. This deliberate empty source differs from failed/corrupt synchronization, which preserves valid state. An unreachable player cannot apply an unseen assignment or erasure.

Candidate logical states such as unpaired, no-content, staging, active, degraded and pending-clear describe concurrent facts, not committed enum/API names. Their exact schema must preserve the distinctions above.

## Consistency and concurrency

- Publication/price-save/download/acknowledgement operations need explicit idempotency, stale-write detection, retry ownership, bounded attempts and observable failure/reconciliation. Do not treat a mutation timeout as certain failure or retry an unprotected side effect.
- Order desired state using authoritative generation/revision information, not device wall-clock order. Old acknowledgements and stale processing cannot roll a target back to an earlier price or assignment.
- Under the owner's delegation, prefer the latest authorized compatible desired snapshot and permit coalescing superseded pending delivery work. Keep attributable publication/price history and every still-valid schedule in the latest snapshot; coalescing delivery is not deleting audit events or omitting future programmed transitions.
- Use published dependency revisions for automatic price publication. Concurrent schema/layout drafts remain separate. Expose saved/queued/publication-failed states, reconcile incomplete fan-out and never claim successful device distribution from the catalog transaction alone.
- Typed schema evolution/import and reference validation are part of publication validity. A record/field reference cannot bypass tenant/branch authorization or select another tenant through a custom value.
- Retry elapsed time is separate from business scheduling. Respect application shutdown and bounded work claims; a crashed worker must not lose required intent or leave inaccessible staging permanently.

## Time and regional scheduling

[Release policies](release-policies.md#time-and-scheduling) own the exact calendar/DST/overnight/date-clipping and conflict rules. Backend preview and player must share fixtures for them, regional overrides/page coordination, promotional price validity, pagination and no-match output. Store/compare instants while retaining the geographic zone needed for recurring local time; never inherit the backend host timezone.

An active regional schedule controls its area's output even while the underlying page changes. On ending, return to the applicable current-page/default/neutral state without restarting independent areas. Coordinated page-controlled participants use a common transition point; ordinary short-video completion holds the last frame while the page continues. Schedule boundaries interrupt affected output and override fades/page/item completion without extending expired content.

A regional rendering failure inside an active valid generation may use its still-valid local contingency or neutral area and report degradation while other areas continue. This runtime isolation does not permit activation of a publication with missing/corrupt required resources. A recovered coordinated area rejoins the current valid page/schedule state; it does not replay expired content or reset every area.

## Authorization, clock and recovery boundaries

The [target specification](release-targets.md#reliability-and-synchronization-targets) defines offline authorization and trusted-clock limits. Authorization expiry gives neutral output and requires reconnection; a restored cache cannot extend it. Server revocation rejects new protected operations while a disconnected cache may persist until local authorization expires. Erasure is pending until actually observed, and another tenant cannot pair before verified cleanup/reset.

Detectable clock jumps or insufficient trusted-time confidence suspend time-dependent schedules/prices. Do not claim an incorrect wall clock can always be detected without a reference. If remaining authorization validity cannot be established safely, protected playback must also stop; a local setup/neutral view does not disclose private tenant data. Reboot/offline time estimation and established credential/cryptographic components require threat-model review and qualified tests before delivery.

Initial pairing/synchronization requires backend access. With no valid installed program show safe local setup/no-content output. A publication's optional default or neutral fallback is evaluated locally within authorization and content-validity rules, not permission to replay stale commercial data indefinitely.

## Failure and recovery acceptance

| Condition | Required observable outcome / evidence |
| --- | --- |
| Server/network outage after sync | Local media/catalog/region scheduling continues within AT-10/AT-15/AT-16; verify expected neutral state at expiry/uncertain time |
| Interrupted download or expired access | Safe bounded retry/resume only when verified; active generation continues; no partial asset activation |
| Invalid schema, binding, manifest, media or incompatible profile | Reject staging with bounded actionable diagnostics; keep active valid output; no infinite hot retry or cross-tenant reference |
| Insufficient storage/memory | Respect AT-05, refuse unsafe preparation and preserve active/recovery assets; do not remove functions silently |
| Power/process failure at prepare/switch | Recover a complete eligible generation and reconcile partial/orphan staging; qualify AT-06–AT-10 on representative devices |
| Duplicate/reordered/concurrent price/publication work | Reconcile idempotently; exclude unrelated drafts, stale-price rollback and mixed generations |
| Regional runtime failure or no-match | Isolate the affected output under policy, retain other geometry/output and report actual degradation |
| Date/DST/clock/promotion boundary | Preview/player fixture agreement and AT-13/AT-16; never revive expired output through fallback or rollback |
| Revoked/unlinked/unreachable device | Reject future protected access; enforce local authorization deadline; distinguish pending/confirmed erasure and require cleanup before reassignment |
| Incompatible generation or failed player update | Follow AT-26 support window; preserve allowed playback, report incompatibility, use qualified update/rollback recovery |
| Host move or database/media restore | Reconcile device intent, ownership/revocation and publication resources in an isolated rehearsal; never leak credentials or point devices at an untested recovery endpoint |

Every interruption boundary needs automated contract/security fixtures and physical hardware/network/power evidence, not only happy-path mocks. All future product target measurements remain pending. PH-08/PJ-12/PJ-14 own device qualification; PH-10/PJ-13 own host/restore/migration readiness.
