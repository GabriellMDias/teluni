# Teluni Media Library Design

[Release policies](release-policies.md#media-and-deletion-lifecycle) · [Acceptance targets](release-targets.md#media-and-rendering-targets) · [Security requirements](security-and-i18n.md#media-and-audit-protections) · [Identity and access policies](identity-and-access.md#permission-model-and-default-matrix) · [Tenant data design](tenant-data-design.md) · [Operations](operations.md#persistent-state-and-storage-portability) · [ADR-0028](../adr/0028-propose-local-content-addressed-media-storage-and-isolated-ffmpeg-processing.md) · [PH-23](human-actions.md#ph-23)

## Status and scope

**Approved detailed design for D-05, 2026-10-19.** The owner approved all nine [decisions for review](#decisions-for-review) as proposed under [PH-23](human-actions.md#ph-23), including ADR-0028, after asking for development to continue autonomously. Approval authorizes implementation of PJ-09 in local and CI environments with generated fixtures.

In scope: tenant-owned media assets and their branch scope, upload, trustworthy inspection and validation against AT-02/AT-03, the playback rendition profile and conversion (FR-04), processing isolation, private storage and delivery to the panel, archive, trash and reference-safe purge (AT-17), permissions, abuse limits, audit, data, contracts, panel workflow and verification.

Out of scope, with their owners: delivery of renditions to devices inside publications (D-04, PJ-11); playlists and other references to media (PJ-10, PJ-20, PJ-21), which register through the reference port defined here; commercial original-media quotas and the 80%/100% warnings (PJ-27); qualifying any device decoder, memory or storage profile (PH-08, PJ-12); malware scanning and content moderation (pending risk decision, PH-13); the production container image that ships FFmpeg (PJ-13).

## Policy inputs

The design applies these selected policies without changing them:

- Validate declared and inspected type, size, decoded dimensions, duration, compatibility and scoped references; enforce all bounds, not only compressed size: images at most 20 MiB, each decoded axis at most 8,192 px and at most 32,000,000 pixels (AT-02); videos at most 1 GiB and 60 minutes (AT-03). Ingestion bounds are configurable engineering defaults, not plan quotas.
- Preserve originals and create compatible renditions when validated processing is supported; show preparation, progress and preview; reject with an actionable reason when safe conversion is unavailable; never silently distort content ([media lifecycle](release-policies.md#media-and-deletion-lifecycle)).
- Archiving removes media from new selections without breaking references. Physical deletion is blocked while drafts, active, staged or recovery generations or protected publications reference the media, disclosing only references the caller may see; a recoverable archive or trash lasts at least 30 days before purge (AT-17).
- Uploading media is allowed to administrators company-wide and to branch managers and operators in their branches; archive and restore to administrators and branch managers; permanent deletion only to administrators ([permission matrix](identity-and-access.md#permission-model-and-default-matrix)). Share media explicitly with branches or the whole company and enforce scope on lists, previews and downloads, not only on buttons.
- Customer media is `CONFIDENTIAL`, private, never public because it appears on a screen, and never addressed by a public filesystem path or a permanent bearer URL ([operations](operations.md#persistent-state-and-storage-portability)). Uploads are not executable content; parsers run isolated ([security requirements](security-and-i18n.md#media-and-audit-protections)).
- Media storage is a media-owned capability with replaceable filesystem I/O so that an S3-compatible store can be added later (ADR-0021).

## Assets, scope and visibility

An **asset** is one uploaded file and what Teluni derived from it. It belongs to one company and has an owning scope:

- **Company** (`branch_id` empty): created by people with company-wide upload authority. Every member with `media.view` anywhere in the company can see and use it; this is the "shared with the whole company" case.
- **Branch**: created for one branch. Members with `media.view` on that branch see and use it; others do not learn it exists (`RESOURCE_NOT_FOUND`).

Explicit sharing of a branch asset with further selected branches is a later increment of this design (a `media_asset_shares` table with read/use authority only); until then a company-scoped asset is the way to share. Editing authority always follows the owning scope.

Each asset has a name (1 to 120 characters, the uploaded file name by default, never used as a path), a kind (`IMAGE` or `VIDEO`), an optional set of up to 10 tags (each 1 to 40 characters) for organization and search, and the inspected facts: content type, size, width, height, duration and whether it has audio.

## Upload

Upload is two requests, so the server can admit the file before receiving any bytes and the bytes stream to disk without buffering:

1. `POST /companies/{companyId}/media` with the name, scope, declared content type and declared size creates the asset in `UPLOADING`. The server requires `media.upload` on the scope, an active company and branch, a declared type from the allowlist below and a declared size within the kind's limit, and checks the abuse limits and the storage reserve.
2. `PUT /companies/{companyId}/media/{assetId}/content` with `Content-Type: application/octet-stream` and a `Content-Length` equal to the declared size streams the bytes to a temporary file on the media volume while computing their SHA-256. More bytes than declared, fewer bytes, a closed connection or a size mismatch delete the temporary file and leave the asset in `UPLOADING`, so the person can retry the same `PUT`. A complete upload moves the asset to `PROCESSING` and wakes the processor.

An asset still in `UPLOADING` one hour after creation is discarded by maintenance. Resumable chunked upload (for example the tus protocol) is not part of this design; it is the preferred extension if pilot measurements show that whole-file retries of large videos are a problem.

## Inspection and validation

Every check runs on the server; the declared values only admit the upload.

1. **Signature.** The first bytes must carry the signature of an allowed format, and that format must match the declared type: JPEG (`FF D8 FF`), PNG (the 8-byte PNG signature), WebP (`RIFF....WEBP`), the ISO base media family (`ftyp` box: MP4, MOV, M4V) or Matroska/WebM (EBML header). Anything else, including a mismatch with the declared type, is rejected as `MEDIA_TYPE_MISMATCH` or `MEDIA_TYPE_UNSUPPORTED`.
2. **Probe.** `ffprobe` reads the file with its demuxer forced to the format the signature identified, input limited to the local file protocol, and JSON output bounded to 1 MiB. A probe that fails, times out or reports no usable stream rejects the asset as `MEDIA_UNREADABLE`.
3. **Images.** Exactly one still picture coded as JPEG, PNG or WebP; animated PNG or WebP is rejected. Each axis at most 8,192 px and at most 32,000,000 pixels, after applying the EXIF orientation.
4. **Videos.** At least one video stream whose codec is H.264, HEVC, VP8, VP9, AV1 or MPEG-4 Part 2; audio, when present, AAC, MP3, Opus, Vorbis, FLAC or AC-3. Each axis at most 8,192 px, frame rate at most 120 fps, duration more than 0 and at most 3,600 seconds (AT-03). Further streams (subtitles, data, attachments) are ignored and never copied.
5. **Decode.** Producing the renditions decodes the whole file. A decoding error rejects the asset as `MEDIA_UNREADABLE`; the original is never offered for use in that case.

A rejection is final for that asset: it moves to `REJECTED` with the reason code, its temporary and derived files are deleted, and the panel explains the reason in the person's language. The person may discard it.

## Renditions and the playback profile

The original is kept unchanged and is never sent to a screen. Each asset gets a **display** rendition, which is what playlists and publications use, and a **thumbnail** for the panel:

| Kind | Display rendition | Thumbnail |
| --- | --- | --- |
| Image | JPEG (or PNG when the image has transparency), EXIF orientation applied, all metadata removed (including location), scaled down without enlargement to fit 3840×2160 for landscape or 2160×3840 for portrait | JPEG fitting 320×320 |
| Video | MP4 with the index at the start, H.264 High profile level 4.1, 8-bit 4:2:0, at most 1920×1080 for landscape or 1080×1920 for portrait, at most 30 fps, rotation applied, metadata removed; audio AAC-LC stereo 48 kHz at 128 kbit/s when the original has audio | JPEG fitting 320×320 from the frame at one second (or the middle of shorter videos) |

A video that already matches the profile (H.264 High, Main or Baseline at or below level 4.1, 8-bit 4:2:0, within the size and frame-rate bounds, AAC or no audio, no rotation) is remuxed without re-encoding, so it keeps its quality. Everything else is transcoded with `libx264` (preset `veryfast`, constant quality 21). The result is probed again and must match the profile before the asset becomes `READY`.

This profile is the conservative reference that Android TV hardware decoders commonly support and matches the AT-04 reference qualification (1080p output, two simultaneous 1080p/30 fps videos). It is not a support claim: PH-08 and PJ-12 qualify real devices, and a later profile (for example 4K HEVC) is an additional rendition with its own evidence, never a silent replacement. Output larger than 2 GiB, a transcode slower than the processing timeout or a profile violation after conversion rejects the asset as `MEDIA_CONVERSION_FAILED` with the advice to export a smaller or shorter file.

## Processing and isolation

- **Processor.** An in-process processor, like the mail dispatcher, claims assets in `PROCESSING` from PostgreSQL with `FOR UPDATE SKIP LOCKED` and a lease, and runs one job at a time by default (`TELUNI_MEDIA_PROCESSING_CONCURRENCY`, 1 to 4). Several API processes can share one database. Interrupted work (crash, restart, lease expiry) is picked up again; an internal failure retries up to three times with backoff and then moves the asset to `FAILED`, which the panel shows as "could not be prepared, try again or contact support".
- **Isolation.** Untrusted bytes are parsed only by `ffprobe` and `ffmpeg`, never inside the API process. Each runs as a separate child process with an empty environment except `PATH`, a fixed argument list (no shell), inputs and outputs only inside the job's temporary directory, the file protocol only (no network or other protocols), stdin closed, bounded stderr capture, and a wall-clock timeout: 30 seconds for a probe, 120 seconds for an image, and 120 seconds plus four times the video duration for a video (at most four hours), after which the process group is killed. Where the host provides `prlimit`, each child also gets address-space and CPU-time limits. Container-level confinement (non-root user, read-only root filesystem, no network for a separate processing container) belongs to the deployment work in PJ-13.
- **Tools.** FFmpeg is an external executable found at `TELUNI_MEDIA_FFMPEG_PATH` and `TELUNI_MEDIA_FFPROBE_PATH` (default `ffmpeg` and `ffprobe` on `PATH`), version 6.1 or later. At startup the module checks both; in production a missing or older tool stops the start, elsewhere processing stays queued and an error is logged.
- **Progress.** The asset stores the processing stage (`probing`, `converting`, `verifying`) and, while converting a video, the percentage reported by FFmpeg's progress output, at most once per two seconds. The panel polls the asset while it is processing.

## Storage

- **Volume.** Media lives under the directory in `TELUNI_MEDIA_STORAGE_PATH`, which must be an absolute path on a durable mount outside disposable containers (ADR-0021). Setting it activates the media module. The directory holds `objects/` and `work/`; both must be on the same filesystem so a finished file is published with an atomic rename.
- **Objects.** Every stored file is an immutable object named by the SHA-256 of its bytes inside its company: `objects/{companyId}/{first two hex digits}/{sha256}`. The same bytes uploaded twice by one company are stored once; companies never share objects, so storage never reveals whether another company holds a file. A `media_objects` row per company and hash records size and type and is the lock that keeps publication and purge consistent.
- **Writes.** A finished file is written to `work/`, flushed to disk, and then, inside a transaction that holds the object row's lock, renamed into place before the referencing asset row commits. A crash can therefore leave an unreferenced file, never a reference without a file. Maintenance deletes `work/` entries older than one day and object files without a row.
- **Reads.** The database is the authority: a read resolves the asset, checks authorization and only then opens the object by hash. File paths, hashes and the storage directory never appear in responses, errors, logs or audit.
- **Reserve.** Uploads are refused with `MEDIA_STORAGE_FULL` when the free space of the media volume would fall below the larger of 2 GiB and 10% of the volume, so a full disk never corrupts published media or stops the database. This protects the host; it is not the commercial quota.
- **Portability.** A later S3-compatible store implements the same small object interface (`put` from a finished temporary file, `open` with an optional byte range, `delete`, `list` for reconciliation), keeping object identity and domain rules unchanged.

## Delivery to the panel

`GET /companies/{companyId}/media/{assetId}/content?variant=thumbnail|display|original` streams the variant to an authenticated session with `media.view` on the asset (`original` needs `media.upload` on the asset's scope, since it may carry metadata the renditions removed). Responses are `Cache-Control: private, no-cache` with the object hash as a strong `ETag` (so revalidation is cheap and revocation applies on the next request), `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox; default-src 'none'`, the server-determined content type, `Content-Disposition` (`inline` for renditions, `attachment` with a sanitized name for the original), and single-range `Range` support for video seeking. Delivery to screens is defined with publications (PJ-11) and uses the device credential, never the panel route.

## Lifecycle

```text
 create      upload complete       processing ok
───────▶ UPLOADING ───────▶ PROCESSING ───────▶ READY ◀──────▶ ARCHIVED ───────▶ DELETED ───────▶ PURGED
            │                  │   │              archive / restore   delete        (30 days, no
            │ 1 h idle         │   └─▶ FAILED                         ▲  restore     protected
            ▼                  ▼                                      │  ◀────────   references)
        discarded           REJECTED ── discard ──▶ discarded
```

- **Rename and tags.** `media.upload` on the asset's scope and the expected version, in any state but `DELETED` and `PURGED`.
- **Archive and restore.** `media.archive` on the scope. An archived asset disappears from selection lists and keeps working wherever it is already used.
- **Delete.** Only from `ARCHIVED`, with `media.delete` (administrators) and a confirmation naming the asset. The server asks every registered reference guard whether a protected reference exists (drafts, active, staged or recovery generations, protected publications); if one does, it answers `MEDIA_IN_USE` and nothing changes. Listing the references the caller may see arrives with the first referencing module (PJ-10), which owns their names. Otherwise the asset becomes `DELETED` with `purge_after` 30 days later (AT-17), hidden from everyone but administrators' trash view.
- **Restore from trash.** `media.delete` before `purge_after`; the asset returns to `ARCHIVED`.
- **Purge.** Maintenance takes `DELETED` assets past `purge_after`, asks the reference guards again, and only when nothing protects the asset marks it `PURGED`, clears its object references and deletes each object no other asset of the company references. A protected asset stays `DELETED` and is retried; retention expiry alone never deletes media, as the release policies require. The `PURGED` row keeps the ID, name and dates for audit; its bytes are gone.
- **Discard.** An asset in `UPLOADING`, `REJECTED` or `FAILED` was never usable, so a person with `media.upload` on its scope can discard it immediately; it becomes `PURGED` and its files are deleted.

**Reference port.** The media module exposes `registerReferenceGuard(kind, guard)` on its public port. A guard runs in the deleting or purging transaction after the asset row is locked and returns the references it knows, each with the branch it belongs to, so the media module can disclose only what the caller may see. Programming (PJ-10), publications (PJ-11), compositions (PJ-20) and catalogs (PJ-21) register their guards when they exist. Selecting media for a new reference goes through the port's `requireSelectable`, which accepts only `READY` assets the caller may use.

## Permissions

Four capabilities are added to the organizations domain, which owns role presets and delegable profile capabilities:

| Capability | Company administrator | Branch manager | Operator |
| --- | --- | --- | --- |
| `media.view`: list, search, preview and use assets | Company | Granted branches and company assets | Granted branches and company assets |
| `media.upload`: upload, rename, tag, discard unusable uploads, download originals | Company | Granted branches | Granted branches |
| `media.archive`: archive and restore | Company | Granted branches | No (additional grant) |
| `media.delete`: delete to trash, restore from trash | Company | No | No |

`media.view`, `media.upload` and `media.archive` are delegable in company-customized profiles; `media.delete` is not, because the matrix gives permanent deletion only to administrators. Company-scoped assets are viewable through any `media.view` grant in the company, but uploading, editing or archiving them needs the capability company-wide. Hidden assets answer `RESOURCE_NOT_FOUND`.

## Abuse limits

Proposed initial values, each answering `RATE_LIMITED` with `Retry-After`:

- At most 5 assets in `UPLOADING` per person and 20 per company.
- At most 200 asset creations per company per day.
- At most 20 assets in `PROCESSING` per company, so one company cannot monopolize the processor.
- The upload `PUT` has no request-size limit beyond the declared size, a 2-hour request timeout and an idle timeout of 60 seconds without bytes.

Commercial original-media quotas (2 GiB trial, 10 GiB paid) and their warnings arrive with PJ-27, which will count each original object once per company as the commercial policies require; the creation request is where admission will be checked.

## Data

All tables belong to the media module, with Prisma models in `prisma/schema/media.prisma`, semantic metadata, runtime grants and one reviewed migration.

| Table | Contents | Notes |
| --- | --- | --- |
| `media_objects` | `(company_id, sha256)` key, byte size, content type, created time | One row per stored file per company; publication and purge serialize on a transaction-scoped advisory lock per object |
| `media_assets` | `(company_id, id)`, optional composite `(company_id, branch_id)` reference, name, tags, kind, status, rejection reason, declared type and size, original/display/thumbnail object hashes (composite references to `media_objects`), inspected facts, processing stage/progress/attempts/lease, created-by membership, created/ready/archived/deleted/purge-after/purged times, version | Composite tenant references; runtime role never updates `company_id` or `branch_id` |
| `media_audit_events` | Company, actor, action, target asset, allowlisted details | Append-only; `media.created`, `media.uploaded`, `media.ready`, `media.failed`, `media.rejected`, `media.renamed`, `media.tagged`, `media.archived`, `media.restored`, `media.deleted`, `media.trash_restored`, `media.purged`, `media.discarded`. Details hold IDs, kinds, sizes and reason codes, never file names of other assets, hashes or paths |

Names, tags, inspected facts and the stored bytes are `CONFIDENTIAL`. The original file name is used as the default name only; it is not stored separately.

## Contracts

Human operations (session access, CSRF as elsewhere): `GET /companies/{companyId}/media` (paginated, cursor-bound; filters by kind, status, scope, tag and name text), `POST .../media` (create), `GET .../media/{assetId}`, `PUT .../media/{assetId}/content` (upload bytes), `GET .../media/{assetId}/content` (download a variant), `PATCH .../media/{assetId}` (name, tags, expected version), `POST .../media/{assetId}/archive`, `.../restore`, `.../delete`, `.../restore-deleted` and `DELETE .../media/{assetId}` (discard). All are TypeBox contracts in the OpenAPI document; the shared module contract gains the `application/octet-stream` request body and a binary response so the document describes them. The web uses the generated SDK except for the upload body, which it sends with `XMLHttpRequest` to report progress. New expected errors: `MEDIA_TYPE_UNSUPPORTED`, `MEDIA_TOO_LARGE`, `MEDIA_UPLOAD_INCOMPLETE`, `MEDIA_NOT_UPLOADING`, `MEDIA_NOT_READY`, `MEDIA_IN_USE`, `MEDIA_STORAGE_FULL`, `MEDIA_INVALID_STATE`, plus the existing `RESOURCE_NOT_FOUND`, `RESOURCE_VERSION_CONFLICT`, `RATE_LIMITED`, `VALIDATION_FAILED` and access errors. Rejection reasons (`MEDIA_TYPE_MISMATCH`, `MEDIA_TYPE_UNSUPPORTED`, `MEDIA_TOO_LARGE`, `MEDIA_DIMENSIONS_EXCEEDED`, `MEDIA_DURATION_EXCEEDED`, `MEDIA_UNREADABLE`, `MEDIA_CONVERSION_FAILED`) are a closed enumeration on the asset, not HTTP errors.

## Panel

A **Media** view per company (pt-BR "Mídia") shows a grid of thumbnails with name, kind, duration or dimensions, scope and state, with filters by kind, scope, tag and state and a name search, limited to what the person may view. **Upload** accepts several files (button or drag and drop), asks for the scope when the person may upload to more than one, shows per-file progress and then the preparation state, and explains rejections. The asset page shows the preview (image, or video with controls), facts, scope, tags and history of state, and offers rename, tags, archive and restore, delete with a confirmation naming the asset, and download of the original where allowed. Administrators see a **Trash** filter with restore. Copy is in `pt-BR` and `en-US`.

## Verification

- Domain unit tests: signature detection, declared-type matching, probe interpretation for every bound (axis, pixels, duration, frame rate, codecs, animation), the remux-or-transcode decision, lifecycle transitions and permission decisions.
- Processing tests with real FFmpeg against generated fixtures: JPEG with EXIF orientation and location metadata (rotated and stripped), PNG with transparency, oversized and over-pixel images, animated WebP, a spoofed extension, truncated and corrupted files, a polyglot file, compliant H.264 (remuxed), HEVC and VP9 (transcoded), portrait video with rotation metadata, a video over 60 minutes declared as short (rejected from the probe), and a timeout.
- Integration tests against PostgreSQL with two companies and differently scoped members: creation and upload allowed and denied by scope, company assets visible to branch members but not editable, ID substitution across companies, cursors, versions, size mismatch and interrupted uploads, abuse limits, concurrent processing claims, reference guards blocking delete and purge, purge after 30 days keeping objects still used by another asset, and audit rows.
- Delivery tests: authorization on every variant, range requests, headers, and no route answering for another company's asset.
- Browser component tests for the library, upload progress and the delete confirmation, and one end-to-end journey: upload an image and a video, wait until ready, preview, archive, delete and restore from trash.

## Delivery increments

1. Module, schema, migration, configuration, object store, upload, inspection, processor, renditions, list, detail, delivery, rename, tags, archive and restore, audit and the panel library with upload and preview.
2. Delete to trash, restore from trash, purge, reference port and guards, discard, maintenance (expired uploads, work files, orphan objects) and the trash view.
3. Explicit sharing with selected branches, storage accounting per company for PJ-27 and the end-to-end journey hardening.

## Implementation status

Implemented in [PJ-09](implementation-plan.md#current-work) on 2026-10-19, increments 1 and 2:

- The [`media` API module](../../apps/api/src/features/media/AGENTS.md), its reviewed migration (which also lets profiles delegate the media capabilities), runtime grants and schema metadata, the binary upload and content operations in the [OpenAPI document](../generated/api/openapi.json), and the `TELUNI_MEDIA_` settings. Without `TELUNI_MEDIA_STORAGE_PATH` the module stays unmounted.
- `media.view`, `media.upload`, `media.archive` and `media.delete` in the standard roles and as delegable profile capabilities (except `media.delete`).
- The in-process processor with leases, FFmpeg isolation and renditions; delete to trash, restore, discard, purge with reference guards and object sharing, and maintenance of expired uploads, work files and orphan objects. Programming and publications register their guards in PJ-10 and PJ-11.
- The [two-company integration suite](../../apps/api/test/media/integration.test.ts) processes generated fixtures with real FFmpeg against PostgreSQL as the runtime role, and [domain tests](../../apps/api/test/media/domain.test.ts) cover the bounds and the playback-profile decision.

Pending: increment 3 (explicit sharing with selected branches and storage accounting for PJ-27), a processing-timeout fixture, and the panel **Mídia** pages.

## Decisions for review

The owner approved each item as proposed on 2026-10-19 under [PH-23](human-actions.md#ph-23):

1. **Storage (ADR-0028).** Media on a configured local directory behind a media-owned object interface; immutable objects named by SHA-256 per company, deduplicated only within a company; atomic publish by rename under a database lock; the database is the authority; a free-space reserve of max(2 GiB, 10%).
2. **Processing tool and isolation (ADR-0028).** FFmpeg 6.1 or later as an external executable for probing, image and video renditions, run as child processes with no shell, a scrubbed environment, file-only protocol, forced demuxers, timeouts and optional `prlimit`; no image library inside the API process; an in-process PostgreSQL-leased processor with concurrency 1 by default.
3. **Accepted inputs.** Images JPEG, PNG and static WebP; videos in MP4/MOV or Matroska/WebM with H.264, HEVC, VP8, VP9, AV1 or MPEG-4 Part 2 video and AAC, MP3, Opus, Vorbis, FLAC or AC-3 audio; AT-02/AT-03 bounds plus at most 8,192 px per axis and 120 fps for video.
4. **Playback profile.** One display rendition per asset: H.264 High 4.1, at most 1080p30, AAC-LC stereo, MP4 faststart, remuxed when already compliant; images as JPEG or PNG within 3840×2160 with orientation applied and all metadata removed; originals kept but never sent to screens. Higher profiles only with device evidence.
5. **Upload transport.** A create request that admits the upload, then one streamed `PUT` of the whole file with an exact declared size; no resumable protocol now.
6. **Scope and permissions.** Company or single-branch ownership; `media.view`, `media.upload`, `media.archive` and `media.delete` as in the table, with `media.delete` administrators only and not delegable; explicit multi-branch sharing in a later increment.
7. **Lifecycle and purge.** Archive and restore; delete only from archive, blocked by protected references through registered guards; 30-day trash with restore; purge rechecks references and deletes objects no other asset uses; unusable uploads discarded immediately.
8. **Abuse limits.** 5 open uploads per person and 20 per company, 200 creations per company per day, 20 processing per company.
9. **Retention (provisional until PH-13).** Unfinished uploads discarded after one hour; rejected and failed assets kept until discarded; deleted assets purged no earlier than 30 days after deletion; purged rows and audit kept with the company.

Approval authorizes implementation of PJ-09 in local and CI environments with generated fixtures. It does not qualify any device profile (PH-08), select malware scanning or moderation (PH-13), or build the production image (PJ-13).

## Alternatives considered

- **`sharp` (libvips) for images.** Fast and well maintained, but it parses untrusted images inside the API process and adds a native dependency next to FFmpeg, which the videos need anyway. FFmpeg 6.1 applies EXIF orientation and strips metadata, so one isolated tool covers both kinds.
- **Object storage (S3-compatible, for example MinIO) now.** It would separate storage from the host, but adds a service to operate on a single-host pilot with no budget. ADR-0021 already keeps the interface replaceable.
- **Storing media in PostgreSQL large objects.** Transactional, but it inflates backups and database I/O with gigabytes of video and makes range reads and streaming harder.
- **Global deduplication across companies.** Saves space but lets one company infer that another holds a given file and couples tenant deletion; per-company deduplication keeps tenants independent.
- **Resumable uploads (tus) now.** Better for unstable connections, but adds a protocol and its state; deferred until measurements show the need.
- **Sending originals to screens and relying on device decoders.** Avoids conversion, but makes playback depend on every device's codec support, which FR-04 and the release policies rule out.
- **A separate processing service or queue broker.** Stronger isolation and scaling, but the pilot runs one process on one host (ADR-0021); child processes with timeouts and limits give isolation now, and a separate container is the deployment-level step in PJ-13.
