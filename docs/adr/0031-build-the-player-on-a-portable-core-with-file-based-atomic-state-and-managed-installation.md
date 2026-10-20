# ADR-0031: Build the Player on a Portable Core with File-Based Atomic State and Managed Installation

**Status:** accepted
**Date:** 2026-10-20

**Acceptance scope:** The owner delegated every pending decision to the agent on 2026-10-20 (recorded with PH-25). The agent accepted this decision under that delegation together with the decisions of the [player design](../project/player-design.md); merging the pull request that adds it is the repository review. Acceptance establishes the direction for implementing PJ-12 in local and CI environments. It does not qualify any device (PH-08), select production update operations (PJ-13) or provide the release signing key (PH-27).

## Context

ADR-0020 chose a native Kotlin and Media3 Android TV player with durable local state. It left the persistence library, startup and unattended behavior, packaging and updates open, and ADR-0019 requires atomic activation that survives power loss. The protocol of ADR-0030 gives screens exact manifests, SHA-256-identified media and signed statements with a server time, but says nothing about how the player stores them or how it gets reliable local time.

The pilot hardware is unknown (PH-08) and likely to include inexpensive Android TV boxes. Such boxes often run old Android versions with stale time zone data, have no battery-backed clock and offer limited launcher control. The repository's tooling is TypeScript, while the shared schedule fixtures must also run against the player. The cloud development environment cannot currently reach Google's Maven repository (PH-26).

## Decision

- The player is one Gradle build in `apps/player`. A pure-JVM `core` module holds every rule: protocol models, statement verification, the schedule evaluator, trusted time, the local store, synchronization and playback decisions. An Android `app` module holds the activity, Media3 rendering, the Keystore vault and device integration. `core` tests run the repository's shared fixtures, and a dedicated CI job checks the build as part of the required gate.
- Local state is plain files in app-private storage, without a database:
  - write-once media named by their SHA-256;
  - exact manifest bytes per generation;
  - one small state record replaced atomically (temporary file, `fsync`, rename, directory `fsync`).

  Activation is a single replacement of that record, and startup reconciles deterministically from any interruption.
- Business time never depends on the device's time zone data. Each sync response carries the screen zone's UTC offsets for the next 35 days, computed by the API with the same Temporal implementation as the preview. Trusted time comes from a monotonic anchor set at each sync, with a persisted lower bound across reboots.
- The supported unattended profile makes the player the device owner on a reset device: the HOME activity in lock task mode. Updates are APKs that the API distributes, verified by SHA-256 and signing certificate and installed by the device owner inside a local window. The player never downgrades; a rollback is a roll-forward release.

## Rationale

- Keeping rules in a JVM module lets the evaluator, protocol parsing, cryptographic checks and store faults be tested quickly and exhaustively in CI without emulators. The same code runs on the device. It also lets that work proceed while Android tooling is unavailable in some environments.
- The persistent state is a handful of pointers plus immutable files. Atomic file replacement has a simple failure model that can be fault-injected at every step. A database would add schema migrations that interact badly with the no-downgrade rule. Its own durability under power loss would still need the same testing.
- Server-supplied offsets remove a real failure mode: a pilot box with pre-2019 time zone data would shift `America/Sao_Paulo` schedules by an hour for months. They also make the player agree with the server's preview by construction. The cost is a small additive field in the sync response and evaluation that stops outside the covered range, which the seven-day authorization already bounds.
- On Android 10 and later, a background `BOOT_COMPLETED` start is unreliable, and an ordinary app cannot update itself without a prompt. Device-owner mode makes boot, crash recovery and scheduled updates work without a person at the screen. In exchange, an installer must provision each device with `adb` after a reset, which is acceptable for a pilot of a few screens.
- These are reasoned choices, not measurements. Startup, recovery, clock behavior and power-loss safety still need PH-08 hardware evidence.

## Alternatives Considered

### Room or another embedded database

Offers queries and transactional updates, but adds migrations, a larger failure surface and the same need for power-cut evidence. Nothing in the state needs relational queries.

### Device or bundled time zone data

Device data can be years out of date on unmanaged boxes. A bundled library (ThreeTenBP or Joda-Time) is updated only with player releases and can still disagree with the server preview.

### Basic installation with Google Play updates

Store distribution needs accounts, review and Play on every device. It does not install updates unattended inside a business window, and many commercial boxes lack Play. A basic sideloaded profile stays possible where PH-08 shows that it boots and recovers reliably.

### A single Android module

Simpler build files, but every rule test would need Robolectric or an emulator, and no part could be built without the Android SDK.

## Consequences

### Positive

- Rules, protocol conformance and crash recovery are tested on every pull request with the shared fixtures and the API's conformance fixtures.
- Schedules agree with the preview regardless of the device's time zone data.
- Managed devices boot into content, recover from crashes and update unattended.

### Negative

- The repository gains a second build system and a JVM toolchain, with its own dependency verification and Renovate coverage.
- Managed installation requires `adb` provisioning on a factory-reset device and excludes devices that cannot be made device owner from the supported profile.
- Without a server answer after a reboot, the player depends on the system clock being at least the persisted bound and set by network time; a wrong clock without a reference cannot always be detected.
- The API must keep serving zone offsets and conformance fixtures as part of the device contract.

### Operational or Migration Impact

- Release signing needs a human-held key (PH-27), and production releases need an approval and update-window process (PJ-13).
- Changing the local state format requires a forward migration or a re-synchronization that keeps the credential. Rollbacks are new releases.
- Building the Android module in the current cloud environment requires allowing Google's Maven host (PH-26).

## References

- [Player design](../project/player-design.md)
- [ADR-0019](0019-propose-immutable-publications-and-atomic-player-activation.md), [ADR-0020](0020-propose-a-native-android-tv-player.md), [ADR-0027](0027-propose-device-generated-credentials-and-code-based-enrollment.md), [ADR-0029](0029-propose-temporal-based-schedule-evaluation-with-shared-fixtures.md), [ADR-0030](0030-propose-pull-based-screen-synchronization-with-signed-authorization-statements.md)
- [Offline playback and synchronization](../project/playback-and-sync.md), [acceptance targets](../project/release-targets.md)
