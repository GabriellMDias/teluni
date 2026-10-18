# ADR-0023: Adopt Versioned Catalog and Composition Publications

**Status:** accepted
**Date:** 2026-10-18

**Acceptance scope:** The owner explicitly approved all pending Teluni ADRs on 2026-10-18. Acceptance establishes the architectural direction, not implementation or production readiness. The design reviews, security controls and qualification evidence below remain mandatory delivery gates in the [implementation plan](../project/implementation-plan.md).

## Context

The owner requires freeform simultaneous content, regional schedules with optional page coordination, multiple videos/audio and configurable data catalogs beyond products, such as weekly agendas. Saving designated prices must automatically publish affected content, while other drafts remain private. Players must render locally through bounded outages and recover complete valid generations.

These approved product policies affect schema evolution, references, module ownership and backend/web/player contracts. They do not choose a physical schema, editor/renderer, serialization or queue provider. ADR-0019 establishes immutable publication generations; the expanded presentation/data boundary needs explicit design review before implementation.

## Decision

Adopt versioned declarative composition definitions and typed catalog definitions/records with stable field/binding identities. Customization is validated data rather than executable user code or direct database access. Catalog presets may express products/prices or agendas without making a product schema mandatory for every collection.

Compose immutable publication snapshots from explicitly identified layout/schema/record/media revisions and the rules needed for offline evaluation. Published snapshots remain interpretable after draft schema evolution. A price save records durable intent and generates affected snapshots from published dependencies, excluding unrelated drafts; expose incomplete/retry states and prevent stale work from overwriting newer desired generations.

Keep catalogs, layout authoring, programming and publication behind explicit module capabilities in the modular backend. No arbitrary cross-module table writes, circular imports or new generic shared framework are implied. Carry interoperable contracts to the native player rather than importing TypeScript application internals.

Before dependent implementation, review concrete schemas, module collaboration, import security, destructive field evolution, snapshot granularity, trusted time, rendering/media profiles and the failure/compatibility fixtures. Serialization, storage layout, libraries and processing/transport mechanisms remain intentionally unselected.

## Rationale

User-defined fields and freeform geometry need stable meaning across independent editor/player releases. A versioned declarative boundary makes validation, copying, private references and offline rendering reviewable. Immutable data snapshots preserve the existing consistency/activation direction while allowing automatic price updates without live mutation of an issued program.

This is reasoned architecture, not a measured renderer/storage evaluation. PH-09 policy selection alone did not accept this ADR; explicit architectural approval is recorded above. Neither establishes product availability.

## Alternatives Considered

- **Product-only fixed fields and opaque final artwork:** cannot satisfy configurable non-product catalogs, field-bound editing and independent regional presentation without rebuilding the model.
- **Read mutable live records while rendering an old publication:** makes ordinary playback depend on the server or mixes data/layout/schema revisions; obscures rollback and offline commercial validity.
- **Unversioned arbitrary catalog/layout objects:** initially flexible but leaves incompatible field changes, unsafe references and preview/player interpretation undefined. Extensibility still needs typed validation and compatibility rules.

## Consequences

### Positive

- Supports sector-neutral catalogs, reusable textual layouts and controlled offline interpretation.
- Keeps ordinary drafts separate from explicit automatic price publication and preserves attributable generation history.
- Makes schema/reference/security and regional scheduling cases part of contract verification.

### Negative

- Requires schema evolution/reference handling and qualified multi-area/video rendering across independent runtimes.
- Publication fan-out, processing and retained generations add storage/work and recovery obligations.
- Does not remove real device limits, trusted-time uncertainty or the inability to erase an unreachable player instantly.

### Operational or Migration Impact

No product schema or deployment currently exists, so this decision adds no migration or running component. Future implementations must keep retained snapshots readable, reconcile interrupted price/publication work and qualify protocol overlap, offline/power recovery and supported device profiles. Apply accepted ADR-0019 alongside this record; neither supersedes an earlier foundation decision.

## References

- [Release policies and PH-09 decision record](../project/release-policies.md)
- [Release acceptance targets](../project/release-targets.md)
- [Product architecture](../project/architecture.md)
- [Immutable publication decision](0019-propose-immutable-publications-and-atomic-player-activation.md)
- [Delivery and side effects](../architecture/delivery-and-side-effects.md)
- [Versioning and compatibility](../architecture/versioning-and-compatibility.md)
