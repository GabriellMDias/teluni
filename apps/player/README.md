# Teluni Android TV Player

The screen application of the [player design](../../docs/project/player-design.md) under [ADR-0020](../../docs/adr/0020-propose-a-native-android-tv-player.md) and [ADR-0031](../../docs/adr/0031-build-the-player-on-a-portable-core-with-file-based-atomic-state-and-managed-installation.md). It is a Gradle build outside the pnpm workspace, so `pnpm validate` does not build it. The **Player** CI job checks it on every pull request as part of the required gate.

## Current state

`core` holds the portable rules. The Android `app` adds a TV activity, code-based enrollment, an AES-256-GCM Android Keystore vault, a foreground synchronization service, Media3 image/video rendering, protocol 2 areas and catalog views, rotation, neutral output and device-owner HOME/lock-task integration. Debug and unsigned release APKs can be built. Local emulator verification is recorded in the [implementation status](../../docs/project/player-design.md#implementation-status); it does not qualify physical hardware or the release/update channel.

| Package in `core/src/main/kotlin/app/teluni/player/core/` | Responsibility |
| --- | --- |
| `schedule/` | The schedule evaluator ported from the API, rule validation, and resolution of local times against the zone offsets the server sends |
| `protocol/` | Strict parsing and checks of protocol 1 manifests and of protocol 2 manifests with layouts and catalog snapshots (another protocol is refused as incompatible), and ES256 statement verification with Nimbus JOSE + JWT |
| `catalog/` | Effective prices of protocol 2 catalogs, ported from the API |
| `time/` | Trusted time: a monotonic anchor from each sync, a persisted lower bound, and the system clock after a reboot only when it is plausible |
| `store/` | App-private storage: atomically replaced records, exact manifests and write-once media named by SHA-256 |
| `sync/` | The device API over OkHttp, and the engine for enrollment, synchronization, staging with resumable verified downloads, activation, recovery, stored-media integrity checks and erasure |
| `playback/` | What plays now and until when, or which neutral output and why; for a layout, what each area shows, with the coordinated page cycle, catalog view pages and prices for the screen's branch |

The running app re-hashes one referenced media file at a time on a background-priority worker, starting after 10 seconds and then every 60 seconds. Decoder/image failures request a check of the affected file on that worker. A missing, unreadable or mismatched file is excluded from output and deleted; intact playlist items, layout areas and catalog text remain available with `DEGRADED` status. If that generation is still desired, the next synchronization repairs only the missing media, retaining its original activation time and recovery generation. Intact bytes rejected by a decoder are not downloaded repeatedly. Per-file repair revisions reopen affected media even when the repair finishes between rendering ticks; intact catalog text keeps its views while changed bitmaps refresh in place. Checks serialize with staging and stop for erasure; startup keeps its existing presence/size checks for fast cached output. Device qualification remains PH-08.

Player health reports include the clock reference, signed system skew against an anchor and the number of uncaught crashes recorded during this pairing. Unknown values remain unknown. Crash messages, causes, filenames and foreign frames are excluded; the latest bounded player code frames stay in app-private storage and only the count is sent. Enrollment/erasure delete the evidence. Earlier versions' unrecorded failures are not reconstructed. The panel's screen detail labels these as reported facts and highlights system skew above 60 seconds; playback and signed authorization still use trusted time. Apply the [diagnostic migration and API before updating players](../../docs/project/player-design.md#diagnostics-and-privacy).

Credential rotation uses the existing hash-only API after the first active sync, then every 30 anchored days when staging is idle. The encrypted atomic vault retains both secrets during an ambiguous handover and recovers the candidate before resuming downloads after a restart; playback still follows the signed authorization. Version code 2 (`0.1.1`) reads the earlier vault and writes its forward version 2 format. APK downgrades are unsupported. No new dependency or release signing key is needed for local development; see [rotation and recovery](../../docs/project/player-design.md#credential-rotation).

## Build and checks

Use JDK 17 and the Android SDK (`ANDROID_HOME`): platform `platforms;android-37.0` and build tools `build-tools;36.0.0`. The runtime floor remains Android 8/API 26; supported pilot hardware has its separate [envelope](../../docs/project/player-design.md#supported-hardware-envelope). From this directory:

```sh
./gradlew --no-daemon check :app:assembleDebug :app:assembleRelease
```

`check` runs core tests, Android adapter/UI tests with Robolectric (API 35 on JDK 17) and Android lint. Debug output is `app/build/outputs/apk/debug/app-debug.apk`; the unsigned release is `app/build/outputs/apk/release/app-release-unsigned.apk`. Release signing is not configured: PH-27 remains open. `pnpm validate` checks the rest of the repository, separately from this Gradle gate.

The core tests consume the API-owned [schedule fixtures](../api/test/programming/schedule-fixtures.json), [protocol conformance file](../api/test/publications/conformance.json) and [OpenAPI document](../../docs/generated/api/openapi.json). Robolectric's Android platform is also a pinned, locked and checksum-verified Gradle dependency; its runtime is offline after resolution.

The wrapper pins Gradle 9.6.0 and its SHA-256, with Android Gradle Plugin 9.4.1 and Media3 1.11.1 in the [version catalog](gradle/libs.versions.toml). Refresh dependency locks and verification metadata together, review the complete diff, then run again without write flags:

```sh
./gradlew --no-configuration-cache --write-locks --write-verification-metadata sha256 :core:dependencies :app:dependencies check :app:assembleDebug :app:assembleRelease
./gradlew --no-daemon check :app:assembleDebug :app:assembleRelease
```

Use a fresh Gradle cache when auditing metadata completeness. Do not disable dependency verification to resolve a build failure.

## Local emulator

Android Studio is optional. Install JDK 17 and Google's command-line tools, then install these SDK packages (the current Android CLI uses `/` separators; legacy `sdkmanager` uses `;`):

```sh
android sdk install platforms/android-37.0 build-tools/36.0.0 platform-tools emulator system-images/android-36/android-tv/x86_64
```

Create an AVD named `teluni-tv-api36` with the Android TV x86_64 image and the `tv_1080p` device profile. With the legacy AVD manager:

```sh
avdmanager create avd -n teluni-tv-api36 -k 'system-images;android-36;android-tv;x86_64' -d tv_1080p
```

Start the [local API and panel](../../docs/setup.md), then run from the repository root:

```sh
pnpm player:dev
```

The command builds the debug APK, opens the emulator if needed, waits up to four minutes for startup, installs the APK and opens the player. It never provisions device ownership, resets an emulator or erases player data. `ANDROID_HOME`, `JAVA_HOME`, `GRADLE_USER_HOME`, `ANDROID_SERIAL` and `TELUNI_PLAYER_AVD` override its local defaults. Without overrides it looks in `~/.local/share/teluni-android-sdk`, `~/.local/share/teluni-toolchains/jdk17` and `~/.cache/teluni-player-gradle`, using `emulator-5554` and `teluni-tv-api36`. The emulator needs KVM access and a graphical desktop; software graphics are selected for reproducible local testing.

On the setup screen, choose **Connect** with the remote/keyboard. The debug default `http://10.0.2.2:3000` reaches the host API through the Android Emulator's host alias. In the host browser, open the panel at `http://127.0.0.1:5173`, choose a company and branch, then **Screens → Pair screen** and enter the displayed code. Assign a published program through the screen's programming page. The player downloads, verifies and activates it automatically. Use arrows and Enter as the TV remote; OK/Enter during playback displays a status card for 30 seconds.

Changing media, playlists or schedules in the panel requires publication before screens receive them. A configured, paired player restores its cached generation and credential after a process restart; offline output remains bounded by the verified authorization and trusted clock. Basic installation stays outside the physical unattended-operation qualification.

To reset only a disposable test player's data (this erases its identity and cached content):

```sh
adb -s emulator-5554 shell pm clear app.teluni.player
```

Unlink the previous screen in the panel before pairing a new identity. Do not reset a real pilot device as a testing shortcut.

## Configuration and security

The app owns one non-secret API endpoint, validated by `PlayerEndpoint` at setup and startup. Artifact builders may supply the HTTPS Gradle property `-PteluniPlayerApiEndpoint=https://example.test/api`; a fresh installation then opens pairing without manual address entry. The property is optional, client-visible and embedded in the APK; changing it requires a rebuild. Without it, setup asks for the address. An existing installation always retains its stored endpoint, so updating an APK cannot redirect a paired credential to another server. It is stored atomically in app-private `endpoint.txt`, is client-visible and contains no authentication material. No service address is assumed when the build property is omitted. The address must be HTTPS, without user information, query or fragment; a paired installation keeps its endpoint until its data is deliberately erased. No API server secrets or human tokens are embedded in the APK.

Only debug builds allow HTTP for `10.0.2.2`, `127.0.0.1` and `localhost`, enforced both by the parser and a debug-only network security resource. Release builds require HTTPS and system certificate validation. There is no global cleartext or certificate-validation bypass.

Device credentials are generated by core and encrypted with a non-exportable Android Keystore AES key. Backup and device transfer are disabled. An unreadable credential causes core to discard the old identity and content. Pairing codes are displayed only during enrollment; telemetry records bounded error codes, without credentials, statements, manifests, media, pairing codes or raw exception messages. Crash diagnostics contain only player stack frame names/line numbers in the private `diagnostics/last-crash.txt` file.

## Managed installation

Use a factory-reset, explicitly designated pilot/test device with no accounts. Install the appropriately signed APK through `adb`, then provision the player as device owner:

```sh
adb shell dpm set-device-owner app.teluni.player/.PlayerAdminReceiver
adb shell am start -n app.teluni.player/.PlayerActivity
```

The app checks actual device ownership before allowlisting itself for lock task and registering its persistent HOME activity. It never tries to grant itself ownership. The boot receiver launches only that owner profile; normal sideloads remain ordinary apps. Do not factory-reset a device merely to try this command. The release key (PH-27), update distribution and physical boot/crash/power-loss qualification (PH-08) remain pending.

## Environment evidence

The old cloud environment refused Gradle and Google Maven downloads on 2026-10-20 (PH-26). On the owner's local Linux host on 2026-10-24, both endpoints returned HTTP 200 and the wrapper, Android dependencies, SDK and Android TV image downloaded successfully. This local evidence does not change the historical cloud policy or qualify a physical device.
