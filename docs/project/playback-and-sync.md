# Teluni Offline Playback and Synchronization

[Project documentation](README.md) · [MVP acceptance](mvp.md) · [ADR-0019 proposal](../adr/0019-propose-immutable-publications-and-atomic-player-activation.md)

## Required guarantees and proposal boundary

**Decided requirements:** normal playback uses local images/videos, continues during temporary server/network outages, validates new content, activates a complete programming version, and preserves the last valid programming for recovery. Streaming every playback from the backend is not the normal delivery model.

**Proposed mechanism:** an immutable versioned manifest, durable staged downloads and an atomic local active-generation reference. The exact format, integrity algorithm/metadata, local transaction/storage technique, synchronization transport, and protocol compatibility window remain D-04/D-07. This is not an implemented protocol. Follow [delivery/retry policy](../architecture/delivery-and-side-effects.md), [compatibility](../architecture/versioning-and-compatibility.md), and [file/identity security](security-and-i18n.md).

## Publication lifecycle

1. An authorized administrator previews draft playlist/schedule state and deliberately publishes. Draft edits cannot change an already active publication.
2. The backend validates tenant/branch references, supported asset profiles, scheduling rules, targets and media availability. It creates a complete immutable snapshot and records the desired version durably. A publication must not be announced as available before required assets and metadata are durable.
3. A device authenticates independently and reconciles its desired version with local staged/active state. It obtains only its authorized tenant/assignment data and compatible manifests.
4. It computes missing/changed assets, checks the space budget including staging and retained fallback, and downloads with bounded timeouts/retries. A retry may refresh authorized download access without making assets public.
5. It validates file length/integrity and player compatibility before treating an asset as usable. Interrupted partial files cannot masquerade as complete assets. A checksum detects corruption; it does not authenticate an untrusted manifest by itself.
6. It prepares the complete local schedule/resources and durably switches the active generation only when all required resources are usable. The exact safe playback boundary for the switch needs hardware tests; an in-place overwrite is not acceptable.
7. It reports receipt, staging and activation separately. Lost/repeated acknowledgements must be reconcilable. Backend intent and device observation must remain distinct in the panel.
8. It retains the previous valid generation for recovery under the selected capacity/retention policy. Garbage collection never removes active, staged, or retained recovery resources. Failed publication does not destroy the current generation.

Candidate logical states are `unpaired`, `no-content`, `staging`, `ready`, `active`, and `degraded`; these are design vocabulary, not committed enum/API names. A device can actively play A while staging B and reporting a failed download. Monitoring must represent these concurrent facts rather than presenting every synchronization error as a playback outage.

## Consistency and concurrency

- Repeated publication/download/acknowledgement requests need explicit retry/idempotency semantics. Concurrent publishers must detect stale drafts or conflicting target changes; a successful old sync must not silently overwrite a newer desired assignment.
- The manifest includes enough information to bind assets and rules to one generation and declare the supported interpretation. Content paths alone are not stable identity if file contents can change underneath them.
- The proposed target is the latest authorized compatible desired generation; whether to skip intermediate versions needs confirmation for scheduled content and audit requirements. Do not use device wall-clock order as publication identity.
- PostgreSQL commits and media filesystem writes are not one transaction. Stage/verify durable objects, then commit references/intent with a recoverable cleanup/reconciliation design. An in-memory after-commit callback alone is insufficient for required distribution.
- Initial synchronization needs backend access; offline-first is not offline initial pairing. With no installed valid programming, show a safe setup/no-content screen without private tenant details.
- Restoring a retained generation must still respect campaign validity and schedule fallback rules. A rollback cannot resurrect expired offers merely because their files exist.

## Time and scheduling

The schedule must carry the agreed business timezone and unambiguous interpretation. The backend preview and player must share contract fixtures for weekday recurrence, date boundaries, overnight intervals, daylight-saving gaps/overlaps, and device timezone override. Store/compare instants and preserve the timezone needed to interpret recurring local-time rules; do not infer a business timezone from the server host.

Keep retry elapsed-time calculations separate from business wall-clock scheduling. Detect unreasonable device clock changes and report uncertainty. A manifest's validity window, default program and tolerated clock uncertainty must determine safe offline output. The exact policy for expiry and prolonged disconnection is **pending**, not an unlimited license to display stale prices/promotions.

## Failure and recovery acceptance

| Condition | Required observable outcome |
| --- | --- |
| Server/network outage after synchronization | Last valid local program continues for the agreed offline envelope; schedule expiry/default behavior follows the approved rules |
| Interrupted download or expired download authorization | Retry safely/resume only when supported and verified; never activate a partial file; current playback continues |
| Corrupt/unsupported manifest or media | Reject staging with a bounded actionable reason; preserve active generation; avoid infinite hot retry loops |
| Insufficient disk/memory or unavailable media path | Refuse unsafe staging, report capacity failure; preserve active/recovery assets; no unbounded downloads or deletion of active content |
| Reboot, process crash, power loss during download/switch | Recover durable active/staging state; play a complete valid generation; reconcile orphan partial files without corrupting the active set |
| Duplicate requests/acknowledgements or rapid publications | Idempotent/reconcilable outcomes; no mixed generations, cross-tenant references, or rollback caused by stale acknowledgement |
| Schedule conflict, no match, expired promotion, clock drift | Approved deterministic validation/fallback/uncertainty policy; no unintended expired commercial content |
| Revoked or unlinked device | Server rejects new protected operations; local playback/erasure follows the explicit disconnected-revocation policy; never claim remote erasure while unreachable |
| Incompatible backend/player generation | Reject safely or use a supported compatible version according to the documented support matrix; no forced interpretation of an unknown schema |
| Player update failure or endpoint migration | Recover supported playback/local data and connection configuration; do not make an untested app rollback or credential leak the recovery path |

Record tests for each interruption boundary on representative hardware, not just happy-path mocks. Quantitative outage, retry, storage, startup and recovery targets are [PH-09](human-actions.md#ph-09); hardware and update constraints are [PH-08](human-actions.md#ph-08). No power-failure durability claim is made before evidence.
