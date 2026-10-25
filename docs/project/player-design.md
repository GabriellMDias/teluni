# Teluni Android TV Player Design

[Offline playback and synchronization](playback-and-sync.md) · [Release policies](release-policies.md) · [Acceptance targets](release-targets.md) · [Device enrollment design](device-enrollment-design.md) · [Media library design](media-library-design.md) · [Programming design](programming-design.md) · [Publication and synchronization design](publication-sync-design.md) · [ADR-0019](../adr/0019-propose-immutable-publications-and-atomic-player-activation.md) · [ADR-0020](../adr/0020-propose-a-native-android-tv-player.md) · [ADR-0031](../adr/0031-build-the-player-on-a-portable-core-with-file-based-atomic-state-and-managed-installation.md)

## Status and scope

**Decided detailed design for D-07, 2026-10-20.** The owner delegated every pending decision to the agent on 2026-10-20 (recorded with [PH-25](human-actions.md#ph-25)). The agent took the [decisions](#decisions) below under that delegation, together with ADR-0031. Merging the pull request that adds this design is the repository review. The decisions authorize [PJ-12](implementation-plan.md#current-work) in local and CI environments. They do not qualify any device: hardware support, timings and power-loss behavior remain [PH-08](human-actions.md#ph-08) and PJ-14 evidence.

In scope: the player's components and build, installation and unattended operation, enrollment and credential storage on the device, synchronization, staging, activation and recovery, local storage, trusted time, enforcement of the authorization statement, schedule evaluation and playback of protocol 1 publications, orientation, neutral and setup output, erasure, updates and compatibility, diagnostics, the additions this needs in the sync response, and verification (FR-02, FR-03, FR-07, FR-08, NF-08).

Out of scope, with their owners: freeform areas, coordinated pages, multiple videos and audio mixing (PJ-20, D-11) and catalog views (PJ-21), which extend the manifest in a later protocol and reuse this player's storage, time and authorization; diagnostic uploads and alerts (D-09); commercial capping of authorization (PJ-27); the update channel's server-side release management and the production host (PJ-13); fades, which stay refused until a device profile qualifies them (PH-08).

## Policy inputs

The design applies these policies without changing them:

- Activate only a complete, verified generation; keep the active and previous valid generations and a valid staging attempt; preserve a free reserve of at least max(1 GiB, 10% of the volume) after planned use; refuse unsafe staging without deleting protected resources (ADR-0019, AT-05, AT-19).
- First cached output within 10 seconds after the OS starts the player, process recovery within 30 seconds, reboot to content within 120 seconds, and no mixed or incomplete active generation over at least 20 power cuts (AT-06 to AT-09).
- Seven days of offline playback with reboots, then neutral output at authorization expiry; trusted-time uncertainty of at most 60 seconds; detected incompatible clock jumps or an insufficient time reference suspend time-dependent output (AT-10, AT-15, AT-16).
- Detect a desired publication within 30 seconds, activate within 5 seconds once resources are verified, and change scheduled output within 500 ms of a boundary (AT-11 to AT-13).
- Per-device local business time with explicit IANA zones, inclusive starts and exclusive ends, the gap and repeated-hour resolutions, and fixtures shared with the backend preview ([time and scheduling](release-policies.md#time-and-scheduling)).
- Newly created areas start muted, and mixing audio needs deliberate configuration ([composition](release-policies.md#composition-and-regional-playback)).
- Unlink requires erasure on reconnection; another company pairs a new identity only after cleanup ([device enrollment](device-enrollment-design.md#device-lifecycle)).
- Controlled update distribution with a configurable window, qualified installation and recovery, and no untested app or data downgrade; support the current and previous protocol for at least 90 days after a transition (AT-26).

## Components

The player is a separate Gradle build in `apps/player`, outside the pnpm workspace, with two modules:

- **`core`** (Kotlin on the JVM, no Android dependency): the protocol models, the manifest parser, verification of authorization statements, the schedule evaluator, trusted time, the local generation store, the synchronization engine and the playback decisions (what plays now and until when). Everything with rules lives here, so it runs as fast JVM tests in CI, including the shared fixtures.
- **`app`** (Android): the activity and its screens, rendering with Media3 ExoPlayer, the Android Keystore credential vault, device-owner integration, boot and crash handling, and adapters that give `core` its clock, files and HTTP.

`core` talks to the API through OkHttp and parses JSON with kotlinx.serialization: strictly for manifests, whose format changes only with a new protocol, and ignoring unknown fields in API responses, which may gain fields compatibly. Statements are verified with Nimbus JOSE + JWT, an established implementation, restricted to `ES256`. The player never imports backend or web code; it depends on the published HTTP contracts and on the repository's shared test fixtures.

## Installation and unattended operation

Two installation profiles. PH-08 records which one each device model supports:

- **Managed (the supported profile for the pilot).** On a factory-reset device, an installer sideloads the APK and makes the player the device owner with `adb shell dpm set-device-owner`. The player is then the HOME activity and runs in lock task mode. It keeps the screen on while powered, disables the keyguard, starts at boot as the launcher, is relaunched by the system after a crash, and installs its updates without a confirmation prompt.
- **Basic.** The APK is sideloaded and chosen as the default HOME app where the device allows it. Updates need someone at the screen to confirm them. This profile counts as unattended only when PH-08 shows that it starts at boot and recovers from crashes on that model.

The activity is the only user interface. Each update and process start goes through the same startup sequence:

1. Read the state record and the stored statement.
2. Start output from the active generation, or neutral or setup output, within AT-06's 10 seconds.
3. Start synchronizing.

An uncaught exception is recorded locally (code and stack frames of the player only, never content or credentials) before the process ends. In the managed profile the system restarts the HOME activity, which AT-07 qualifies.

## Supported hardware envelope

Decided on 2026-10-22 under the owner's delegation (the decision part of [PH-08](human-actions.md#ph-08)). This is the envelope that devices are bought and qualified against. Only PH-08 measurements on a real model make that model supported.

- **Platform.** Android TV OS or Google TV, certified by Google (Play Protect certified) and homologated by Anatel, running Android 9 or later. `minSdk` stays 26, but Android 8 devices are not bought for the pilot because their security updates have ended. Smart TVs on other systems (Samsung Tizen, LG webOS, Roku) and Fire OS are outside the envelope. On those TVs an HDMI device inside the envelope is used instead.
- **Uncertified "TV box" devices** sold without Anatel homologation are excluded, even when they run Android. They often ship with modified firmware and preinstalled malware, which the device credential cannot protect against.
- **Form.** The pilot's reference class is a Google TV HDMI streaming device (for example a Xiaomi TV Box S, second generation), which works with whatever TV the customer already has. A TV with Google TV built in is qualified separately per model.
- **Minimums.** 2 GB of RAM, 8 GB of storage with at least 4 GB free for the media store after setup, hardware decoding of H.264 High 4.1 at 1080p30 with AAC, and 1080p HDMI output.
- **Network.** Ethernet where the installation allows it (through a USB adapter on sticks), otherwise 5 GHz Wi-Fi. Playback needs no bandwidth once a generation is staged; staging time grows with media size.
- **Installation.** The device must allow the managed profile: a factory reset, then `adb` over the network or USB to set the device owner before any Google account is added.
- **Orientation.** Landscape at 0 and 180 degrees on every model. Portrait (90 and 270) only on models where PH-08 shows the rotation works with hardware decoding.

## Enrollment and credential

The player follows the [device enrollment design](device-enrollment-design.md):

- It generates a 256-bit credential with `SecureRandom` and starts an enrollment with its SHA-256 and the device report: app version, protocols, manufacturer, model, OS version, display size and supported rotations.
- It shows the code as `XXXX-XXXX` in large type with the panel address, and polls the enrollment status at the interval the server gives.
- An expired code starts a new enrollment with a new credential, because a hash is never reused. Every enrollment starts from an empty store.

The credential is stored encrypted with AES-256-GCM under a key that Android Keystore creates and never exports. The ciphertext, IV and key alias live in an app-private file written atomically. Backup is disabled for the whole application (`allowBackup="false"` and data extraction rules that exclude everything), so neither the credential nor content leaves the device. A credential that cannot be decrypted (for example after a Keystore reset) counts as absent: the player erases its local state and enrolls again, and the panel then sees a new screen.

Erasure: when synchronization or `GET /device/self` answers `clearRequired`, the player stops protected output and any staging attempt, lets no exchange run meanwhile, and deletes media, generations, statements, keys, the state record and the credential file and Keystore key. Only then does it call `POST /device/self/erasure` with the credential it still holds in memory, and it returns to enrollment. If the confirmation fails, it retries while the process lives. A lost confirmation leaves the server's erasure pending, which the panel already shows as unconfirmed.

### Credential rotation

The player uses the existing `POST /device/self/credential` hash-only operation. A compatible player rotates once after its first successful active synchronization (including adoption of an older credential whose age is unknown), then every 30 days of anchored server time. This is a best-effort engineering cadence for the pilot, not a credential expiry or a new playback lease. A last-rotation time ahead of a fresh anchor is treated as due again; device wall time never schedules the operation. Suspended screens do not initiate a new rotation. Offline authorization and statement expiry remain unchanged.

The app-private encrypted vault is now a version 2 atomic bundle containing the current credential, an optional candidate and the last completed rotation time. It reads the earlier version 1 ciphertext with the same Keystore key and writes version 2 on the first rotation, preserving the pairing, publication state and cache. Both 32-byte secrets and the timestamp are authenticated and encrypted with AES-GCM; neither secret nor hash is reported or logged. Interrupted encrypted temporary files are removed along with the vault and key during erasure. The activation record format remains 1. Player version code 2 (`0.1.1`) establishes the forward vault transition; an older APK cannot read it and is not a supported rollback. Recovery remains a higher-version release, per the update policy.

The candidate must be durable before any server registration or proof request. The player registers only its hash, then proves the candidate through normal synchronization, which retires the old credential on the server. Only a valid synchronization answer is followed by local promotion of the candidate. A lost registration acknowledgement, a lost proof response or an interrupted local promotion leaves a complete bundle containing a usable secret. On restart, a pending candidate is tried first: explicit `DEVICE_UNAUTHORIZED` permits checking the current credential and registering the same candidate again; transport failures never cause a blind fallback to a possibly retired secret. An explicitly rejected candidate is discarded only after the current credential was proven usable. Unlink in either ambiguous phase still erases both secrets and confirms with the credential that received the clear instruction, held only in memory. Clearing requires neither a fresh vault promotion write nor a clock checkpoint. A failed private-file deletion raises an explicit error and prevents erasure confirmation; the process keeps output neutral, pauses staging and retries cleanup before another exchange. A pending credential remains available for cleanup recovery after a restart.

Rotation takes the existing staging-then-exchange lock order. It starts only at an idle staging boundary and otherwise defers without blocking normal synchronization; in-flight downloads therefore complete before the old credential is retired. An unresolved handover pauses new staging while cached output continues under its existing signed authorization. Expected failures use bounded retries and the Android adapter records only `CREDENTIAL_ROTATION_RETRY`, without payloads or credential material. Physical power-loss durability and hardware-backed Keystore qualification remain PH-08 evidence.

## Synchronization

The synchronization engine runs in the application process for as long as the player runs:

- It calls `POST /device/sync` at the server's `nextSyncSeconds` (30), with the report the [publication design](publication-sync-design.md#state-reports-and-monitoring) defines.
- After a failure it retries at 30 seconds, then doubles up to 2 minutes with ±20% jitter, and honors `Retry-After`. Connect and read timeouts are 10 and 30 seconds for sync, and 30 seconds of inactivity for downloads.
- Each successful response updates the trusted-time anchor, the zone offsets, the rotation and the statement, in that order, before any decision uses them.

When the desired publication differs from the active one and from the staging attempt, the engine starts staging it. A newer desired publication supersedes a staging attempt at once, and an attempt for a publication that is no longer desired (for example, after the destination returns to the active publication) is forgotten with the files only it used. Files the new publication also needs are kept, which coalesces superseded work as the policies allow. Staging:

1. **Manifest.** Download it, check that its size and SHA-256 match `desired`, and check that the latest valid statement lists that SHA-256. Parse it strictly as protocol 1. Unknown kinds or content types, fades, or anything the player cannot interpret fail as `INVALID_MANIFEST` or `INCOMPATIBLE`.
2. **Preflight.** First delete the files of a superseded attempt that the active, recovery and new staging generations do not use. Then add the bytes of media not yet in the store, counting shared files once. Refuse with `STORAGE_FULL` when the free space after the download would fall below the reserve. A publication whose media are all stored needs no room, so a schedule-only change activates even on a volume that is already below the reserve. Nothing protected is deleted to make room; the report carries the bytes needed.
3. **Download.** Fetch the missing media, at most two at a time and at most about 85 requests a minute, into `.part` files. The API's screen routes allow 120 requests per credential and minute, so the pace always leaves room for synchronization. A `RATE_LIMITED` answer waits for its `Retry-After` (at most 60 seconds) and retries the file, up to five times. Resume with single ranges from what a `.part` file holds; the API serves an immutable rendition per media item, and the final check covers resumed bytes. Check the length and SHA-256, flush the file to disk, then rename it into the content store and flush the directory. A complete `.part` file that does not match is downloaded again from the start; freshly downloaded bytes that do not match fail the attempt as `INTEGRITY_FAILED`. A `RESOURCE_NOT_FOUND` on a manifest or media request means the desired publication changed: the engine synchronizes again at once instead of retrying.
4. **Ready.** When every file is present and verified, the attempt is `READY` and activation follows (next section). Progress is reported in bytes.

## Local storage, activation and recovery

All state lives in app-private internal storage. There is no database: the few records the player keeps are files that are replaced atomically, which avoids schema migrations and makes power-loss behavior easy to test.

```text
files/
  state.json            atomically replaced: active, recovery and staging pointers, format version
  credential.bin        encrypted credential (Keystore-wrapped)
  keys.json             pinned statement keys (JWKS)
  statement.jws         latest verified statement
  sync.json             latest zone offsets, rotation, time anchor and lower bound
  generations/<publicationId>/manifest.json   exact manifest bytes
  media/<sha256>        content store, write-once, read-only
  media/<sha256>.part   download in progress
```

Each record is written to a temporary file, flushed with `fsync`, renamed over the old one and its directory flushed. A reader therefore sees either the old or the new record, never a mix. **Activation** is one such replacement of `state.json` that sets the staged publication active and the previous active one as recovery. It happens only when all of these hold:

- the staged generation is `READY`;
- its manifest is stored;
- the latest valid statement lists it;
- trusted time is available and the statement has not expired.

Output switches at once, like a schedule boundary (AT-12). After activation, files not referenced by the active, recovery or staging generation are deleted.

At startup, before output, the player reconciles its storage:

- It removes `.part` files that do not belong to the current staging attempt and media no generation references.
- It drops a pointer whose manifest file is missing.
- It falls back from a broken active generation to recovery, and from there to neutral output, reporting `DEGRADED`.

Media files were verified when they entered the store, so startup checks only their presence and size, which keeps AT-06. A background scrub re-hashes one file at a time at low priority. A decoding failure re-hashes that file at once. A mismatch deletes it, and the file is downloaded again if the publication is still desired; otherwise its items are skipped and `DEGRADED` is reported.

## Trusted time and zone offsets

Business time never comes from the device's wall clock or time zone database alone:

- **Anchor.** Each successful sync gives the server's `serverTime`. The player records it with the monotonic `elapsedRealtime` at the midpoint of the request, and the anchor's uncertainty is half the round trip. Responses with a round trip above 10 seconds do not replace a better anchor. Trusted now is the anchor's server time plus the monotonic time elapsed since. The monotonic clock keeps counting in deep sleep, and seven days of drift at a typical 50 ppm stays near 30 seconds, inside AT-16; qualification measures real devices.
- **Lower bound.** Every minute, and at each anchor, the player persists the latest trusted instant.
- **After a reboot without a server answer.** The monotonic clock restarts, so the anchor is lost. The player then accepts the system clock only when it is not earlier than the persisted lower bound and automatic network time is enabled. It reports the clock as estimated until the next sync. Otherwise it reports `CLOCK_UNTRUSTED` and shows neutral output until a sync succeeds. As the policies say, a wrong clock without a reference cannot always be detected; PH-08 measures the devices' real-time clock behavior.
- **Jumps.** While an anchor exists, the player uses it and ignores changes to the system clock. It reports a difference between the system clock and trusted time above 60 seconds as a diagnostic.

**Zone offsets.** Many Android TV devices stay on old time zone data; for example, a device without updates since 2019 still applies daylight saving time in `America/Sao_Paulo`. The player therefore uses the server's rules: each sync response adds `zoneOffsets`, the UTC offsets of the screen's zone from three days before `serverTime` to 35 days after it, as `{ "until": instant, "periods": [{ "from": instant, "offsetSeconds": n }] }`. The API computes them with the same Temporal API its evaluator uses. Preview and player then agree by construction. Evaluation reads windows from the local day before "now", up to about 62 hours back, so three days of history suffice. The 35 days ahead cover the seven-day authorization with room for look-ahead. The player resolves local times against these periods with exactly the server's rules: a gap resolves to its transition instant, and a repeated hour to the earlier occurrence for a start and the later for an end. An instant outside the covered range has no business time, so the player reports `CLOCK_UNTRUSTED` and shows neutral output. Offsets are not signed: they arrive over authenticated TLS, and the statement, not the offsets, bounds what may play.

## Authorization

The player trusts only statements it has verified:

- The header must be `ES256` with `typ` `teluni-authorization+jws` and a `kid` in the pinned key set.
- The signature must verify.
- `sub` and `company` must be the screen's own.
- `iat` must be earlier than `exp`.

Keys are pinned when the player first fetches `GET /device/keys` over TLS after pairing. A statement with an unknown `kid` triggers one fetch of the key set over TLS; a statement that still does not verify is ignored, and the previous statement stays in force until its own expiry. The player keeps only the latest verified statement. A statement older (by `iat`) than the stored one never replaces it, and nothing extends `exp` locally.

Protected output plays only while trusted time is before the stored statement's `exp` and the statement lists the manifest SHA-256 of the generation being played. An empty list, an expired statement or no statement gives neutral output: `AUTHORIZATION_EXPIRED` after expiry, `NEUTRAL` for an unpublished source. This is how an assignment to an unpublished destination reaches neutral output, and how a suspended company's screens stop at the latest expiry.

## Playback

**What plays.** Protocol 1 has one output, `screen`. The `core` evaluator is a port of the API's evaluator and is checked against the [shared fixtures](programming-design.md#shared-fixtures). It turns the active manifest's rules and default, the zone offsets and trusted now into the current segment and the instant of the next boundary. A segment plays a rule's playlist, the default playlist or neutral output. At each boundary the output changes at once, interrupting the current item (AT-13). Boundaries are timed on the monotonic clock, and the segment is evaluated again after any anchor or offset change. When a boundary keeps the same playlist, playback continues. A new segment with a different playlist starts it at its first item.

**Rendering.** Media3 ExoPlayer plays each playlist's items in order and loops:

- Images show for their `durationMs`, decoded at most at the output's size. Videos play their whole rendition.
- The next item is prepared while the current one plays, so a direct cut has no visible gap; qualification measures it.
- Content is fitted inside the output without distortion, on black.
- Protocol 1 plays muted, because the policies start areas muted and protocol 1 has no audio setting. Audio arrives with per-area volume in the composition protocol (PJ-20).

**Orientation.** The rotation comes with each sync response and from `GET /device/self`. Rotation 0 renders on a `SurfaceView`; 90, 180 and 270 rotate the content view, which needs a `TextureView` for video, as one coordinated transform. PH-08 qualifies each rotation per model.

**Failures.** An item that fails to decode is skipped for the rest of the segment, retried at the next segment, re-verified as above and reported as `DEGRADED`. When every item of the segment fails, the output is neutral until the next boundary. A failed staging never touches the active generation.

**Neutral and setup output.** Both are black screens with the Teluni mark and no tenant content:

- Setup output shows the pairing code, or a short state such as "connecting".
- Neutral output shows nothing else until someone presses OK on the remote. A status card then appears for 30 seconds with the screen name, the reported state, the last contact and the app version.
- Text follows the device locale, `pt-BR` or `en-US`, with `pt-BR` as the default.

## Updates and compatibility

- **Manifests.** The player declares its supported protocols in every sync. An incompatible manifest fails staging and keeps the active generation, and the report names the incompatibility. Protocol 2, for programs with a layout, is served beside protocol 1 rather than replacing it, so a player that supports 2 keeps supporting 1; `desired.protocol` lets an older player report `INCOMPATIBLE` without downloading. A protocol that replaces another is supported beside it for at least 90 days (AT-26).
- **Local state.** `state.json` carries a format version. Each release migrates older formats forward when it starts. A format the release does not know is not read: the player keeps the credential, discards content state and synchronizes again, which costs downloads but never mixes formats.
- **Releases (increment 4).** The API serves the release approved for the screen through two device operations: the release description (version code, size, SHA-256) and the APK. The player downloads it like media.
- **Installation.** The player verifies the APK's SHA-256 and that its signing certificate equals the installed one. It then installs through `PackageInstaller` inside the update window, by default 03:00 to 05:00 local business time, unless a release is marked urgent. Android refuses a lower version code, so the player never downgrades.
- **Rollback.** A rollback is a new release with a higher version code built from the earlier source and able to read the current state format.
- **Ownership.** The release signing key is a human-held secret ([PH-27](human-actions.md#ph-27)). Release approval and the update window are operational configuration (PJ-13).

## Server additions

PJ-11 increment 3 adds two fields to the `POST /device/sync` response, both compatible with existing clients:

- `zoneOffsets`, as above (three days back, 35 days ahead), or `null` when `timeZone` is `null`;
- `rotation`, the configured clockwise rotation (0, 90, 180 or 270).

The API also publishes protocol conformance fixtures in [`conformance.json`](../../apps/api/test/publications/conformance.json):

- a protocol 1 manifest as exact bytes with its SHA-256;
- a protocol 2 manifest as exact bytes with its SHA-256, with page cycles and effective prices to evaluate ([catalog and composition design](catalog-composition-design.md#publication-protocol-2));
- a key set and statements signed with throwaway keys whose private halves are discarded, including a rotated key and a tampered payload, stored in flattened JWS JSON serialization (RFC 7515) so secret scanners do not take these test vectors for live tokens;
- zone offsets with local-time resolutions, including gaps, repeated hours and a half-hour transition;
- the zone offsets of every shared schedule fixture.

`pnpm -C apps/api conformance:write` writes the file with the API's own serializer, signer and zone rules. The API's tests check that the committed file still matches that code, and the player's `core` tests parse and verify the same file.

## Diagnostics and privacy

The player sends nothing beyond the sync report and erasure confirmation; diagnostic uploads are D-09. Logcat output is limited to states, error codes and publication IDs. It never contains credentials, statements, manifests, media, URLs with credentials or the pairing code after pairing. The status card shows only the screen name and states. Crash evidence stays in the app-private `player/diagnostics.json` record, written atomically. It retains only the latest 20 allowlisted player code frames (class, method and nonnegative line number), never the exception message, cause, filename, thread name or foreign frames. Only the cumulative count is reported. Process restarts and power loss are not inferred as uncaught exceptions. The count saturates at 2,147,483,647; an unreadable or unknown record reports `null`, not zero. Starting enrollment and erasure remove the whole player store, including this evidence. The earlier uncounted diagnostic location is removed at app startup. Counts cover failures recorded by a compatible version during the current pairing; prior versions' unrecorded crashes cannot be reconstructed.

An optional `diagnostics` object in the sync report contains `clock` (`ANCHORED`, `ESTIMATED` or `UNTRUSTED`), `systemSkewMillis` and `crashCount`. Skew is system wall time minus anchored business time, with its sign and millisecond precision. It is `null` without an anchor or outside JSON's exact integer range. Estimated time never invents a zero skew. A device wall date outside the four-digit RFC 3339 year range reports `deviceTime: null` so a broken local clock cannot block synchronization from restoring its server reference. The panel shows these as screen-reported facts, displays unknown values explicitly and explains a skew above 60 seconds. These fields never influence server authorization, statement expiry or playback decisions. Changes update only the latest screen state; diagnostic history, uploads and alerts remain D-09.

Rollout order: apply the additive `20261024010000_player_diagnostics` migration and the publications runtime grants, deploy the API, then install the new player. Existing players may omit diagnostics; the API returns `null` and clears previously reported diagnostic values when the latest report omits them. Existing database rows stay unknown without a fabricated backfill. The API normalizes the report to its allowlisted schema and rejects invalid values or non-null skew without an anchored clock. The manifest protocols and local activation state format are unchanged. The constraint validates existing rows while the migration holds its table lock; production lock duration has not been measured.

## Build, dependencies and CI

- **Build.** Gradle with the Kotlin DSL, a wrapper pinned with its distribution SHA-256, a version catalog, dependency locking and Gradle dependency verification with SHA-256 checksums for every artifact. Renovate updates the catalog.
- **Toolchain.** JDK 17. `minSdk` 26 (Android 8.0), which gives `java.time`, current Keystore APIs and `java.nio.file` without desugaring. `compileSdk` and `targetSdk` follow the newest stable platform.
- **Dependencies.** `core` uses Kotlin, kotlinx.serialization, OkHttp and Nimbus JOSE + JWT, and runs its own work on blocking calls and a two-thread download pool. `app` adds Media3 and the AndroidX libraries it needs. Tests use JUnit Jupiter and OkHttp's MockWebServer for `core`, and JUnit 4 with Robolectric for `app`.
- **CI.** A `Player` job sets up JDK 17, validates the Gradle wrapper and runs `./gradlew check :app:assembleDebug :app:assembleRelease` on every pull request, joining the required gate. `core` needs only the JDK. `app` adds the Android SDK that GitHub's Ubuntu runners provide, and its unsigned release build. The root `pnpm validate` does not require Android tooling; `apps/player/README.md` lists the Gradle commands.
- **Dependency hosts.** Building `app` needs Google's Maven repository, which redirects to `dl.google.com`. The current cloud development environment refuses that host ([PH-26](human-actions.md#ph-26)), so `app` can be written and verified only after it is allowed or on a developer machine. `core` builds with Maven Central and the Gradle plugin portal.

## Verification

- **`core` unit tests:**
  - every case of the shared schedule fixtures through the Kotlin evaluator, with the API's zone offsets for each case from the conformance file, so the tests use the same offsets a device would receive;
  - local-time resolution against offset periods with gaps, repeated hours and the handoff clip;
  - parsing of the conformance manifest and strict rejection of malformed and unknown content;
  - statement verification with the conformance key set: wrong algorithm, `typ`, `kid`, subject, company, expiry, tampered payload and rotated keys;
  - trusted time across anchors, reboots, lower bounds, jumps and expiry;
  - the store's atomic replacement, with faults injected at every write step;
  - startup reconciliation from every crash point;
  - staging, superseding, preflight and the reserve, resume, integrity failures and activation against MockWebServer;
  - the playback decision for segments, boundaries, authorization and neutral output.
- **API tests:** the committed conformance file still matches the API's serializer, signatures and zone rules, `zoneOffsets` match Temporal for zones with and without DST, and the sync response carries the offsets and rotation.
- **`app` tests:** Robolectric tests for the vault adapter's error paths, the activity's states and the device-owner calls that Robolectric supports. An emulator smoke test (Android TV image) pairs against a local API, plays a publication and survives a process kill, when CI can host the emulator.
- **Hardware qualification (PH-08, PJ-14):** AT-04, AT-06 to AT-13 and AT-16 on each candidate model, including at least 20 power cuts across download, preparation, activation and playback, seven days offline with reboots, every rotation, and the managed profile's boot and crash recovery.

## Delivery increments

1. `core`: the Gradle build, protocol models and manifest parser, statement verification, the evaluator with the shared fixtures, zone-offset resolution, trusted time, the store with fault injection, the synchronization engine and playback decisions, and the CI job. On the API: `zoneOffsets` and `rotation` in the sync response and the conformance fixtures.
2. `app`: the activity, setup and neutral output, enrollment, the Keystore vault, the synchronization service, ExoPlayer rendering, orientation and erasure, the managed profile's device-owner integration and an installation guide, with Robolectric tests and the emulator smoke where possible.
3. Qualification on PH-08 hardware with the measurements above, plus fixes found there.
4. Update distribution (the API release operations and the installer).

## Implementation status

Increment 1, started 2026-10-20 in [PJ-12](implementation-plan.md#current-work):

- **API.** `zoneOffsets` and `rotation` in the sync response, and the [conformance file](../../apps/api/test/publications/conformance.json) with its writer and test (see [server additions](#server-additions)).
- **Build.** The Gradle build in [`apps/player`](../../apps/player/README.md) with its wrapper (initially Gradle 8.14.3; now 9.6.0 for the Android application), version catalog, dependency locks and SHA-256 verification metadata, and the **Player** CI job in the required gate.
- **`core`:**
  - the evaluator, run against every shared schedule fixture with the API's offsets;
  - local-time resolution against offsets;
  - the strict protocol 1 manifest parser;
  - ES256 statement verification with Nimbus, checked against the API's statements;
  - trusted time;
  - the store with atomic records and fault injection at every write step;
  - the OkHttp device API, with its field names checked against the OpenAPI document;
  - the engine (enrollment, synchronization, key rotation, staging with resumable verified downloads and the AT-05 reserve, superseding, activation, startup recovery, erasure);
  - the playback planner.
- **Tests.** 79 JVM tests, including the engine against an in-memory API that signs real statements.

With protocol 2 (the [catalog and composition design](catalog-composition-design.md#implementation-status), increment 3), the same day: the device API reads the sync answer's `branchId` and `desired.protocol`; `core` declares protocols 1 and 2, refuses a desired publication of another protocol as `INCOMPATIBLE` before downloading it, parses and checks protocol 2 manifests strictly, and plans what each area of a layout shows (schedules, the page cycle, catalog view pages and effective prices for the screen's branch). A failed staging attempt now returns only after its other downloads stop, so a retry never writes the same partial file at the same time. 90 JVM tests. Drawing layouts, catalog text and mixed audio is the Android `app` (increment 2) and its qualification (increment 3).

Increment 2, started locally on 2026-10-24 at the owner's request to implement and run the player in an emulator:

- The `app` module builds debug and unsigned release APKs with Android Gradle Plugin 9.4.1, Gradle 9.6.0, SDK 37 and Media3 1.11.1. Dependencies, including Robolectric's API 35 platform, are locked and checksum-verified. The API 26 runtime floor is unchanged.
- Android adapters provide `elapsedRealtime`, automatic-time/boot-count readings, the Keystore AES-256-GCM vault, a foreground synchronization service and bounded crash diagnostics. Pairing, staging, signature/hash checks, expiry, schedules and page/price decisions remain in core.
- The TV activity provides endpoint setup, code-based enrollment, neutral output and a 30-second status card. Media3 renders cached images/video, protocol 2 areas, independent playlists, page-held media and per-area volume; catalog views consume the planner's pages and branch prices. Texture surfaces permit compositing and all four output rotations. Unchanged playlists retain their playback positions.
- Managed installation configures HOME and lock task only after Android reports actual device ownership. Ordinary debug installation does not grant ownership. Backup/transfer are disabled; only debug builds accept HTTP to the exact emulator/loopback addresses. Release builds require HTTPS.
- The [player guide](../../apps/player/README.md) documents installation, configuration, limitations and `pnpm player:dev`, which builds, starts/reuses the emulator, installs and opens the app.
- **Local verification (2026-10-24):** the strict `./gradlew --no-daemon check :app:assembleDebug :app:assembleRelease` gate passed with 91 core tests, 12 Android adapter/UI tests and Android lint, without dependency-write flags. `pnpm player:dev` successfully rebuilt, installed and opened the debug APK. On the Android TV API 36 x86_64 emulator, the real local panel/API paired the player, processed and published an image/video playlist, and activated protocol 1. A protocol 2 publication then rendered that media alongside a catalog with a BRL branch override of 17.90. A process restart while the local API was paused preserved the encrypted credential, paired identity and active generation, and continued showing the video/catalog while reporting offline. Unlinking deleted the old player state and was confirmed by the API; the player enrolled again and was paired to the demo company. No physical device or release key was used.
- Review fixes include currency-derived minor-unit formatting (the optional `decimals` property describes number fields, not money), a shared-conformance catalog rendering regression, TV focus/window initialization, private-data exclusions for all backup/transfer domains and bounded render-failure output. Core retains an erased credential only in memory while retrying a lost erasure confirmation; a test verifies no private state is restored.
- **Repository checks (2026-10-24):** frozen installation and every `pnpm validate` stage before E2E passed, including 334 API, 73 web unit and 98 browser component tests, builds, bundle isolation, smoke and generated-reference checks. The initial E2E run had 43 passes and six failures (simulated enrollment returned 404; portal cases timed out while the emulator/Gradle were consuming workstation resources). With those workloads stopped, all six failed cases passed unchanged through `pnpm -C apps/web exec playwright test --last-failed`. This is a failed initial full run plus a successful focused recheck, not a single green full-gate execution; the precise cause of the transient 404 remains unproven. No remote CI run is claimed. Documentation generation/freshness and link checks were rerun after recording this evidence. Local downloads succeeded, so PH-26's historical cloud network restriction does not block this machine. Release signing, real managed-device boot/crash recovery, multi-decoder/audio capacity, all-rotation qualification, catalog typography/overflow profiles, long offline runs, physical reboot and power-cut measurements remain unqualified; the emulator journey does not close those PH-08/PJ-14 gates.

Stored-media integrity follow-up, implemented locally on 2026-10-24 under the owner's instruction to continue development:

- Core scrubs one referenced file per call in a rotating order, outside the playback lock. Android schedules checks at background priority (after 10 seconds, then every 60 seconds) and queues the affected file after Media3/image decoding fails. Checks serialize with staging so they cannot delete a replacement being committed, and yield to erasure. No media identifiers, paths or decoder details enter logs or reports.
- Missing, unreadable and hash-mismatched files are excluded from authorized output and deleted. Remaining playlist items, independent areas and catalog text continue with `DEGRADED`; an empty single-output playlist becomes neutral. Authorization expiry and trusted-time requirements still take precedence. A subsequent exchange requests repair even when the desired publication equals the active one, downloading only affected files and preserving activation/recovery pointers. An intact file rejected by a decoder is not downloaded again. Process-local per-file repair revisions make renderers reopen repaired media even when a repair finishes between rendering ticks; they do not change the manifest, authorization or persisted state format. Unaffected catalog text keeps its existing views, and only changed catalog bitmaps are refreshed. Startup still checks only presence and size; physical storage-fault/timing qualification remains PH-08.
- **Verification (2026-10-24):** the strict Gradle gate passed with 102 core tests and 13 Android tests (115 total), Android lint and both APK builds. Frozen pnpm installation and a complete `VITEST_MAX_WORKERS=1 pnpm validate` execution passed, including 334 API tests, 73 web unit tests, 98 browser component tests and all 49 E2E tests without a retry. This supplies a fully green local repository run after the initial increment 2 run described above; remote CI was not run.
- **Emulator fault exercise (2026-10-24):** `pnpm player:dev` installed the updated debug APK on the existing Android TV API 36 emulator. A byte of a local demo image was altered without changing its size, then the app was restarted while the local API process was paused. The scrub removed the file, intact video/catalog output continued and the partial-media recovery message appeared. After resuming the API, the player downloaded bytes matching the original SHA-256 and returned to playing status. The credential ciphertext, active/recovery pointers and original activation timestamp were unchanged. Raster captures confirmed the catalog text remained visible during and after recovery. Review found that rebuilding an unaffected catalog could lose its visible text; preserving its views and refreshing only affected bitmaps fixes that case, protected by an Android regression. Another core regression covers a repair completed before the renderer observes the damaged plan; the strict Gradle gate was rerun successfully after these corrections. File absence was checked through ADB's shell protocol with remote exit status; this was a paused local API exercise, not physical network, storage-fault or power-cut qualification. Hardware and release-signing gates remain open.

Player diagnostic follow-up (2026-10-24, PJ-11/PJ-12): clock reference and signed system skew, pairing-scoped crash accounting, nullable bounded API persistence and the localized screen detail are implemented. The additive migration and runtime grants preserve older writers; generated OpenAPI, database references and SDK follow their canonical sources. The strict Gradle gate passed 109 core and 14 Android tests, lint and both APK builds. The 12-test publications integration suite passed with legacy/null round trips, tenant isolation, safe signed deadlines, invalid-input and PostgreSQL constraint cases. Frozen installation and the complete local `VITEST_MAX_WORKERS=1 pnpm validate` gate passed: 337 API tests, 73 web unit tests, 105 browser component tests and all 49 E2E tests without retries, plus the static, reference, build and smoke checks. The additive migration and updated runtime grants were applied to the persistent local development database. On the Android TV API 36 emulator, a controlled uncaught exception incremented the durable count, and the restarted app reported it to the real panel/API while preserving its identity, encrypted credential and active/recovery pointers. Captures confirmed video/catalog playback after recovery and readable screen diagnostics in both themes and at 390 px; automated accessibility checks found no violations or mobile overflow. Private crash frames were absent from the reported payload. These results qualify the local increment only; no production, physical-device or remote CI result is claimed.

Credential rotation follow-up (2026-10-25, PJ-12): the core performs the durable handover above through the existing hash-only API. The Android vault reads version 1 and atomically writes encrypted version 2 bundles; APK version code 2 is `0.1.1`. The strict Gradle gate passed 121 core and 17 Android tests, lint and both APK builds. Cases cover overlap, lost acknowledgements/proofs, rejected candidates, interrupted writes, restart, unlink without new vault/clock writes, failed deletion with neutral output and no premature confirmation, cached playback and deferral during downloads; wire models match OpenAPI. The Android TV API 36 emulator upgraded the existing debug installation without changing its legacy ciphertext before startup, then completed the encrypted vault migration and server credential replacement. A restart reused the new credential without another rotation; identity, active/recovery pointers and crash accounting were preserved, and the real API reported video/catalog playback. No secret or hash was written to the verification output.

Frozen installation and `VITEST_MAX_WORKERS=1 pnpm validate` passed every stage before E2E, including 342 API tests, 73 web unit tests, 109 browser component tests, static/reference checks, builds and smoke. The E2E stage had 48 passes and one five-second heading timeout after the documentation test deliberately aborted a lazy chunk. With Gradle finished, all 19 documentation E2E cases passed unchanged in a separate execution, including that recovery case; no assertion or timeout was weakened. This is a failed initial full gate followed by a successful portal recheck, not one green full-gate execution; the timeout's underlying cause remains unproven. Final documentation was regenerated and checked after recording the evidence. No remote CI, physical-device, production signing or distribution result is claimed.

Still pending: physical qualification (increment 3, [PH-08](human-actions.md#ph-08)) and update distribution/installation (increment 4, [PH-27](human-actions.md#ph-27)).

## Decisions

The agent took these decisions on 2026-10-20 under the owner's delegation:

1. **Components.** One Gradle build in `apps/player` with a pure-JVM `core` holding every rule and an Android `app` holding the platform adapters (ADR-0031). It sits outside the pnpm workspace, is checked by its own required CI job and reads the repository's shared fixtures.
2. **Unattended operation.** The managed profile (device owner, HOME activity, lock task) is the supported pilot profile. The basic profile counts only where PH-08 shows boot and crash recovery.
3. **File-based state.** No database: write-once content-addressed media, exact manifests and one atomically replaced state record. Activation is a single replacement, and startup reconciliation is deterministic (ADR-0031).
4. **Credential vault.** AES-256-GCM under a non-exportable Android Keystore key, backup disabled. An unreadable vault means erase and enroll again.
5. **Server zone offsets.** The sync response carries the screen zone's offsets for 35 days, and the player never uses device time zone data for business time (ADR-0031).
6. **Trusted time.** A monotonic anchor from each sync, a persisted lower bound, and the system clock after a reboot only when it is not earlier than that bound and automatic network time is on; otherwise neutral output with `CLOCK_UNTRUSTED`.
7. **Authorization.** Keys pinned at pairing and refreshed over TLS only for an unknown `kid`. Only the latest verified statement counts. Protected output needs an unexpired statement listing the playing generation.
8. **Staging.** Strict protocol 1 parsing, preflight against the AT-05 reserve, at most two resumable downloads verified by length and SHA-256, superseding by newer desired publications, and activation immediately when ready.
9. **Playback.** ExoPlayer for images and videos with the next item prepared, fit without distortion, muted in protocol 1, schedule boundaries timed on the monotonic clock, and failed items skipped and reported.
10. **Updates.** Server-distributed APKs verified by SHA-256 and signing certificate, installed by the device owner inside a local window. No downgrade: rollback is a roll-forward release (ADR-0031).
11. **Platform floor.** `minSdk` 26 and JDK 17. Dependencies: Kotlin, kotlinx.serialization, OkHttp and Nimbus JOSE + JWT in `core`, and Media3 in `app`, all pinned and checksum-verified.
12. **Hardware envelope (2026-10-22, same delegation).** Certified Android TV or Google TV devices with Android 9 or later, Anatel homologation, 2 GB of RAM, 8 GB of storage and H.264 1080p30 hardware decoding. A Google TV HDMI device is the pilot's reference class. Uncertified TV boxes and non-Android smart TVs are excluded ([envelope](#supported-hardware-envelope)).

## Alternatives considered

- **Room or another database for local state.** Gives queries and transactions, but brings schema migrations that interact with the no-downgrade rule. Its write-ahead log still needs power-loss testing, and the state is a handful of pointers. Atomic file replacement is simpler to reason about and to fault-test.
- **Device time zone data, or a bundled time zone library (ThreeTenBP, Joda-Time).** Device data can be years old on unmanaged TV boxes. A bundled database updates only with player releases and can still disagree with the server's preview. Offsets computed by the same server code that renders the preview cannot disagree, and need no dependency.
- **A WebView or web player.** Reuses web skills, but leaves storage, autostart, power-loss behavior and hardware decoding to the browser on each device. ADR-0020 already chose a native player.
- **Google Play distribution and in-app updates.** Requires store accounts, review and a Google account on each device. It does not give unattended updates inside a business window, and many commercial Android TV boxes do not have Play. It remains possible later for devices that do.
- **A hand-written JWS verifier.** The format is small, but the policies forbid custom cryptographic schemes. Nimbus restricts algorithms, parses keys and handles the signature encoding with an established implementation.
- **Starting at boot with a `BOOT_COMPLETED` receiver.** Android 10 and later block background activity starts without special permissions that TV devices often cannot grant. A device-owner HOME activity starts and restarts reliably.
- **Certificate pinning for the API.** Would brick screens when the pilot host's certificate or provider changes. TLS with the system trust store plus pinned statement keys protects what matters offline.
