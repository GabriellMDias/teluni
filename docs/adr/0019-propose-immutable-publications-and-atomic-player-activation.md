# ADR-0019: Propose Immutable Publications and Atomic Player Activation

**Status:** proposed
**Date:** 2026-10-17

## Context

Teluni displays must continue through temporary backend/network outages. Videos must normally play locally. Partial downloads, concurrent publications and power loss must not replace usable programming with an incomplete set. Backend and installed players will evolve independently.

## Decision

Propose immutable publication snapshots with versioned manifests that bind programming rules to verified asset versions. The player durably stages missing assets and switches its active generation only after the complete supported snapshot is ready, retaining a valid recovery generation. Separate desired, staged and reported-active versions and reconcile duplicate or lost acknowledgements.

Define protocol compatibility, integrity metadata, capacity/retention, scheduling expiry and offline authorization policy before implementation. No transport, storage library, cryptographic mechanism or manifest serialization format is selected by this record.

## Rationale

The owner's requirement is consistent offline playback, not normal continuous server streaming. A generation boundary makes interruption and recovery behavior testable and avoids exposing partially updated programming. This is a design proposal, not evidence of crash-safe storage or hardware compatibility.

## Alternatives Considered

- **Continuous server streaming:** makes ordinary playback depend on connectivity and repeated transfer; does not satisfy the central offline requirement.
- **Overwrite active files/programming as downloads arrive:** reduces temporary storage but can mix incompatible versions and leave no valid program after interruption. It does not satisfy the required activation boundary.

## Consequences

### Positive

- Enables local replay through outages and explicit recovery/failure acceptance tests.
- Separates publication intent from device observations without assuming exactly-once delivery.

### Negative

- Staging plus recovery versions consume additional storage and need safe garbage collection.
- Cached content cannot be immediately recalled from unreachable devices; expiry/revocation rules need explicit review.

### Operational or Migration Impact

Atomicity across PostgreSQL and media storage needs durable intent/reconciliation. The player needs proven local activation durability and a supported backend/player overlap. Acceptance requires representative network/power-cut and stale/reordered message cases, not only unit tests.

## References

- [Offline playback and synchronization](../project/playback-and-sync.md)
- [Delivery and side effects](../architecture/delivery-and-side-effects.md)
- [Versioning and compatibility](../architecture/versioning-and-compatibility.md)
