# Teluni MVP Requirements and Acceptance

[Project documentation](README.md) · [Architecture](architecture.md) · [Playback and sync](playback-and-sync.md)

## Scope and acceptance rules

**Decided:** the MVP must complete the company-to-screen journey for images and videos, including offline Android TV playback and basic monitoring. All capabilities below are requirements, not implemented functionality. Functional requirements reflect the owner's brief; proposed policies and quantitative targets are identified separately. This document owns scope and observable acceptance; the [plan](implementation-plan.md) owns delivery status.

| ID | Functional requirement | Required acceptance evidence before pilot release |
| --- | --- | --- |
| FR-01 | Companies, branches, users, company settings, authentication, and basic permissions | Two synthetic companies each have a branch and users. Authorized members can manage their allowed resources. Direct API attempts, lists, search, media access, and identifier substitution cannot cross company/branch scope. Disabled/revoked access is rejected within the agreed freshness policy. |
| FR-02 | Device identity, temporary-code pairing, company/branch assignment, per-device name/configuration, safe unlink | A code displayed by an unpaired player is claimed by an authorized user once. Expired/replayed codes, concurrent claims, wrong-scope assignment, and revoked identities fail safely. Reassignment cannot expose the previous tenant's content or credentials. |
| FR-03 | Horizontal/vertical orientation where supported | An approved pilot device displays supported orientations correctly. Unsupported hardware/settings produce a clear capability response, not a silent claim of support. |
| FR-04 | Image/video upload, validation, identification, organization, metadata, reuse, reference-aware deletion | Approved file profiles upload and play on tested hardware; spoofed type, malformed/oversized content, and unauthorized reads are rejected. Reused media can appear in multiple playlists. A referenced or active-version asset cannot be physically removed unsafely. |
| FR-05 | Playlist editing, ordered items, duration, continuous repetition, device assignment, basic transitions where supported | Reordering is deterministic; configured image duration and video-duration policy are reflected in previews and playback. A loop continues across repeated items. An unsupported transition is handled by a declared baseline behavior. |
| FR-06 | Scheduling by start/end date, local time, weekday, and recurrence, with explicit conflict and no-match rules | Preview and player agree for ordinary windows, overlapping/empty windows, overnight windows, recurrence, expiry, and timezone transitions. Invalid/conflicting schedules cannot result in accidental mixed or undefined output. |
| FR-07 | Preview, explicit publication, immutable versions, device synchronization, last-valid-version preservation | Draft edits do not change active displays. Publishing requires authorization and validation of a complete version. Repeated/concurrent requests have defined results. Incomplete or corrupt staging never replaces the last valid active version. |
| FR-08 | Android TV player and continuous offline reproduction | A paired, fully synchronized approved device loops its local programming without streaming normal video from the backend, through the agreed outage duration, reboot, and recovery scenarios in [playback acceptance](playback-and-sync.md#failure-and-recovery-acceptance). |
| FR-09 | Online/offline indication, last communication, app version, free storage, sync state, relevant failures | Scoped panel views show observed timestamps and version states. Lost connectivity becomes stale/offline under a documented threshold; reconnection reconciles actual state. Authorization or download failure is distinguishable from current playback failure. |

Group-based playlist assignment is a desired extension of FR-05, but the brief also places device groups in enterprise evolution. **Proposed MVP boundary:** direct assignment to individual devices; no separate reusable group-management capability. This scope resolution remains [D-06](architecture.md#pending-decisions). Campaign management is similarly reserved for Phase 3; scheduled playlists provide the MVP promotion use case.

## Proposed behavior requiring confirmation

These are candidate policies for validation under [PH-09](human-actions.md#ph-09), not silently accepted business rules:

- One customer company is one tenant; branches belong to exactly one company. Multi-company access is explicit membership, not an implicit platform privilege.
- Company enrollment starts with an attributable platform-admin action and an initial company admin; public self-service signup/invitations and approval flows are pending identity design.
- Use a continuous default playlist for each assigned device and reject overlapping active schedule windows for that device in the MVP. When no window matches, play the declared default. When no valid program has ever been installed, display a safe local setup/no-content state. An expired promotion must not become an implicit fallback.
- A schedule's end is exclusive; overnight windows, recurrence, daylight-saving ambiguity, and long-offline clock uncertainty need an explicit interpretation before contracts are written.
- Manual image duration and video completion form the initial baseline; clipping, early interruption, and mixed-duration rules require hardware validation. Basic cuts are the candidate transition baseline.
- Physical deletion of media referenced by a draft or retained publication is rejected with reference information scoped to the caller. Marking/archive and eventual garbage collection must account for retained player versions; retention periods are pending.
- The unlink policy must distinguish stopping future access, locally clearing data when the device reconnects, and the inability to erase a disconnected device remotely. Decide the permitted offline playback interval after revocation under D-03.

## Nonfunctional requirements

| ID | Requirement and acceptance boundary | Unresolved measurement or design |
| --- | --- | --- |
| NF-01 | Server-side tenant/branch isolation and least privilege across all persisted and derived data; negative authorization tests | Physical isolation strategy and role matrix review: D-01/D-02 |
| NF-02 | Safe offline activation, integrity checking, interruption recovery, bounded retries, and restart recovery | Outage duration, free-space reserve, boot/playback targets and hardware matrix: D-03/D-07 |
| NF-03 | Measured API/panel responsiveness, upload/download throughput, bounded pagination/work, and fleet behavior | Pilot devices/branches, concurrency, maximum file/profile sizes and bandwidth budget: PH-08/PH-09 |
| NF-04 | Environment configuration, durable media outside containers, backup/restore rehearsal, and a host-migration path | RPO, RTO, backup location/retention and acceptable residential downtime: D-08/PH-10 |
| NF-05 | Structured, redacted diagnostics; attributable audit for security changes, publication, and device lifecycle | Heartbeat thresholds, alert routing and retention: D-09 |
| NF-06 | Localizable web/player interfaces, `pt-BR` and `en-US`, branch/device timezone semantics, localized numeric/date/currency presentation | Locale/timezone precedence and supported calendar behavior: D-10 |
| NF-07 | Simple core workflow for nontechnical users; keyboard and responsive panel operation with accessibility verification following existing web testing patterns | Pilot task success/time and supported admin browsers: PH-08/PH-09 |
| NF-08 | Backend/player contract compatibility, controlled updates, recovery, and no uncontrolled migration of installed players | Supported protocol/app overlap and rollback matrix: D-04/D-07 |
| NF-09 | Track storage, traffic, processing, hardware and support cost without mandatory paid dependencies | Measurable operating envelope and eventual commercial limits: PH-12 |

Numeric targets must be agreed and recorded before claiming pilot acceptance. A passing foundation gate does not test these future requirements.

## Release acceptance journey

1. Provision two isolated synthetic companies, branch-scoped operators, and a supported Android TV device. Verify allowed and denied actions at the API and media boundary.
2. Pair the device, upload approved images/videos, build a playlist and schedules, preview them, and explicitly publish version A. Confirm desired, downloaded, and active versions are distinguishable.
3. Exercise draft changes and publish B while playback continues. Cut network/power at staging and activation boundaries, restore operation, and verify a complete A or B is used, never a mixed generation.
4. Exercise the scheduling boundary and no-match/conflict rules offline, including timezone and clock failure cases.
5. Reconnect, reconcile status, revoke/unlink, and test re-enrollment according to the agreed offline revocation policy.
6. Rehearse a PostgreSQL-plus-media restore and endpoint migration in an isolated environment. Have a nontechnical pilot operator complete the core workflow and record costs and failures.

Evidence must include automated contract/security/integration/browser tests, real hardware/power/network tests, restore results, and pilot observation. Work may be implemented incrementally; a usable pilot requires the complete applicable acceptance set.

## Explicitly outside the MVP

Advanced structured layouts/editor, product catalog and dynamic prices, managed campaigns/priorities, public partner integration APIs/webhooks/imports, automated payments, subscriptions/entitlements, white-label, AI, playback reports, broad remote-support controls, synchronized screens, alternative players, and advanced enterprise fleet tools are **future**. See [Phase 3 and Phase 4](implementation-plan.md#phase-sequence-and-exit-criteria). This excludes none of the security, audit, failure diagnostics, or controlled-version activation necessary for the MVP itself.
