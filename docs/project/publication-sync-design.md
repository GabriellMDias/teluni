# Teluni Publication and Synchronization Design

[Offline playback and synchronization](playback-and-sync.md) · [Assignment and publication](release-policies.md#assignment-and-publication) · [Acceptance targets](release-targets.md#reliability-and-synchronization-targets) · [Identity and access policies](identity-and-access.md#permission-model-and-default-matrix) · [Tenant data design](tenant-data-design.md) · [Device enrollment design](device-enrollment-design.md) · [Media library design](media-library-design.md) · [Programming design](programming-design.md) · [ADR-0019](../adr/0019-propose-immutable-publications-and-atomic-player-activation.md) · [ADR-0030](../adr/0030-propose-pull-based-screen-synchronization-with-signed-authorization-statements.md) · [PH-25](human-actions.md#ph-25)

## Status and scope

**Approved detailed design for D-04 (server side) and the basic monitoring of FR-09, 2026-10-20.** The owner approved all ten [decisions for review](#decisions-for-review) as proposed under [PH-25](human-actions.md#ph-25), including ADR-0030, after the API and panel had been built on the recommended options so the review could see working behavior. Approval authorizes PJ-11 in local and CI environments with a simulated player.

In scope: publishing a program into an immutable generation, the manifest format, the desired publication of each screen, the device synchronization exchange, delivery of manifests and media to screens, the signed authorization statement, acknowledgements and state reports, the screen's synchronization state in the panel, published-reference protection, publication history, restore and retention, permissions, limits, audit, data, contracts and verification (FR-07, FR-09).

Out of scope, with their owners: the player's storage, staging, activation and power-loss recovery, which this design states only as obligations of the protocol (D-07, PJ-12); trusted-time estimation on the device (D-07, AT-16), which receives a signed server time here; layout areas and catalog snapshots (D-11, PJ-20/PJ-21), which extend the manifest; automatic price publication (PJ-21); optional publication approvals (IA-12, PJ-24); commercial expiry capping and transfer accounting (PJ-27); alerts, diagnostic records and support tools (D-09); push notifications, which this design does not need; qualification on hardware (PH-08).

## Policy inputs

The design applies these selected policies without changing them:

- Edits are drafts until deliberately published. A publication is an immutable, complete snapshot; activation needs its whole supported resource set, and failure preserves the last valid generation. Distinguish saved, published, downloaded and active states; server intent is never activation evidence ([assignment and publication](release-policies.md#assignment-and-publication), [publication lifecycle](playback-and-sync.md#publication-lifecycle)).
- Confirming an assignment requests the destination's latest publication without another publish action. An intentionally unpublished destination is allowed after a clear indication and then shows neutral output; a failed or unseen synchronization preserves valid state.
- Order desired state by authoritative server state, never by device clocks; old acknowledgements cannot roll a screen back; superseded delivery work may coalesce to the latest authorized compatible snapshot ([consistency](playback-and-sync.md#consistency-and-concurrency)).
- Detect a desired publication within 30 seconds (AT-11); report state every 30 seconds, stale after 90 seconds and offline after 120 seconds, always with the last observed time (AT-24); show an observed acknowledgement within 10 seconds of receiving it (AT-14).
- Offline authorization ends no later than seven days after the last renewal (AT-15); trusted-time uncertainty of at most 60 seconds (AT-16); the player keeps the active and previous valid generations and a valid staging attempt (AT-19) within the reserve of AT-05.
- Inactive publication history stays recoverable for at least 90 days (AT-18); detailed operational reports are kept 30 days by default (AT-20); the current and previous protocol generations are supported for at least 90 days after a transition (AT-26).
- Publishing or restoring a published version is allowed to administrators company-wide and branch managers in their branches; operators need an additional grant ([permission matrix](identity-and-access.md#permission-model-and-default-matrix)). Anyone granted publication needs strong authentication, and ordinary publication uses the normal compliant session without a new prompt.

## Concepts

- A **destination** is a program of the programming module: a group's program or a screen's own program.
- A **publication** is one immutable generation of a destination. Generations count 1, 2, 3 per program. A publication holds the manifest's exact bytes, their SHA-256, a digest of its content, the media it needs, its publisher and time.
- A screen's **desired publication** is the latest publication of its current programming source; a screen whose source has none desires nothing and shows neutral output.
- A screen's **reported state** is what it says it received, staged and activated. Reports are facts about the screen, never instructions to the server.

## Publishing

Publishing takes the current draft of a program and makes it the destination's next generation:

1. `POST .../publications/check` builds the snapshot without saving it and returns either the problems that block publication or a summary (rules, playlists, items, media count and bytes, screens that follow the destination) with a **content digest** and whether the content equals the latest publication.
2. `POST .../publications` with that content digest publishes. The server builds the snapshot again in one transaction, after the organization locks and share locks on the program, its playlists and their media, so concurrent edits wait. A different digest answers `RESOURCE_VERSION_CONFLICT`, so a person publishes exactly what they reviewed, including playlist edits by others. Content equal to the latest publication returns that publication without a new generation, which makes retries safe.

The snapshot contains every output's rules and default, a copy of each referenced playlist (transition and items) and a descriptor of each display rendition. Publication refuses with `PUBLICATION_INVALID`, and the check lists why, when:

- a rule or default uses a playlist outside the scope of every branch the program reaches (for example the old playlists of a moved screen);
- an item's media is no longer `READY` or `ARCHIVED` (archived media keeps playing, as the media design requires; deleted media cannot be published);
- a playlist uses `FADE`, until a screen profile is qualified for fades (PH-08); the reason names the playlist instead of silently cutting;
- the rule set fails validation (it was validated on save; publication checks again);
- the snapshot exceeds 2,000 items or 1,000 distinct media.

An empty program (no rules and no default) is publishable: it deliberately shows neutral output. Publishing never changes drafts, assignments or other destinations.

## The manifest

The manifest is UTF-8 JSON produced by the server in a fixed key order without insignificant whitespace, stored and served byte for byte, and identified by the SHA-256 of those bytes. Protocol 1:

```json
{
  "format": "teluni.publication",
  "protocol": 1,
  "publicationId": "…",
  "companyId": "…",
  "programId": "…",
  "generation": 3,
  "publishedAt": "2026-10-19T12:00:00.000Z",
  "outputs": [
    {
      "key": "screen",
      "defaultPlaylistId": null,
      "rules": [
        {
          "id": "…",
          "playlistId": "…",
          "weekdays": [1, 2, 3, 4, 5],
          "allDay": false,
          "startTime": "08:00",
          "endTime": "18:00",
          "startsOn": "2026-10-20",
          "endsOn": null
        }
      ]
    }
  ],
  "playlists": [
    {
      "id": "…",
      "transition": { "kind": "CUT" },
      "items": [{ "mediaId": "…", "durationMs": 10000 }]
    }
  ],
  "media": [
    {
      "id": "…",
      "kind": "IMAGE",
      "contentType": "image/jpeg",
      "size": 482113,
      "sha256": "…",
      "width": 1920,
      "height": 1080,
      "durationMs": null,
      "hasAudio": false
    }
  ]
}
```

Rules use the exact representation of the [shared schedule fixtures](programming-design.md#shared-fixtures), so the player evaluates a manifest with the same code it tests against the fixtures. The time zone is not part of the manifest: one group publication serves screens in different zones, and each screen receives its zone with its desired state. Names of playlists, media and people are omitted; the player does not show them, and identifiers are enough for diagnostics. A video item's `durationMs` is null: it plays its whole rendition.

The content digest is the SHA-256 of the same serialization of `outputs`, `playlists` and `media` only, so it does not change with the generation, time or identifiers of a publication.

A program with a layout publishes **protocol 2** instead, which adds `layout` and `catalogs` before `playlists` and gives each area an output; its digest covers `layout`, `outputs`, `catalogs`, `playlists` and `media`. The [catalog and composition design](catalog-composition-design.md#publication-protocol-2) defines it.

## Desired state

The desired publication of a screen is computed when the screen synchronizes, from current rows: the screen's programming settings choose the source (its group's program unless individual programming is selected, otherwise its own), and the source's latest publication is desired. Nothing is fanned out when someone publishes or assigns: a new publication, an assignment, a move that leaves a group or a group change takes effect at the screen's next synchronization, at most 30 seconds later while it is connected. Because desired state always comes from authoritative rows, an old acknowledgement or a reordered report cannot roll a screen back.

The programming module's assignment confirmation becomes exact: `confirmUnpublished` is required only when the destination has no publication, and the panel then explains that the screen will show neutral output until the destination is published. A destination with a publication needs no confirmation; the screen moves to that destination's latest publication. This completes the programming design's increment 3 for publications.

## Synchronization exchange

Screens use their device credential (ADR-0027) on every request and poll; the server never pushes.

| Operation | Purpose |
| --- | --- |
| `POST /device/sync` | Every 30 seconds: the screen sends its state report and receives its status, time zone, desired publication and a fresh authorization statement |
| `GET /device/publications/{publicationId}/manifest` | The manifest bytes of the screen's current desired publication |
| `GET /device/media/{mediaId}` | The display rendition of a media item of the current desired publication, with single-range requests for resuming |
| `GET /device/keys` | The public keys that verify authorization statements |

The sync response carries `serverTime`; `status` (`active`, `suspended` or `unlinked`, as in `GET /device/self`); the effective `timeZone` (the screen's own, otherwise its branch's) with `zoneOffsets`, its UTC offsets from three days before `serverTime` to 35 days after it, and the configured `rotation`, both added for the player ([player design](player-design.md#server-additions)); the screen's `branchId`, which protocol 2 needs for branch prices; `desired` with the publication ID, its protocol, generation, manifest SHA-256 and size and whether it comes from a group or the screen's own program, or `null` for an unpublished source; the `authorization` statement; and `nextSyncSeconds` (30). A suspended company renews nothing: the response has no statement and no desired publication, and the screen keeps its current state until its last statement expires. An unlinked screen receives `clearRequired` and nothing else, and continues with the devices module's erasure confirmation.

Manifest and media requests are allowed only for the screen's **current** desired publication. A superseded publication answers `RESOURCE_NOT_FOUND`, and the player synchronizes again, which coalesces superseded work as the policies allow. Media responses carry the rendition's SHA-256 as a strong `ETag`, its exact length and type, `Cache-Control: private, no-store` and `X-Content-Type-Options: nosniff`; the player verifies length and SHA-256 against the manifest before accepting a file. A screen may hold at most two media downloads at once.

Protocol compatibility: every manifest and exchange names its protocol. The sync request says which protocols the player supports; the server answers with the highest protocol both support and refuses with `PROTOCOL_UNSUPPORTED` when there is none. Protocol 2 does not replace protocol 1: a program without a layout keeps publishing protocol 1, byte for byte, and a program with a layout publishes protocol 2, which protocol 1 cannot represent. `desired.protocol` names the desired publication's protocol, so a screen that supports only protocol 1 reports `INCOMPATIBLE` without downloading it. A later protocol that replaces an existing one serializes publications in both for at least 90 days (AT-26).

## The authorization statement

Each sync response for an active screen carries a statement signed by the server as a compact JWS with `ES256` (ECDSA P-256 with SHA-256), a `kid` naming the key and `typ` `teluni-authorization+jws`. Its claims:

| Claim | Meaning |
| --- | --- |
| `sub`, `company` | The screen and its company |
| `iat` | The server's time when it was issued: a signed time reference for the player's trusted clock (D-07, AT-16) |
| `exp` | `iat` plus seven days (AT-15), the latest moment the player may show protected content without a newer statement; capped by commercial validity in PJ-27 |
| `publications` | The publications the player may activate or keep active until `exp`: each ID with its manifest SHA-256 |

`publications` holds the desired publication and, while the screen has not activated it, the active and recovery generations the screen reported, when they are unpruned publications of the screen's company. An unpublished source yields an empty list, so the screen shows neutral output after applying an assignment, as the policies require; a failed staging keeps the previous generation authorized. Revoking a specific publication (incident response) would remove it from every list; no revocation operation is part of this design.

The player obligations that follow, for PJ-12: verify every statement with a pinned key before trusting it; activate only a complete generation whose manifest SHA-256 a valid statement lists; show neutral output when the latest valid statement has expired by trusted time; never extend a statement's validity locally; keep the latest statement with the active generation.

Keys: `TELUNI_SYNC_SIGNING_KEYS` is a key ring of P-256 private keys, newest first. The first key signs; the public halves of all keys are served at `GET /device/keys` as a JSON Web Key Set. The player fetches the set after pairing over TLS and refreshes it at each sync when a statement names an unknown `kid`. Rotation adds a new key at the front and keeps the old one for at least seven days, the longest validity of a statement it signed. Without the key ring the publications module stays unmounted.

## State reports and monitoring

The sync request is the screen's report: the protocols it supports and its application version; the `active` publication with its activation time and the `recovery` publication; the `staging` attempt with its publication, state (`DOWNLOADING`, `VERIFYING`, `READY` or `FAILED`), bytes done and total and a failure code (`STORAGE_FULL`, `DOWNLOAD_FAILED`, `INTEGRITY_FAILED`, `INVALID_MANIFEST`, `INCOMPATIBLE`); the playback condition (`PLAYING`, `NEUTRAL`, `AUTHORIZATION_EXPIRED`, `CLOCK_UNTRUSTED`, `DEGRADED` or `SETUP`); free and total storage; and the device's clock reading. All values are bounded and validated; unknown publication IDs are kept as reported but never trusted.

The server keeps the latest report per screen with the time it was received and the desired publication it answered, and appends an event when the active publication, the staging state or failure, or the playback condition changes, or when a newly desired publication is delivered. Events are kept for 30 days (AT-20).

The panel derives, never stores, what it shows:

- **Connection:** online while the last sync is at most 90 seconds old, without recent contact after 90 seconds and offline after 120 seconds (AT-24), always with the time of the last contact.
- **Publication:** up to date when the reported active publication is the desired one; updating while staging the desired one, with progress; failed with the reported reason; neutral when the source is unpublished; unknown when the screen has never reported.
- **Playback:** the reported condition, labeled as reported by the screen.

The panel polls a screen's state every 5 seconds while its page is open, so an acknowledgement appears within AT-14's 10 seconds of the server receiving it.

## History, restore and retention

A program's history lists its publications, newest first, with generation, publisher, time, counts and whether it restores an earlier generation. **Restore** publishes an earlier generation's content again as a new generation, after checking that its playlists still fit the program's current reach and its media are still publishable; it never changes the drafts. A protocol 2 publication is also restored only while the program's reach stays within the branches it was published for, because its prices cover only those. Restore needs the same capability as publishing. Since automatic price publication ([catalog and composition design](catalog-composition-design.md#automatic-price-publication)), the catalogs' current prices follow a restored protocol 2 generation at once as a price publication, and history marks each generation's origin: a person's publication, a restore or a price publication.

A publication is **retained** while it is the latest of its program, while an active screen reported it as active, recovery or staging within the last seven days, or until 90 days after the next generation superseded it (AT-18). Hourly maintenance prunes the others: it deletes their manifest bytes and media references and keeps the row, so history still shows them as no longer restorable.

The publications module registers a `publication` media reference guard: media referenced by a retained publication cannot be deleted or purged, and the refusal discloses only references the caller may see. Deleting a group, which requires that it has no members, deletes its program and with it the program's publications; their audit events remain.

## Permissions

| Capability | Company administrator | Branch manager | Operator | Delegable |
| --- | --- | --- | --- | --- |
| `publications.publish`: publish and restore programs | Company | Branches | No (additional grant) | Yes, with `programming.view` |

Scope follows the programming design: a group's program needs the capability on every branch of its span (company scope for a whole-company group), a screen's program on the screen's branch. `publications.publish` always needs strong authentication, also through a profile, and works in the normal session without a recent re-authentication. A program's history and check need `programming.view` on the same scope; a screen's synchronization state needs `devices.view` on its branch.

## Abuse limits

At most 30 publications per program per hour and 300 per company per day (`RATE_LIMITED`; an unchanged publication counts for neither). Snapshots of at most 2,000 items and 1,000 distinct media. Sync requests share the device request limit, which counts each presented credential, not each client address, under a ceiling of 6,000 requests per address per minute, because screens behind one router or the ingress proxy share an address; at most two concurrent media downloads per screen. Reports are bounded by request validation.

## Audit

`publication.published` and `publication.restored` events record the actor's membership, the program, its source kind and branches, the generation and counts, in the same transaction. Automatic price publication adds `publication.price_published` (the authority's membership, with the catalog, its price sequence, the intent and its author) and `publication.price_reauthorized` (who authorized a blocked or failed intent again). Pruning is maintenance and is not attributed to a person. Device reports are operational records with 30-day retention, not audit.

## Data

| Table | Purpose |
| --- | --- |
| `publications` | Company, program (composite reference, deleted with the program), generation (unique per program), protocol, content digest, manifest bytes (null once pruned), manifest SHA-256 and size, item and media counts and bytes, restored-from publication, origin (manual, restore or price), publisher membership, published, superseded and pruned times |
| `publication_playlists` | Each playlist copied into a publication with the branch that owned it then, for restore checks |
| `publication_media` | Each media item of a retained publication with its rendition SHA-256, size and type (composite reference to the media item); deleted when pruned |
| `publication_device_states` | One row per screen: last report fields, time received and the desired publication answered |
| `publication_device_events` | Report transitions per screen, kept 30 days |
| `publication_audit_events` | Append-only audit rows with the branches they concern |

Every table carries `company_id` with composite tenant references, as the [tenant data design](tenant-data-design.md) requires; reported publication IDs are stored as reported, without references, because they are untrusted. Manifests are `CONFIDENTIAL` like the schedules they contain.

## Contracts

Human operations under `/companies/{companyId}/programming/groups/{groupId}/publications` and `/companies/{companyId}/programming/devices/{deviceId}/publications`: list (cursor-paginated), `check`, publish with the content digest, and `{publicationId}/restore`. `GET /companies/{companyId}/devices/{deviceId}/sync-state` returns one screen's state and `GET /companies/{companyId}/publications/screen-states?deviceId=…` up to 100 for lists. Device operations as in the exchange table. New errors: `PUBLICATION_INVALID`, `PUBLICATION_NOT_RESTORABLE` and `PROTOCOL_UNSUPPORTED`, with the existing access, `RESOURCE_NOT_FOUND`, `RESOURCE_VERSION_CONFLICT`, `RATE_LIMITED` and `VALIDATION_FAILED`. The SDK and OpenAPI document are regenerated.

## Panel

- **Programs** (group page and a screen's programming): the latest generation with its time and publisher, "changes not published" when the check reports a different digest, and **Publicar** for people who may publish: a dialog with the summary, the number of screens that follow the destination and every problem, then confirmation. A history list with **Restaurar** on retained generations.
- **Screens** (Telas): a synchronization section with connection and last contact, desired and active generation, staging progress or failure, reported playback and free storage; the list shows connection and publication state per screen; a group page summarizes its members.

Copy is in `pt-BR` and `en-US`; reported states are labeled as reported by the screen.

## Verification

- Domain tests: manifest serialization is stable byte for byte and matches the fixture rule format; content digest independence from generation and time; statement signing and verification with rotated keys; desired-state selection; authorization lists for desired, active, recovery, unpublished and foreign publications; connection thresholds; retention decisions.
- Integration tests against PostgreSQL with two companies and differently scoped members: check and publish allowed and denied by role, profile and span; operators denied; digest conflict; unchanged publication; fades, deleted media, out-of-scope playlists and size limits refused; generations; media guard; restore; desired state across publication, assignment, individual programming and moves; the unpublished-destination confirmation; sync for active, suspended and unlinked screens; manifest and media access only for the current desired publication and the screen's company; ranges; reports, events and states; pruning after 90 days with retention exceptions; limits and audit rows.
- Browser component tests for the publish dialog, history and restore and the screen's synchronization section, and one end-to-end journey in which a simulated player pairs, synchronizes, downloads and verifies the manifest, media and statement, and reports activation while the panel shows the screen up to date.

## Delivery increments

1. API module, schema and migration, check, publish, history, restore, desired state, the sync exchange, manifest and media delivery, signed statements and keys, reports and events, guards, maintenance, the assignment change, audit, contracts and SDK.
2. Panel pages: publish dialog, history and restore, the screen's synchronization section, list and group summaries, with browser tests and the end-to-end journey with a simulated player.
3. Hardening with PJ-12 (player conformance against the manifest and statement), PJ-20/PJ-21 (layout and catalog content in the manifest, price publication), PJ-27 (commercial expiry and transfer accounting) and optional approvals (PJ-24).

## Implementation status

Implemented in [PJ-11](implementation-plan.md#current-work) on 2026-10-19, increment 1, on the recommended options, which the owner then approved under [PH-25](human-actions.md#ph-25):

- The [`publications` API module](../../apps/api/src/features/publications/AGENTS.md), its reviewed migration (which also lets profiles delegate `publications.publish`), runtime grants, schema metadata, the operations in the [OpenAPI document](../generated/api/openapi.json) and SDK, and the `TELUNI_SYNC_SIGNING_KEYS` setting; without it the module stays unmounted.
- `publications.publish` for administrators and branch managers and as a delegable profile capability with `programming.view`, always with strong authentication.
- Check, publish with the reviewed content digest, history and restore over the programming port's locked snapshot; the protocol 1 manifest and content digest in [`domain.ts`](../../apps/api/src/features/publications/domain.ts); ES256 statements and the key set with `jose`.
- The sync exchange, delivery of the desired publication's manifest and renditions with ranges and at most two downloads per screen, screen states and 30-day transitions, the `publication` media guard, hourly pruning, and the programming assignment that asks for confirmation only for unpublished destinations.
- [Domain tests](../../apps/api/test/publications/domain.test.ts) for exact manifest bytes, fixture-format rules, digests, statements with rotated keys, authorization lists, AT-24 thresholds and protocol agreement, and the [two-company integration suite](../../apps/api/test/publications/integration.test.ts) with simulated screens against PostgreSQL as the runtime role.

Increment 2, the same day:

- The panel's Publicação section on group pages and on the programming of screens with individual programming ([`publications.tsx`](../../apps/web/src/programming/publications.tsx)), the assignment form that asks for confirmation only for unpublished destinations, member screen states on group pages, and the screen's synchronization section and list states in Telas ([`sync.tsx`](../../apps/web/src/devices/sync.tsx)).
- Browser component tests for the review, problems, a draft changed after review, restore, the published-destination assignment and the synchronization section, and the [publication journey](../../apps/web/test/e2e/publications/journey.spec.ts) with a simulated player that verifies its statement, manifest and media.

Both increments were merged through [pull request #12](https://github.com/GabriellMDias/teluni/pull/12) on 2026-10-20 after its CI passed.

Follow-up on 2026-10-20: the screen routes of this module and of `devices` count their pre-authentication limit (120 requests per minute) per presented credential under a ceiling of 6,000 per client address. Counted per address, it let about 60 screens behind one address, below the reference load of 100, exhaust it and appear offline.

Increment 3, started 2026-10-20 with the [player design](player-design.md): `zoneOffsets` and `rotation` in the sync response and the player [conformance fixtures](../../apps/api/test/publications/conformance.json), which [`scripts/conformance.ts`](../../apps/api/scripts/conformance.ts) writes from the API's own serializer, signer and zone rules, checked by a [conformance test](../../apps/api/test/publications/conformance.test.ts). The same day, [protocol 2](catalog-composition-design.md#implementation-status) for programs with a layout: the manifest and digest, the sync answer's `branchId` and `desired.protocol`, restore within the reach a publication was made for, and its conformance fixtures. The player `core` parses and plans protocol 2 the same day. On 2026-10-21, [automatic price publication](catalog-composition-design.md#implementation-status): price changes queue intents under the shared publication lock, publications record the catalogs they copy and settle intents, and the price processor publishes generations with `origin: "price"`. Pending: player conformance on devices (PJ-12), commercial capping (PJ-27) and optional approvals (PJ-24).

## Decisions for review

The owner approved each item as proposed on 2026-10-20 under [PH-25](human-actions.md#ph-25):

1. **Publication unit.** One immutable generation sequence per program; a publication copies the program's rules, its playlists and descriptors of its media; publishing needs the content digest the person reviewed, and unchanged content returns the latest publication.
2. **Derived desired state.** A screen desires the latest publication of its current source, computed at each synchronization; no fan-out; an unpublished source means neutral output; the assignment confirmation is required only for unpublished destinations.
3. **Pull synchronization (ADR-0030).** `POST /device/sync` every 30 seconds exchanges the screen's report for its desired state; manifests by publication and media by item, both only for the current desired publication; no push channel.
4. **Manifest protocol 1.** Exact JSON bytes identified by SHA-256, identifiers instead of names, rules in the fixture format, media descriptors with size, SHA-256, type and dimensions; zones delivered per screen.
5. **Signed authorization statement (ADR-0030).** ES256 JWS from the `TELUNI_SYNC_SIGNING_KEYS` key ring with signed server time, a seven-day expiry and the manifests the screen may play; public keys at `GET /device/keys`; the player obligations listed above.
6. **Publication validation.** Scope, media availability (archived allowed), schedule validity and size are checked again; fades are refused until a qualified profile exists rather than downgraded.
7. **Permissions.** `publications.publish` as in the table, delegable with `programming.view`, always with strong authentication and no recent re-authentication; history with `programming.view`, screen state with `devices.view`.
8. **Reports and monitoring.** Latest report per screen and 30-day transition events; connection thresholds of AT-24 from the last sync; reports are facts, never desired state.
9. **Retention and restore.** Retained while latest, reported in use within seven days, or within 90 days of being superseded; pruning keeps the history row; restore republishes a retained generation as a new one; a `publication` media guard protects retained media.
10. **Limits.** 30 publications per program per hour and 300 per company per day; 2,000 items and 1,000 media per snapshot; two concurrent media downloads per screen.

Approval authorizes implementation of PJ-11 in local and CI environments with a simulated player. It does not qualify any player behavior on hardware (PH-08, PJ-12), select alert channels (D-09) or provision signing keys in a real environment (PJ-13).

## Alternatives considered

- **Fan out desired state into per-screen rows when publishing or assigning.** Makes reads trivial, but needs a durable queue to survive crashes between the publication and the fan-out and can disagree with assignments made in between; computing desired state from authoritative rows at each poll is always consistent and costs one indexed query per sync.
- **Push (WebSocket or server-sent events) or a broker.** Faster detection, but AT-11 allows 30 seconds, and a persistent channel adds connection state, proxies and reconnection logic on a single-host pilot; polling also serves as the AT-24 heartbeat.
- **Rebuilding the manifest on every request, or storing it as `jsonb`.** Either would change bytes between requests (PostgreSQL normalizes `jsonb` key order), so the SHA-256 the statement signs could not identify them; stored exact bytes are the immutable identity.
- **Signing each manifest at publication instead of per-screen statements.** Authenticates content but not the screen's entitlement or time; a per-screen statement binds the screen, its allowed publications, the expiry and a signed server time in one verifiable object.
- **Relying on TLS only.** TLS protects transport but leaves the stored expiry and manifest choice as plain files that a casual edit could extend; the signed statement makes them tamper-evident and gives the trusted clock a server reference.
- **Ed25519 or HMAC statements.** Ed25519 is compact but not available on every Android version the player may target without an added library; an HMAC would put a shared secret on every screen. ECDSA P-256 is supported by Node.js and by Android's standard security providers.
- **Publishing per screen instead of per program.** Would copy one group's snapshot for every member and lose the generation sequence a person reasons about; screens already share a program through their group.
