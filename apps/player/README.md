# Teluni Android TV Player

The screen application of the [player design](../../docs/project/player-design.md) under [ADR-0020](../../docs/adr/0020-propose-a-native-android-tv-player.md) and [ADR-0031](../../docs/adr/0031-build-the-player-on-a-portable-core-with-file-based-atomic-state-and-managed-installation.md). It is a Gradle build outside the pnpm workspace, so `pnpm validate` does not build it. The **Player** CI job checks it on every pull request as part of the required gate.

## Current state

Only `core`, the first delivery increment, exists. It is a Kotlin library for the plain JVM that holds every rule the screen follows. The Android `app` module (activity, rendering with Media3, the Keystore credential vault, device-owner integration) is the next increment and is not implemented. No APK is built yet, and no device has run any of this.

| Package in `core/src/main/kotlin/app/teluni/player/core/` | Responsibility |
| --- | --- |
| `schedule/` | The schedule evaluator ported from the API, rule validation, and resolution of local times against the zone offsets the server sends |
| `protocol/` | Strict protocol 1 manifest parsing (another protocol is refused as incompatible first) and ES256 statement verification with Nimbus JOSE + JWT |
| `time/` | Trusted time: a monotonic anchor from each sync, a persisted lower bound, and the system clock after a reboot only when it is plausible |
| `store/` | App-private storage: atomically replaced records, exact manifests and write-once media named by SHA-256 |
| `sync/` | The device API over OkHttp, and the engine for enrollment, synchronization, staging with resumable verified downloads, activation, recovery and erasure |
| `playback/` | What plays now and until when, or which neutral output and why |

## Commands

Run from `apps/player` with JDK 17 or later:

```sh
./gradlew check
```

`check` runs the `core` tests. They read the repository's shared fixtures where the API owns them:

- [schedule fixtures](../api/test/programming/schedule-fixtures.json);
- [protocol conformance file](../api/test/publications/conformance.json), which `pnpm -C apps/api conformance:write` writes from the API's own code;
- [OpenAPI document](../../docs/generated/api/openapi.json), against which the player's wire models are checked.

The wrapper pins Gradle 8.14.3 with its SHA-256. Dependencies are pinned in [`gradle/libs.versions.toml`](gradle/libs.versions.toml), locked per configuration in `gradle.lockfile`, and verified against the SHA-256 checksums in [`gradle/verification-metadata.xml`](gradle/verification-metadata.xml). After changing a dependency, refresh both and review the diff:

```sh
./gradlew :core:dependencies --write-locks
./gradlew --no-configuration-cache --write-verification-metadata sha256 check
```

Write the verification metadata without the configuration cache and preferably from an empty Gradle cache (`GRADLE_USER_HOME` pointing to a new directory). A cached configuration skips resolutions, and the metadata then misses artifacts that a clean build, such as CI's, needs.

## Environment notes

- **Cloud development environment.** Its network policy refuses `downloads.gradle.org` and `dl.google.com` ([PH-26](../../docs/project/human-actions.md#ph-26)):
  - The wrapper cannot download Gradle there. Run the preinstalled `/opt/gradle/bin/gradle` (also 8.14.3) from this directory instead of `./gradlew`.
  - The Android Gradle plugin, AndroidX and Media3 cannot be resolved there, which blocks the `app` module.
- **Android API floor.** Code in `core` must run on Android 8.0 (API 26). From the JDK it uses only `java.time`, `java.nio.file`, `java.security` and `java.util.concurrent`, which that floor provides. The build compiles against the Java 17 API and emits Java 17 bytecode.
