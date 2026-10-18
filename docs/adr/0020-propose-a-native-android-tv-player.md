# ADR-0020: Adopt a Native Android TV Player

**Status:** accepted
**Date:** 2026-10-18

**Acceptance scope:** The owner explicitly approved all pending Teluni ADRs on 2026-10-18. Acceptance establishes the architectural direction, not implementation or production readiness. The design reviews, security controls and qualification evidence below remain mandatory delivery gates in the [implementation plan](../project/implementation-plan.md).

## Context

The intended first player is Android TV, with continuous image/video playback, local persistence, temporary-code pairing and offline recovery. Orion supplies TypeScript API/web foundations but deliberately does not select a mobile/native stack. No Android application or hardware validation exists in Teluni.

## Decision

Adopt an independently built/distributed native Android TV player using Kotlin and Android Media3/ExoPlayer, with durable local media/configuration/synchronization state. Consume versioned backend HTTP contracts; do not import backend or web implementation. Keep player credentials in reviewed platform-protected storage.

Minimum platform version, supported devices/codecs/orientations, persistence library, packaging, startup/unattended behavior and controlled update/rollback mechanisms remain pending validation. Architecture acceptance does not imply every Android TV or Smart TV is supported.

## Rationale

This is the owner's preferred initial direction and matches the requested native device lifecycle and local-playback responsibilities. There are no completed benchmarks or device tests establishing that it meets the reliability envelope. A separate runtime is justified by installation and hardware lifecycle, while backend distribution is not.

## Alternatives Considered

- **Web player first:** remains a possible future platform, but browser lifecycle, storage and unattended playback would need separate validation. It is not the requested MVP target.
- **Other Smart TV or dedicated-computer players:** could expand coverage later; validating multiple platforms now would widen MVP support and test obligations without pilot evidence.

## Consequences

### Positive

- Gives the first player a clear device-specific owner and keeps interoperable contracts with Orion.
- Allows targeted validation of local storage, playback and restart behavior on pilot hardware.

### Negative

- Adds Android build/signing/distribution, hardware testing and old-client compatibility responsibilities.
- Media capability and unattended behavior must be verified per supported device; TypeScript tooling cannot establish them.

### Operational or Migration Impact

Supported-device/release qualification under PH-08/PJ-12/PJ-14 requires the pilot hardware matrix, chosen installation/update policy and playback/reboot/power-loss evidence. No application directory, Gradle project, dependency or signing credential is created in this documentation stage.

## References

- [Product components and pending decisions](../project/architecture.md)
- [MVP acceptance](../project/mvp.md)
- [Additional runtime boundaries](../architecture/application-boundaries.md#additional-runtime-boundaries)
