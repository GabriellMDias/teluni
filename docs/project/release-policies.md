# Teluni Release Policies

[Requirements](mvp.md) · [Acceptance targets](release-targets.md) · [Playback and synchronization](playback-and-sync.md) · [PH-09](human-actions.md#ph-09)

## Decision status and ownership

**Decided on 2026-10-18:** these product policies consolidate the owner's questionnaire and the remaining choices explicitly delegated to engineering. They extend the earlier company-to-screen requirements to freeform composition and configurable catalogs. Product capability and quality take priority over reducing scope solely for an MVP label. None of these decisions proves implementation, hardware capacity or release readiness.

This document owns observable business behavior. [Acceptance targets](release-targets.md) own numeric limits and qualification goals; [playback/sync](playback-and-sync.md) owns the proposed delivery lifecycle; [architecture](architecture.md#pending-decisions) and ADRs own remaining technical choices. PH-08/PH-10/PH-11/PH-13 and PJ-07 retain their separate hardware, operations, identity, privacy and architecture reviews.

## Assignment and publication

- Support individual-device assignment and persistent company-owned groups. A device belongs to zero or one programming group; a group may span authorized branches of the same company. Check all target references and permissions on the server.
- A grouped device follows its group unless an authorized user explicitly selects individual programming. That choice replaces the complete group programming, retains membership and is visibly identified in the panel. Returning to the group is explicit; a membership edit does not silently remove the exception.
- Confirming an assignment/source change requests the destination's latest published programming without another publish action. An intentionally unpublished destination is permitted after a clear pre-confirmation indication: after applying the authorized change, the player shows local neutral output until its first valid publication. A failed or unseen synchronization instead preserves valid state.
- Ordinary layout, schema, record, playlist and schedule edits are drafts until deliberately published. An exception applies to an authorized **price save**: it automatically records publication intent for affected published bindings and produces a new validated version. A price save never mutates a snapshot in place or publishes unrelated drafts. This exception concerns designated monetary price semantics, not every numeric/custom field.
- [PH-11 identity/access policies](identity-and-access.md#publication-impact-and-delayed-work) require whole-mutation rejection when any affected target is unauthorized, without partial distribution or automatic approval fallback. Optional company approval rules distinguish a proposal from the effective price save: only an authorized independent approval commits the effective price and initiates automatic publication. No proposal is reported as an already-applied price.
- Distinguish saved, queued, failed, published, downloaded and active states. If automatic price publication fails, show the pending/failure state and retry/reconcile durably; do not report that disconnected TVs have changed. Duplicate saves/retries and concurrent edits must not replay an obsolete price over a newer one. Invalid input is rejected before accepting a price change.
- A publication contains consistent layout/schema/record/price/media versions. Activation requires its complete supported resource set; failure preserves the last valid generation. Rollback still applies current authorization and content-validity rules and cannot resurrect an expired promotion.

## Configurable catalogs

Catalogs are tenant-owned, user-configurable collections with typed field definitions and records. They are not restricted to product tables or a fixed mandatory set of product fields. Users can add fields and define required/optional values; products, menus and public weekly agendas are examples of reusable configurations. A weekly-agenda record describes displayed data and does not implicitly become a player publication schedule.

Provide reviewed field types for text, numbers, booleans, dates/times, selections, monetary values, authorized media and scoped record references as appropriate. Exact type schemas and storage remain technical design work. Validate field definitions, values, references, sizes and nesting. Customization does not permit arbitrary code, SQL, executable markup or unrestricted external data access, and does not imply unbounded resources.

Stable field identity and schema versions must preserve bindings. Renaming a label must not silently change meaning. A destructive schema/type change needs explicit migration/reference handling; published versions remain bound to their original validated schema and values. Importing/copying layouts or catalog definitions does not grant access to another company's media or records.

Product configurations can use description/image/category/availability, normal/promotional monetary values and variation/combo references without imposing those fields on an agenda or another catalog. This defines extensible data and presentation, not an ERP/POS transaction engine. Ordinary catalog edits retain draft/publication separation; designated price updates use the automatic publication exception above.

**Delegated commercial defaults:** a company-level base price may be overridden by branch. Every monetary value has explicit currency and exact representation; do not convert currencies automatically. Preview the effective branch value. A promotional price applies only within its published validity, then falls back to the normal price. Reject competing promotion periods for the same product/branch. Hide unavailable products by default; a component may explicitly show an unavailable indication instead. All of these rules must be evaluable from a valid offline publication.

Catalog views bind selected fields into a list/table/menu/agenda rather than relying only on flattened artwork. Support automatic pagination with configurable timing, grouping by an available chosen field and an explicit minimum readable text size, plus manual pagination. Never silently clip names/prices or shrink text indefinitely; an unresolvable overflow needs visible validation. Generic catalogs need no mandatory category or price field.

## Composition and regional playback

- Provide a freeform editor to create, position and resize simultaneous areas. A group is a programming source, not a limit on area count. Validate geometry, orientation, references and the supported rendering profile; do not silently drop a function to fit a device.
- Layouts have a structured, versioned textual representation with validated copy/import/export, revision history and preview. Serialization, editor/renderer libraries and wire schemas remain subject to technical review; AI is not required.
- Areas advance independently by default, with optional coordinated areas/pages. This owner-approved hybrid mode replaces compulsory whole-screen progression while retaining that capability when selected. Coordination within one TV does not approve synchronization across separate TVs.
- Each area may have its own schedules and optional default. Its active schedule selects the area's content and is not overwritten by a global page transition. After the exception ends, return to the current page's applicable content, then its configured default, otherwise a neutral area; do not restart unrelated independent areas. Preview must expose these regional exceptions to page coordination. Coordinated page changes use one transition point for the participating page-controlled areas; a regional exception temporarily keeps its own eligible output.
- When no schedule or default applies, keep that area's geometry and neutral background without automatically redistributing the layout. A complete programming source with no eligible output uses safe local no-programming output. Never borrow a group default while an individual override is selected.
- Coordinated pages have explicit duration, with an automatic suggestion covering the longest video. Reject ordinary page durations that would cut a full video. Shorter videos finish and hold their last frame until the page changes; static content remains visible. Independent areas retain their per-item durations. Scheduled boundaries override ordinary completion and may interrupt any current item/page.
- Support several concurrent videos subject to a measured device profile. Ordinary video playback uses its complete original duration; per-item trimming is not part of the selected baseline. Independent image items use the default/configurable bounds in the target specification.
- Support individual audio mute/volume controls and multiple audible areas. **Delegated safe default:** newly created areas start muted and mixed audio requires deliberate configuration; do not impose a universal one-audio-area limit. Qualification must test the supported mix, output controls and recovery.
- During an already-active presentation, isolate a rendering failure to its area: attempt bounded recovery, then show still-valid regional contingency content or neutral output, preserve unaffected areas and report the failure. Keep a coordinated group's logical page timeline; a failed area may rejoin at the current valid state instead of forcing every area to restart. Whole-generation staging/integrity failures remain distinct and preserve the previous valid generation.
- Offer direct cuts and configurable fades with preview only on validated profiles. A fade never extends expired commercial content; when necessary at an expiry boundary use an immediate cut. Advanced effects remain separate scope.

## Time and scheduling

Use per-device local business time: explicit device timezone, otherwise the deliberately selected branch timezone. Never inherit the server host timezone. Cross-branch groups therefore interpret local recurring hours per target. Locale changes do not change timing.

Start instants are inclusive and end instants exclusive. Reject overlapping schedules competing for the same output/area; intentional concurrent content in different areas is permitted. Do not resolve conflicts by implicit priority, last edit or creation order. Backend preview and player must share fixtures.

Permit overnight windows anchored to the starting weekday: Friday 22:00–02:00 ends Saturday at 02:00. Date-only final validity includes that complete local day and ends at the next local midnight, clipping any overnight window at that limit. If Friday is the last valid day, its 22:00–02:00 window therefore ends at Saturday 00:00. Reject equal start/end times as ambiguous and provide a separate explicit all-day option.

Follow geographic timezone rules. For nonexistent local boundaries use the first valid instant; for ambiguous boundaries use the earlier occurrence for a start and the later occurrence for an end. Show the resolved result in preview, validate conflicts after resolving it and do not duplicate publication/execution solely because clocks repeat. Exact library/fixture implementation remains technical work.

When eligible scheduled output changes, interrupt the current item instead of waiting for completion. Apply this to the affected regional output or page-controlled coordinated participants; an unrelated independent area continues. Timing tolerances and trusted-clock bounds are defined in the acceptance targets, not claimed measurements.

## Media and deletion lifecycle

The acceptance targets define configurable ingestion bounds separately from supported playback profiles and commercial quotas. Validate declared and inspected file type, size, decoded dimensions, duration, compatibility and scoped references; exact allowed codecs/containers require D-05 review.

Preserve originals and create compatible renditions when validated processing is supported. Show preparation/progress/preview and keep publications unavailable until their required renditions are durable. If safe conversion is unavailable, reject with an actionable reason. Do not silently remove areas or distort content to compensate for an unsupported device. Processing isolation/tools/capacity remain technical and host-readiness work.

Archiving removes media from new selections but does not break existing references. Block physical deletion while referenced by drafts, active/staged/recovery generations or protected retained publications; disclose only references the caller may see. Assisted removal of draft references needs confirmation and never rewrites issued snapshots. Retention expiration alone is insufficient for garbage collection: reference protection, device reconciliation and the offline envelope must also permit removal.

Keep active and previous valid player generations plus valid staging resources. Preflight new resources and the reserved-space target; insufficient capacity preserves valid playback and reports required capacity rather than deleting protected resources. Deduplicate shared immutable assets when accounting for generations. Catalog schema/record/media references need the same reference-aware lifecycle; legal/privacy retention remains PH-13.

## Offline authorization and clock trust

[Commercial policies](commercial-policies.md#payment-expiry-cancellation-and-retention) additionally bound future playback authorization by known trial/paid/grace deadlines; the shorter commercial or seven-day offline bound wins. This does not change already-issued unreachable leases retroactively, relax identity/security controls or select a credential mechanism. Commercial restriction, security suspension and confirmed erasure remain distinct.

The target specification fixes the maximum offline authorization interval and clock-uncertainty bound. After authorization expires, show neutral output and request reconnection. Revocation denies new protected server operations; an unreachable device may retain playback until its local authorization expires. Do not claim remote erasure while unreachable or extend authorization by restoring an older generation.

Detectable incompatible clock jumps or insufficient trusted time suspend time-dependent schedules/prices and produce neutral output with diagnostics. Do not guess promotional validity or claim all wrong clocks can be detected without a reference. Elapsed-time retries and business wall-clock time are separate. Reboot/offline trusted-time estimation and credential mechanisms require threat-model/technical review using established security components.

Unlink requires explicit authorized confirmation, server revocation and a distinct pending-clear state for offline devices. On reconnection clear private local content/configuration/credentials. Reassignment to another company requires verified cleanup or controlled reset before new pairing. Distinguish revoked access, unreachable device and confirmed erasure; failure/retry must never expose the previous tenant's data.

## Compatibility and updates

The target specification defines the protocol-generation support window. Reject unknown/incompatible interpretations clearly, preserve valid permitted playback and report actual versus desired versions. Updates require controlled distribution, a configurable window, qualified installation/recovery and verified rollback behavior. Never assume an untested app/data downgrade is safe. Urgent security exceptions must be explicitly reviewed and communicated; no store, installer or update library is selected here.

## PH-09 decision record

Evidence: owner questionnaire supplied on **2026-10-18**, with explicit authorization to decide delegated or unanswered items. Detailed responses are authoritative; the optional summary table still containing `PENDENTE` is not a conflicting answer. The external Portuguese working attachment is not a canonical repository document.

| Questionnaire | Decision authority       | Canonical outcome                                                                                     |
| ------------- | ------------------------ | ----------------------------------------------------------------------------------------------------- |
| P01           | Owner                    | Hybrid independent/optional coordinated areas                                                         |
| P02           | Owner                    | Price saves automatically publish validated versions of affected published content                    |
| P03           | Owner                    | Multiple audible areas with individual volume/mute                                                    |
| P04           | Owner                    | Isolated recovery/contingency for an active area's failure                                            |
| P05           | Owner custom response    | User-defined typed catalogs/fields/records, including weekly agendas; no product-only schema          |
| P06           | Delegated to engineering | Company base monetary price with explicit branch overrides/currency                                   |
| P07           | Delegated to engineering | Promotion validity, normal-price recovery, conflict rejection and hidden unavailable items by default |
| P08           | Owner                    | Versioned textual layouts, validated copy/import/export and preview                                   |
| P09           | Owner                    | Optional per-area default, otherwise neutral without layout redistribution                            |
| P10           | Owner                    | Regional schedules govern their area over page changes; return without unrelated restarts             |
| P11           | Owner                    | Explicit coordinated-page duration, full-video validation and shorter-video last-frame hold           |
| P12           | Owner                    | Inclusive final date clipped at next local midnight                                                   |
| P13           | Owner                    | Reject equal times; explicit all-day option                                                           |
| P14           | Owner                    | Deterministic geographic-timezone gap/ambiguity policy and matching preview/player fixtures           |
| P15           | Owner                    | Cuts/fades on qualified profiles; no extension of expired content                                     |
| P16           | Delegated to engineering | AT-01–AT-03 configurable image/video ingestion and duration bounds                                    |
| P17           | Owner                    | Preserve originals, validated compatible renditions or explicit rejection                             |
| P18           | Owner                    | AT-04 composition/video qualification target                                                          |
| P19           | Owner                    | AT-05 protected generations and reserved capacity                                                     |
| P20           | Delegated to engineering | AT-06–AT-10 startup, recovery, power and offline qualification goals                                  |
| P21           | Delegated to engineering | AT-11–AT-14 detection, activation, schedule and panel timing                                          |
| P22           | Owner                    | AT-15 bounded offline authorization                                                                   |
| P23           | Owner                    | AT-16 clock-confidence bound and safe uncertainty output                                              |
| P24           | Owner                    | Explicit unlink, pending erasure and verified cleanup before tenant reassignment                      |
| P25           | Owner                    | Archive and protected-reference-aware deletion/assisted draft removal                                 |
| P26           | Delegated to engineering | AT-17–AT-20 operational retention with protected-reference exceptions                                 |
| P27           | Delegated to engineering | AT-21–AT-23 reference load and API/panel performance goals                                            |
| P28           | Delegated to engineering | AT-24 heartbeat/freshness thresholds and distinct playback/connectivity states                        |
| P29           | Delegated to engineering | AT-25 usability/accessibility qualification                                                           |
| P30           | Delegated to engineering | AT-26 protocol support and controlled update/recovery direction                                       |
| P31           | Owner                    | Automatic/manual catalog pagination with readable-size/overflow validation                            |

PH-09 completes policy/target selection only. Technical schemas, rendering/storage/processing/security mechanisms and their ADR review remain PJ-07/D-01–D-11; qualification evidence remains PH-08/PJ-12/PJ-14 and infrastructure evidence PH-10/PJ-13. No completion is inferred for those tasks.
