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

## Enrollment and credential

The player follows the [device enrollment design](device-enrollment-design.md):

- It generates a 256-bit credential with `SecureRandom` and starts an enrollment with its SHA-256 and the device report: app version, protocols, manufacturer, model, OS version, display size and supported rotations.
- It shows the code as `XXXX-XXXX` in large type with the panel address, and polls the enrollment status at the interval the server gives.
- An expired code starts a new enrollment with a new credential, because a hash is never reused.

The credential is stored encrypted with AES-256-GCM under a key that Android Keystore creates and never exports. The ciphertext, IV and key alias live in an app-private file written atomically. Backup is disabled for the whole application (`allowBackup="false"` and data extraction rules that exclude everything), so neither the credential nor content leaves the device. A credential that cannot be decrypted (for example after a Keystore reset) counts as absent: the player erases its local state and enrolls again, and the panel then sees a new screen.

Erasure: when synchronization or `GET /device/self` answers `clearRequired`, the player stops protected output and deletes media, generations, statements, keys, the state record and the credential file and Keystore key. Only then does it call `POST /device/self/erasure` with the credential it still holds in memory, and it returns to enrollment. If the confirmation fails, it retries while the process lives. A lost confirmation leaves the server's erasure pending, which the panel already shows as unconfirmed.

## Synchronization

The synchronization engine runs in the application process for as long as the player runs:

- It calls `POST /device/sync` at the server's `nextSyncSeconds` (30), with the report the [publication design](publication-sync-design.md#state-reports-and-monitoring) defines.
- After a failure it retries at 30 seconds, then doubles up to 2 minutes with ±20% jitter, and honors `Retry-After`. Connect and read timeouts are 10 and 30 seconds for sync, and 30 seconds of inactivity for downloads.
- Each successful response updates the trusted-time anchor, the zone offsets, the rotation and the statement, in that order, before any decision uses them.

When the desired publication differs from the active one and from the staging attempt, the engine starts staging it. A newer desired publication supersedes a staging attempt at once. Files the new publication also needs are kept, which coalesces superseded work as the policies allow. Staging:

1. **Manifest.** Download it, check that its size and SHA-256 match `desired`, and check that the latest valid statement lists that SHA-256. Parse it strictly as protocol 1. Unknown kinds or content types, fades, or anything the player cannot interpret fail as `INVALID_MANIFEST` or `INCOMPATIBLE`.
2. **Preflight.** Add the bytes of media not yet in the store, counting shared files once. Refuse with `STORAGE_FULL` when the free space after the download would fall below the reserve. Nothing protected is deleted to make room; the report carries the bytes needed.
3. **Download.** Fetch the missing media, at most two at a time, into `.part` files. Resume with single ranges and the manifest's SHA-256 as the expected `ETag`. Check the length and SHA-256, flush the file to disk, then rename it into the content store and flush the directory. A `RESOURCE_NOT_FOUND` on a manifest or media request means the desired publication changed: the engine synchronizes again at once instead of retrying.
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

**Zone offsets.** Many Android TV devices stay on old time zone data; for example, a device without updates since 2019 still applies daylight saving time in `America/Sao_Paulo`. The player therefore uses the server's rules: each sync response adds `zoneOffsets`, the UTC offsets of the screen's zone from two days before `serverTime` to 35 days after it, as `{ "until": instant, "periods": [{ "from": instant, "offsetSeconds": n }] }`. The API computes them with the same Temporal API its evaluator uses. Preview and player then agree by construction, and the 35 days cover the seven-day authorization with room for look-ahead. The player resolves local times against these periods with exactly the server's rules: a gap resolves to its transition instant, and a repeated hour to the earlier occurrence for a start and the later for an end. An instant outside the covered range has no business time, so the player reports `CLOCK_UNTRUSTED` and shows neutral output. Offsets are not signed: they arrive over authenticated TLS, and the statement, not the offsets, bounds what may play.

## Authorization

The player trusts only statements it has verified:

- The header must be `ES256` with `typ` `teluni-authorization+jws` and a `kid` in the pinned key set.
- The signature must verify.
- `sub` and `company` must be the screen's own.
- `iat` must be earlier than `exp`.

Keys are pinned when the player first fetches `GET /device/keys` over TLS after pairing. A statement with an unknown `kid` triggers one fetch of the key set over TLS; a statement that still does not verify is ignored and reported. The player keeps only the latest verified statement. A statement older (by `iat`) than the stored one never replaces it, and nothing extends `exp` locally.

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

- **Manifests.** The player declares its supported protocols in every sync. An incompatible manifest fails staging and keeps the active generation, and the report names the incompatibility. When protocol 2 arrives, a new player supports 1 and 2 for at least 90 days (AT-26).
- **Local state.** `state.json` carries a format version. Each release migrates older formats forward when it starts. A format the release does not know is not read: the player keeps the credential, discards content state and synchronizes again, which costs downloads but never mixes formats.
- **Releases (increment 4).** The API serves the release approved for the screen through two device operations: the release description (version code, size, SHA-256) and the APK. The player downloads it like media.
- **Installation.** The player verifies the APK's SHA-256 and that its signing certificate equals the installed one. It then installs through `PackageInstaller` inside the update window, by default 03:00 to 05:00 local business time, unless a release is marked urgent. Android refuses a lower version code, so the player never downgrades.
- **Rollback.** A rollback is a new release with a higher version code built from the earlier source and able to read the current state format.
- **Ownership.** The release signing key is a human-held secret ([PH-27](human-actions.md#ph-27)). Release approval and the update window are operational configuration (PJ-13).

## Server additions

PJ-11 increment 3 adds two fields to the `POST /device/sync` response, both compatible with existing clients:

- `zoneOffsets`, as above, or `null` when `timeZone` is `null`;
- `rotation`, the configured clockwise rotation (0, 90, 180 or 270).

The API also publishes protocol conformance fixtures next to its tests: a protocol 1 manifest as exact bytes with its SHA-256, a key set and statements signed with a fixed test key, and zone-offset examples. The API's tests produce and verify them, and the player's `core` tests parse and verify the same files. These test keys sign nothing else.

## Diagnostics and privacy

The player sends nothing beyond the sync report and erasure confirmation; diagnostic uploads are D-09. Logcat output is limited to states, error codes and publication IDs. It never contains credentials, statements, manifests, media, URLs with credentials or the pairing code after pairing. The status card shows only the screen name and states. Crash records stay on the device and are counted in a later report field, not uploaded.

## Build, dependencies and CI

- **Build.** Gradle with the Kotlin DSL, a wrapper pinned with its distribution SHA-256, a version catalog, dependency locking and Gradle dependency verification with SHA-256 checksums for every artifact. Renovate updates the catalog.
- **Toolchain.** JDK 17. `minSdk` 26 (Android 8.0), which gives `java.time`, current Keystore APIs and `java.nio.file` without desugaring. `compileSdk` and `targetSdk` follow the newest stable platform.
- **Dependencies.** Kotlin, kotlinx.serialization, kotlinx.coroutines, OkHttp, Nimbus JOSE + JWT and Media3. Tests use JUnit 5 and OkHttp's MockWebServer for `core`, and JUnit 4 with Robolectric for `app`.
- **CI.** A `Player` job sets up JDK 17, validates the Gradle wrapper and runs `./gradlew check` on every pull request, joining the required gate. `core` needs only the JDK. `app` adds the Android SDK that GitHub's Ubuntu runners provide, and its unsigned release build. The root `pnpm validate` does not require Android tooling; `apps/player/README.md` lists the Gradle commands.
- **Dependency hosts.** Building `app` needs Google's Maven repository, which redirects to `dl.google.com`. The current cloud development environment refuses that host ([PH-26](human-actions.md#ph-26)), so `app` can be written and verified only after it is allowed or on a developer machine. `core` builds with Maven Central and the Gradle plugin portal.

## Verification

- **`core` unit tests:**
  - every case of the shared schedule fixtures through the Kotlin evaluator, with zone offsets built from the JDK's rules for the fixture zones;
  - local-time resolution against offset periods with gaps, repeated hours and the handoff clip;
  - parsing of the conformance manifest and strict rejection of malformed and unknown content;
  - statement verification with the conformance key set: wrong algorithm, `typ`, `kid`, subject, company, expiry, tampered payload and rotated keys;
  - trusted time across anchors, reboots, lower bounds, jumps and expiry;
  - the store's atomic replacement, with faults injected at every write step;
  - startup reconciliation from every crash point;
  - staging, superseding, preflight and the reserve, resume, integrity failures and activation against MockWebServer;
  - the playback decision for segments, boundaries, authorization and neutral output.
- **API tests:** the conformance fixtures are produced and verified by the API, and `zoneOffsets` match Temporal for zones with and without DST.
- **`app` tests:** Robolectric tests for the vault adapter's error paths, the activity's states and the device-owner calls that Robolectric supports. An emulator smoke test (Android TV image) pairs against a local API, plays a publication and survives a process kill, when CI can host the emulator.
- **Hardware qualification (PH-08, PJ-14):** AT-04, AT-06 to AT-13 and AT-16 on each candidate model, including at least 20 power cuts across download, preparation, activation and playback, seven days offline with reboots, every rotation, and the managed profile's boot and crash recovery.

## Delivery increments

1. `core`: the Gradle build, protocol models and manifest parser, statement verification, the evaluator with the shared fixtures, zone-offset resolution, trusted time, the store with fault injection, the synchronization engine and playback decisions, and the CI job. On the API: `zoneOffsets` and `rotation` in the sync response and the conformance fixtures.
2. `app`: the activity, setup and neutral output, enrollment, the Keystore vault, the synchronization service, ExoPlayer rendering, orientation and erasure, the managed profile's device-owner integration and an installation guide, with Robolectric tests and the emulator smoke where possible.
3. Qualification on PH-08 hardware with the measurements above, plus fixes found there.
4. Update distribution (the API release operations and the installer), credential rotation, and the crash count in reports.

## Implementation status

Not implemented. PJ-12 starts with increment 1.

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
11. **Platform floor.** `minSdk` 26 and JDK 17. Dependencies: Kotlin, kotlinx.serialization, kotlinx.coroutines, OkHttp, Nimbus JOSE + JWT and Media3, pinned and checksum-verified.

## Alternatives considered

- **Room or another database for local state.** Gives queries and transactions, but brings schema migrations that interact with the no-downgrade rule. Its write-ahead log still needs power-loss testing, and the state is a handful of pointers. Atomic file replacement is simpler to reason about and to fault-test.
- **Device time zone data, or a bundled time zone library (ThreeTenBP, Joda-Time).** Device data can be years old on unmanaged TV boxes. A bundled database updates only with player releases and can still disagree with the server's preview. Offsets computed by the same server code that renders the preview cannot disagree, and need no dependency.
- **A WebView or web player.** Reuses web skills, but leaves storage, autostart, power-loss behavior and hardware decoding to the browser on each device. ADR-0020 already chose a native player.
- **Google Play distribution and in-app updates.** Requires store accounts, review and a Google account on each device. It does not give unattended updates inside a business window, and many commercial Android TV boxes do not have Play. It remains possible later for devices that do.
- **A hand-written JWS verifier.** The format is small, but the policies forbid custom cryptographic schemes. Nimbus restricts algorithms, parses keys and handles the signature encoding with an established implementation.
- **Starting at boot with a `BOOT_COMPLETED` receiver.** Android 10 and later block background activity starts without special permissions that TV devices often cannot grant. A device-owner HOME activity starts and restarts reliably.
- **Certificate pinning for the API.** Would brick screens when the pilot host's certificate or provider changes. TLS with the system trust store plus pinned statement keys protects what matters offline.
