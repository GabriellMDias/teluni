# Teluni Programming Design

[Release policies](release-policies.md#time-and-scheduling) · [Assignment and publication](release-policies.md#assignment-and-publication) · [Acceptance targets](release-targets.md) · [Playback and synchronization](playback-and-sync.md#time-and-regional-scheduling) · [Identity and access policies](identity-and-access.md#permission-model-and-default-matrix) · [Tenant data design](tenant-data-design.md) · [Media library design](media-library-design.md) · [Device enrollment design](device-enrollment-design.md) · [ADR-0029](../adr/0029-propose-temporal-based-schedule-evaluation-with-shared-fixtures.md) · [PH-24](human-actions.md#ph-24)

## Status and scope

**Approved detailed design for D-06 and the time-zone part of D-10, 2026-10-19.** The owner approved all eleven [decisions for review](#decisions-for-review) as proposed under [PH-24](human-actions.md#ph-24), including ADR-0029, after asking for development to continue autonomously. Approval authorizes implementation of PJ-10 in local and CI environments; the player's use of the fixtures remains PJ-12.

In scope: playlists and their items, persistent programming groups, the programming source of each screen (group or individual), schedule rules with dates, weekdays, local hours, overnight windows and all-day windows, optional defaults, conflict validation, the time-zone and DST rules, the evaluator that turns a programming source into a timeline for one screen, the shared fixtures, the preview, permissions, limits, reference guards, audit, data, contracts, panel and verification (FR-05, FR-06).

Out of scope, with their owners: publication, the immutable snapshot that carries the rules to screens and the confirmation that applies an assignment on a screen (D-04, PJ-11); playback, trusted time and fixture execution on the device (D-07, PJ-12); layouts with several areas, coordinated pages and their regional schedules (D-11, PJ-20), which reuse the rule model and evaluator defined here per area; catalog data and price validity (PJ-21); qualification of fades or any other transition on hardware (PH-08). The design claims none of them.

## Policy inputs

The design applies these selected policies without changing them, except for the one refinement named in decision 5:

- A screen belongs to zero or one company-owned programming group, which may span authorized branches. A grouped screen follows its group unless an authorized person explicitly selects individual programming, which replaces the whole group programming and keeps the membership; returning to the group is explicit ([assignment](release-policies.md#assignment-and-publication)).
- Every edit is a draft until deliberately published; confirming an assignment or source change requests the destination's latest published programming, and an intentionally unpublished destination needs a clear indication before confirmation.
- Use per-device local business time: the device's explicit time zone, otherwise its branch's. Never inherit the server's time zone. Starts are inclusive and ends exclusive; overlapping schedules for the same output are rejected without implicit priority; overnight windows are anchored to their starting weekday; a final date includes that whole local day and clips at the next local midnight; equal start and end times are rejected in favor of an explicit all-day option ([time and scheduling](release-policies.md#time-and-scheduling)).
- In a DST gap, use the first valid instant; in a repeated hour, the earlier occurrence for a start and the later for an end; show the resolved result in preview and validate conflicts after resolving it. Backend preview and the player share fixtures.
- Image items last 1 to 3,600 seconds, 10 by default (AT-01); videos play their whole duration; a schedule boundary interrupts the current item (AT-13 for timing on the device). An output with no applicable schedule uses its optional default, otherwise neutral output; a group default is never borrowed while individual programming is selected.
- Authoring playlists and schedules is allowed to administrators company-wide, branch managers in their branches and operators in their branches as drafts; publishing to managers and administrators ([permission matrix](identity-and-access.md#permission-model-and-default-matrix)).

## Concepts

- A **playlist** is an ordered, looping list of media items owned by a company or one branch, like media. It is reusable: several programs may schedule the same playlist.
- A **programming group** belongs to a company and names the branches it may span: either the whole company or a fixed set of one or more branches.
- A **program** is the draft programming of one source: a group, or one screen. It has one output today, the full screen (`screen`); PJ-20 adds layout areas as further outputs with their own rules and defaults, evaluated by the same functions. Each output has a set of **schedule rules** and an optional **default playlist**.
- A screen's **programming source** is its group's program when it belongs to a group and individual programming is not selected; otherwise its own program. A screen without a group is always programmed individually.

## Playlists

A playlist has a name (1 to 120 characters), an owning scope (company or one branch), a transition and 0 to 500 items.

Each item references one media asset that is `READY`, not archived, and visible to the playlist's scope: a company playlist may use company media only; a branch playlist may use company media and that branch's media. An image item has a duration from 1 to 3,600 whole seconds, 10 by default; a video item has no duration and plays its whole display rendition. Items play in order and the playlist loops while its schedule window lasts; a boundary interrupts the current item. The same asset may appear more than once.

The transition is `CUT` (default) or `FADE` with a duration from 250 to 2,000 ms. A fade is stored and previewed, but publication (PJ-11) accepts it only for screens whose profile is qualified for fades and otherwise rejects it with an actionable reason instead of dropping it; at a schedule boundary that ends commercial content the player cuts.

Saving items replaces the whole ordered list with an expected version, so reordering is one atomic change. An archived asset already in a playlist stays and keeps playing; it cannot be added again. The panel shows the playlist's total duration and its video count.

## Programming groups and sources

A group has a name (1 to 80 characters, unique within the company, ignoring case) and its branch span. Only screens of branches in that span may join. Narrowing the span is refused while member screens of the removed branches remain, and changing it is refused when the group's rules would use a branch playlist outside the new span. Deleting a group is refused while it has members.

Joining or leaving a group and selecting or clearing individual programming are **assignments**. An assignment never edits a program. Its request carries the screen's current settings version and, while the destination has no published programming, `confirmUnpublished: true`, which the panel asks for with a sentence explaining that the screen will show neutral output until the destination is published. Until PJ-11 exists no destination is published, so every assignment needs that confirmation; PJ-11 replaces the check with the real publication fact and requests the destination's latest publication.

A screen that leaves its group keeps its own program, which is empty unless it was edited before. Selecting individual programming never copies the group's rules: the screen's own program is used as it is, so the person sees and edits it explicitly.

## Schedule rules

A rule assigns one playlist to one output of a program for a recurring local window:

| Field                  | Meaning                                                                                                                                                                                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `playlistId`           | A playlist the program may use (see permissions)                                                                                                                                                                                                      |
| `weekdays`             | One to seven ISO weekdays (Monday 1 to Sunday 7) on which a window starts                                                                                                                                                                             |
| `allDay`               | When true, each window covers the whole local day; `startTime` and `endTime` are absent                                                                                                                                                               |
| `startTime`, `endTime` | Local wall-clock times `HH:MM` with minute precision. `endTime` earlier than `startTime` makes an overnight window that ends on the next local day; equal times are rejected (`SCHEDULE_TIMES_EQUAL`); `endTime` `00:00` means the following midnight |
| `startsOn`             | The first local date on which a window may start                                                                                                                                                                                                      |
| `endsOn`               | Optional final local date, inclusive; every window clips at the local midnight that ends it                                                                                                                                                           |

Rules store local values only. The time zone is applied per screen when evaluating, so one group program means the same local hours in every branch of a cross-branch group. A window anchored on Friday 22:00–02:00 ends Saturday 02:00; when Friday is the final date it ends Saturday 00:00. A window cannot start before `startsOn`; an overnight window anchored on the day before `startsOn` does not exist.

A program has at most 200 rules per output. Rules are saved as the whole set of an output with an expected program version, so validation sees the complete result and concurrent editors get `RESOURCE_VERSION_CONFLICT`.

## Conflict validation

Two rules of the same output conflict when any of their windows overlap. Validation compares windows in local wall-clock time, independently of any time zone, so it holds for every screen of a cross-branch group and never depends on the server's time zone:

1. Each window becomes an interval of local minutes from its anchored start to its end, including the overnight day and the final-date clip.
2. For a pair of rules, only dates in the intersection of their validity extended by one day on each side can overlap. When that span is 21 days or shorter every date is checked; otherwise the first 10 and last 10 days are, which contain every weekday combination of the repeating middle; an open-ended span checks its first 10 days.
3. Touching windows (one ends at 18:00, the next starts at 18:00) do not overlap. An overlap rejects the whole set with `SCHEDULE_CONFLICT`. Because the error envelope carries no details, a read-only check operation takes a rule set and returns each conflicting pair with its first overlapping local date, so the panel can point at both rules before saving.

Wall-clock validation is stricter than validating each zone's resolved instants, except inside a repeated hour, which decision 5 handles.

## Time zones and DST

A screen's zone is its explicit time zone when set, otherwise its branch's zone. Both are IANA names validated against the runtime's zone database, with the same rule that branches use. The explicit device time zone is a device setting edited with `devices.manage` and returned by `GET /device/self`; changing a branch's zone changes the evaluation of every screen that does not override it. The server's own zone is never read: evaluation uses explicit zone names only.

Resolving a local date and time in a zone:

- **Unique**: the only instant.
- **Gap** (the time does not exist): the first valid instant, which is the transition instant. In `America/New_York` on 2027-03-14, 02:30 resolves to 03:00 EDT.
- **Repeated hour**: the earlier occurrence for a start, the later for an end.
- **Handoff refinement (decision 5)**: on an output, a window's end never extends past the start of the next window. Without it, a window ending at 01:15 (later occurrence) would overlap one starting at 01:45 (earlier occurrence) during a repeated 01:00–02:00, although the rules pass wall-clock validation. The evaluator therefore clips such an end to the following start, so adjacent and close windows never overlap and no window is played twice because the clock repeats.

All-day windows run from the local midnight that starts the day to the one that ends it, each resolved as above. The resolved instants of a window, and any resolution other than unique, are part of the preview, so a person can see that 02:30 became 03:00.

## Evaluation and the timeline

The evaluator is a pure function of a program's output (rules and default), a zone and an instant range. It returns ordered, non-overlapping **segments** that cover the range: each has a start instant, an end instant, the local start and end with their offsets, and what plays: a rule with its playlist, the default playlist, or nothing (neutral output). It also lists each resolution note (gap or repeated hour) that affected a boundary.

1. Collect every window whose anchor date lies between one day before and one day after the range's local dates, within `startsOn`/`endsOn`.
2. Resolve each start and end as above, apply the final-date clip, sort by start and apply the handoff clip.
3. Fill the space between windows with the default playlist when the output has one, otherwise with neutral output.

The evaluator never reads a clock; "now" is an input. The same function serves validation, preview and, through the fixtures, the player's own implementation.

## Shared fixtures

The canonical fixtures are a JSON file owned by the API's programming module. Each case has an identifier, a description, a zone, the output's rules and default, a range, and the expected segments with instants in UTC and their local representation. The API's tests run every case through the evaluator, and validation-only cases list the expected rejection codes. The player (PJ-12) runs the same file against its implementation; how it obtains the file is part of PJ-12's build. Cases cover at least: inclusive start and exclusive end; overnight windows and their anchoring; a final date clipping an overnight window; all-day windows; equal times rejected; touching and overlapping windows; a cross-branch group evaluated in two zones; a DST gap at a start and at an end; a repeated hour at a start, at an end and between two close windows (the handoff); a zone without DST (`America/Sao_Paulo` after 2019); empty windows with and without a default; and a range starting inside an overnight window.

## Preview

`GET /companies/{companyId}/programming/devices/{deviceId}/timeline?from=&to=` evaluates the screen's current draft source in its zone. `GET /companies/{companyId}/programming/groups/{groupId}/timeline?timeZone=&from=&to=` evaluates a group program for a zone the caller chooses (the panel offers its branches' and members' zones), so a group can be previewed before it has screens. A range covers at most 31 days and returns at most 2,000 segments; the panel shows the next seven days by default, in local time, with the resolution notes. The response names the source (group or individual) and, for each segment, the playlist's name, total duration and item count as the caller may see them.

## Lifecycle and references

- Media: the programming module registers a media reference guard. An asset used by a playlist item cannot be deleted; the refusal names the playlists the caller may see and counts the others. Archived assets remain in playlists.
- Playlists: a playlist used by a rule or a default cannot be deleted (`PLAYLIST_IN_USE`); otherwise deletion removes it and its items after a confirmation naming it. A playlist cannot change its owning scope.
- Groups: deletable when they have no members; their program is deleted with them.
- Devices: an unlinked screen's settings and individual program are kept with the device record for audit and are no longer evaluated or editable. A screen moved to another branch outside its group's span leaves the group in the same transaction as the move, which the devices module calls through a hook the programming module registers; the screen's programming then shows its own program.
- Branches: archiving a branch is refused while a group's span names it explicitly. Branch playlists of an archived branch stay, like its media.
- Moved screens: rules of a moved screen's own program that use the previous branch's playlists stay as drafts; saving that output again, or publishing it (PJ-11), is refused until they are replaced.

Publication (PJ-11) adds protection for references from published, staged and retained generations.

## Permissions

| Capability                                                                                          | Company administrator | Branch manager | Operator | Delegable |
| --------------------------------------------------------------------------------------------------- | --------------------- | -------------- | -------- | --------- |
| `programming.view`: see playlists, groups, programs, assignments and timelines                      | Company               | Branches       | Branches | Yes       |
| `programming.edit`: create, edit and delete playlists, groups (name and span) and programs (drafts) | Company               | Branches       | Branches | Yes       |
| `programming.assign`: change group membership and individual programming                            | Company               | Branches       | No       | Yes       |

Scope rules:

- A playlist is visible and editable under the capability on its owning scope; a company playlist is visible to anyone with `programming.view` anywhere in the company and editable with company-wide `programming.edit`.
- A group, its program and its branch span need the capability on every branch of the span; a whole-company group needs company scope. A group that a person can see only partly does not exist for them (`RESOURCE_NOT_FOUND`).
- A screen's own program and settings need the capability on the screen's branch. Joining a group needs `programming.assign` on the screen's branch and on every branch of the group's span.
- A screen's views never reveal what the caller cannot see. A screen in a group the caller sees only partly reports a group source with no group, and its timeline still shows what the screen plays; leaving that group needs only `programming.assign` on the screen's branch. A playlist outside the caller's scope, such as one of a moved screen's previous branch, keeps its ID without a summary.
- A rule or default may use a playlist only when every branch the program can reach is inside the playlist's scope: company playlists always, a branch playlist only for that branch's screens or for a group whose span is exactly that branch.
- The capabilities follow the existing assurance rule for standard roles; profiles set it per capability.

## Abuse limits

Per company: 1,000 playlists, 100 groups, 2,000 programs. Per playlist 500 items; per output 200 rules. A timeline request covers at most 31 days and 2,000 segments. Exceeding a count limit returns `PROGRAMMING_LIMIT_REACHED`, whose message names the limits; a transaction-scoped lock per company serializes each count with its insert, so concurrent creations cannot pass a limit; list and rule-set sizes beyond their maximum fail request validation.

## Audit

Every creation, edit, deletion and assignment writes a programming audit event with the actor's membership, the subject (playlist, group, program or screen), the branches it concerns and a bounded summary (names, counts and versions, never media content), in the same transaction as the change. Viewing follows the organization audit rules: administrators see all, managers see events of their branches.

## Data

| Table                         | Purpose                                                                                                                                                   |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `playlists`                   | Company, optional owning branch, name, transition, fade duration, version, creator and timestamps                                                         |
| `playlist_items`              | Composite key (company, playlist, position); media asset reference with a composite tenant foreign key; image duration in milliseconds or empty for video |
| `programming_groups`          | Company, name with a case-insensitive unique index, `all_branches`, version                                                                               |
| `programming_group_branches`  | Explicit branch span rows for groups that do not cover the whole company                                                                                  |
| `programs`                    | Company, exactly one of group or device (each unique), version                                                                                            |
| `program_outputs`             | Program and output key (`screen` now), optional default playlist                                                                                          |
| `schedule_rules`              | Program, output key, playlist, weekday bitmask, all-day flag, start and end minute of day, `starts_on`, optional `ends_on`, position for display          |
| `programming_device_settings` | Device (composite key), optional group, `individual` flag, version                                                                                        |
| `programming_audit_events`    | Append-only audit rows with the branches they concern                                                                                                     |

Every table carries `company_id` and composite tenant references as the [tenant data design](tenant-data-design.md) requires. The explicit time zone is a nullable `time_zone` column on `devices`, owned by the devices module. Checks enforce weekday masks from 1 to 127, minutes from 0 to 1,439, time pairs only when not all-day, `ends_on` not before `starts_on`, image durations from 1,000 to 3,600,000 ms and fade durations from 250 to 2,000 ms.

## Contracts

Versioned JSON operations under `/companies/{companyId}/programming/...` for playlists (list with scope and name filters and cursors, create, get, rename, replace items, change transition, delete), groups (list, create, get, rename, change span, delete), group and device programs (get, replace one output's rules and default), device settings (get, assign), the rule check and the two timelines; plus the time-zone field on device detail and update. Errors use the existing envelope with the codes named in this design. The SDK and OpenAPI document are regenerated.

## Panel

A **Programação** area per company (en-US "Programming"), shown with `programming.view`:

- **Playlists**: list with scope and search; the editor adds ready media from the library through a picker filtered by the playlist's scope, reorders items with buttons and keyboard, edits image durations, shows total duration and saves the whole list.
- **Grupos**: list, creation with the branch span, member screens with join and leave, and the group's schedules.
- **Screen programming** on each Telas detail page: source (group or individual) with the unpublished-destination confirmation, time zone (explicit or branch), schedules of the effective source and the preview.
- **Schedules editor**: one row per rule (playlist, weekdays, all-day or times, dates), the default playlist, conflict errors next to both rules, and a seven-day local timeline with resolution notes.

Copy is in `pt-BR` and `en-US`, times use the person's locale with the screen's zone named, and every control is reachable by keyboard.

## Verification

- Domain unit tests: rule validation for each field, the wall-clock conflict check (touching, overlapping, overnight, final-date clip, long and open-ended spans), zone resolution for gaps and repeated hours, the handoff clip, segment filling with and without defaults and range limits.
- The shared fixture suite run through the evaluator.
- Integration tests against PostgreSQL with two companies and differently scoped members: playlist scope and media visibility, group span and partial visibility, assignment confirmation and versions, permission denials for each capability and role, reference guards on media, playlists, groups and branches, limits, ID substitution across companies, and audit rows.
- Browser component tests for the playlist editor, the schedules editor with conflicts and the assignment confirmation, and one end-to-end journey: upload media, build a playlist, create a group, add a paired screen, schedule it and read its timeline.

## Delivery increments

1. API module, schema and migration, playlists and items, groups, settings and assignments, programs and rules with validation, the evaluator and fixtures, timelines, guards, device time zone, audit, contracts and SDK.
2. Panel pages for playlists, groups, screen programming, schedules and the timeline, with browser and end-to-end tests.
3. Hardening with PJ-11 (published destinations and published references) and PJ-20 (layout areas as outputs).

## Implementation status

Implemented in [PJ-10](implementation-plan.md#current-work) on 2026-10-19, increment 1, on the recommended options, which the owner then approved under [PH-24](human-actions.md#ph-24):

- The [`programming` API module](../../apps/api/src/features/programming/AGENTS.md), its reviewed migration (which also adds the devices' `time_zone` column and lets profiles delegate the programming capabilities), runtime grants, schema metadata and the operations in the [OpenAPI document](../generated/api/openapi.json) and SDK.
- `programming.view`, `programming.edit` and `programming.assign` in the standard roles and as delegable profile capabilities; `programming.assign` requires strong authentication.
- The pure evaluator and conflict validation in [`schedule.ts`](../../apps/api/src/features/programming/schedule.ts) on `temporal-polyfill`, with the [canonical fixtures](../../apps/api/test/programming/schedule-fixtures.json) run by [the evaluator tests](../../apps/api/test/programming/schedule.test.ts).
- The media reference guard, the branch archive guard for explicit spans and the devices move hook; the explicit device time zone in device detail, update and `GET /device/self`.
- The [two-company integration suite](../../apps/api/test/programming/integration.test.ts) against PostgreSQL as the runtime role with the organizations, devices and media modules.

Increment 2, the same day:

- The panel's [Programação pages](../../apps/web/src/programming/pages.tsx): playlists with the media picker, item order and image seconds, transitions, groups and spans, schedule editing with API rule checks and per-schedule conflicts, seven-day previews, screen assignment with the unpublished confirmation and step-up, and confirmed deletion; the screen page's time zone setting and programming link.
- [Browser component tests](../../apps/web/test/programming.browser.test.tsx) and the [programming journey](../../apps/web/test/e2e/programming/journey.spec.ts).

Pending: increment 3 with PJ-11 and PJ-20.

## Decisions for review

1. **Program model.** Reusable playlists owned like media (company or one branch); one program per group and per screen; a screen without a group, or with individual programming selected, uses its own program; one full-screen output now, with layout areas as further outputs in PJ-20.
2. **Group span.** A group covers the whole company or a fixed set of branches; only screens of those branches join; authority over a group requires authority over every branch of its span.
3. **Rule representation.** ISO weekdays, local start and end at minute precision, an explicit all-day flag, a first date and an optional inclusive final date; no zone stored on rules; the zone comes from the screen, otherwise its branch.
4. **Conflict validation.** Reject overlapping windows on the same output by comparing them in local wall-clock time, independent of zones, over the complete rule set saved atomically; touching windows are allowed.
5. **DST handoff refinement.** Gaps resolve to the first valid instant and repeated hours to the earlier occurrence for starts and the later for ends, as selected; additionally, an end never extends past the next window's start on the same output. This refines P14 so that two close windows can never overlap in a repeated hour, which wall-clock validation cannot see, instead of rejecting otherwise valid schedules in zones with DST.
6. **Evaluator and library (ADR-0029).** A pure TypeScript evaluator in the API on the Temporal API through the `temporal-polyfill` package until Node.js ships Temporal; canonical JSON fixtures owned by the API and run by the player in PJ-12; preview computed only by the API.
7. **Items and transitions.** Images 1 to 3,600 s (10 s default), videos at full duration, playlists loop, boundaries interrupt; transitions `CUT` or `FADE` of 250 to 2,000 ms, with fades accepted at publication only on qualified profiles.
8. **Permissions.** `programming.view`, `programming.edit` and `programming.assign` as in the table, all delegable; operators author drafts but do not assign; assigning needs strong authentication like managing screens.
9. **Assignment confirmation.** Assignments are separate from program edits, use the screen's settings version and require an explicit confirmation while the destination is unpublished, which is every destination until PJ-11.
10. **Lifecycle.** Playlists and groups are deleted only when unused, with a confirmation; media used by playlists cannot be deleted; archived media stays in playlists but cannot be added.
11. **Limits.** 1,000 playlists, 100 groups and 2,000 programs per company; 500 items per playlist; 200 rules per output; timelines of 31 days and 2,000 segments.

Approval authorizes implementation of PJ-10 in local and CI environments. It does not publish anything to screens (PJ-11), qualify fades or schedule timing on hardware (PH-08, PJ-12) or design layout areas (PJ-20).

## Alternatives considered

- **Store each rule's time zone, or a group zone.** It would let a group run on one zone's clock, but the selected policy interprets local hours per screen, and a stored zone would diverge from branch changes.
- **Store expanded occurrences.** Simple queries, but unbounded for open-ended rules and wrong after a zone database update; evaluating from rules keeps one source of truth.
- **iCalendar RRULE strings.** A standard, but far more expressive than the selected rules (monthly, by-set positions, exceptions), harder to validate for conflicts and to explain in the panel; the weekday model covers FR-06 and can export to RRULE later.
- **Validate conflicts on resolved instants per zone.** Exact, but depends on every zone a group can reach and on future zone-database changes, and still needs the repeated-hour rule; wall-clock validation plus the handoff clip is zone-independent and deterministic.
- **Luxon or date-fns-tz.** Mature, but each has its own model of gaps and repeated hours; Temporal's model matches `java.time`, which the Android player is expected to use, so both implementations reason in the same terms.
- **Hand-written arithmetic over `Intl.DateTimeFormat`.** No dependency, but transition search and disambiguation are where subtle bugs live; a spec-conformant implementation tested against the shared fixtures is safer.
- **Implicit priority between overlapping rules.** Rejected by the policies.
