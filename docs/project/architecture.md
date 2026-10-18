# Teluni Product Architecture

[Project documentation](README.md) · [Release requirements](mvp.md) · [Release policies](release-policies.md) · [Foundation technology map](../architecture/technology-decisions.md)

## Baseline and proposed topology

**Implemented foundation:** Node.js/TypeScript ESM, Fastify, PostgreSQL/Prisma infrastructure, TypeBox/OpenAPI and generated TypeScript SDK, React/Vite with TanStack Router/Query, Pino/OpenTelemetry, local validation and CI configuration. [Actual product composition is empty](README.md#verified-baseline). Installed versions are owned by package manifests/lockfile, not this proposal. No new service/library is selected by this document.

**Decided constraints:** use Orion's boundaries; keep a modular backend; support tenants from the first product slice; treat clients and uploaded files as untrusted; avoid premature microservices and distributed infrastructure.

**Proposed:** three product components: an administration web panel, the backend, and a native Android TV player. The initial deployment would serve the panel/API and private media over HTTPS, with PostgreSQL and local persistent media storage on one managed host. The player downloads authorized publications and plays locally. This is a logical topology, not deployed infrastructure.

| Component | Responsibility | Trust and persistence boundary |
| --- | --- | --- |
| Web panel | Companies, branches, members, devices, media, playlists, freeform visual composition, configurable catalogs/field bindings, regional schedules, previews, publication and observed operational state | Untrusted client; generated SDK for API access; no server secrets or direct database/storage access |
| Backend | Authorization and tenant isolation, domain rules, metadata, media access, publication/sync, schedules, telemetry, audit; future integrations | Owns canonical server state and API contracts; one modular process initially; privileged migrations separate from runtime |
| Android TV player | Pairing, local configuration, staging, integrity checks, scheduling, playback and bounded diagnostic reporting | Independently distributed untrusted client with its own revocable identity and durable local state; never direct database access |

Kotlin, Android Media3/ExoPlayer, and durable local persistence are **proposed** under [ADR-0020](../adr/0020-propose-a-native-android-tv-player.md). Minimum Android/API level, media profiles, persistence library, background behavior, package distribution, and update channels remain pending. No player directory or build system is created in this stage. A future repository placement should make the Android runtime independent; a conceptual name such as `apps/player-android/` is not an existing workspace package. Kotlin must not import TypeScript application internals; HTTP contracts remain interoperable.

## Suggested modules and ownership

All names/placements below are **proposed**, not existing modules. Follow [API module](../../apps/api/README.md#modules), [web module](../../apps/web/README.md#modules), and [dependency rules](../architecture/dependency-rules.md); group by business responsibility rather than one service per entity.

| Module | Owned meaning and entities | Allowed collaboration and phase |
| --- | --- | --- |
| `organizations` | Company (tenant), branch, membership, scoped role assignments and company settings | Supplies explicit ownership/membership checks; human identity verification remains an authentication boundary. First MVP slice |
| `devices` | Device registration, enrollment session, device identity lifecycle, branch assignment and per-device settings | Uses organization scope; supplies permitted device/capability information. MVP |
| `media` | Media metadata, validation lifecycle, storage objects, access and deletion/reference policy | Supplies authorized immutable asset descriptors to programming/publication. MVP |
| `programming` | Playlists/items, schedules, device/group assignments, default assignment, preview and deterministic schedule validation | References media and devices by owned contracts; owns scheduling semantics shared with player contract. MVP |
| `publications` | Immutable publication snapshot/manifest, target desired version and device synchronization acknowledgements | Uses validated programming/media/device contracts; never reads another module's tables as a shortcut. MVP |
| `monitoring` | Last contact, reported app/storage/sync health and sanitized diagnostic records | Consumes device-scoped reports; separates observation freshness from playback success. MVP |
| Audit responsibility | Attributable security/publication/lifecycle events across modules | Each capability owns event meaning. Decide persistence/integrity/retention and whether a shared audit component is warranted before extraction; no mandatory generic audit package. MVP |
| `layouts` | Freeform composition/area authoring and its validated versioned representation | Initial release requirement FR-10; exact boundary/ownership with programming and player representation remain D-11. No module is implemented |
| `catalog` | Company-owned typed field definitions, schema versions, records and scoped data/price overrides; reusable product or weekly-agenda configurations | FR-11; expose validated versioned data through public capabilities. Physical schema and publication collaboration remain technical review under proposed ADR-0023 |
| `campaigns` | Promotional lifecycle beyond scheduled programming | Future Phase 3; expose explicit versioned data dependencies to publication |
| Integration and commercial capabilities | External clients/webhooks/imports, fleet capabilities and subscription/entitlement meaning | Future Phase 4; do not introduce a shared catch-all module |

Keep domain rules independent of Fastify, Prisma, filesystem, and providers. The composition root may wire module interfaces; cross-module operations must use explicit public application capabilities with no cycles or arbitrary table writes. Existing `ApiModule` does not automatically provide inter-module authorization or dependency injection. Confirm the narrow composition design when implementing the first collaboration; do not change foundation contracts to match this planning table alone.

## Conceptual entities and relationships

This is a domain model for review, not a database schema, migration, wire contract, or generated reference.

| Entity | Relationship and invariant |
| --- | --- |
| Platform | Operates customer companies; platform operational authority is distinct from tenant membership |
| Company | Tenant ownership boundary for branches, members, media, programming, devices and publications |
| Branch | Belongs to one company; holds local business timezone/settings and assigned devices |
| User / membership | A human identity can have explicitly authorized memberships; a membership binds a user to a company and permitted branch scope |
| Device / enrollment session | A device belongs to one company and branch after pairing; enrollment is temporary and single-use; reassignment requires safe unlink/clear semantics |
| Device group | Persistent company-owned programming target in the MVP; may span branches of that company within the caller's authorization. Each device belongs to zero or one programming group and follows it unless an explicit individual override replaces its complete programming |
| Media asset / stored object | Tenant-owned metadata points to a validated immutable file version; storage location is not authorization |
| Playlist / item | Company-owned ordered references to eligible media with duration semantics; edits produce draft changes |
| Screen composition / content area | FR-10 requires freeform configuration, independent areas with optional coordinated pages, regional schedules and concurrent video/audio. Portable representation, renderer and supported profiles remain technical work |
| Catalog definition / field / record / binding | FR-11 requires user-defined typed catalogs beyond products, stable/versioned field meaning and authorized data bindings. Product-price and weekly-agenda views are configurations, not a fixed universal product schema |
| Price override / publication intent | Designated monetary semantics permit company base/branch override and automatic publication of affected published bindings; ordinary unrelated drafts stay unpublished. Durable processing and exact price/representation contracts remain D-10/D-11 |
| Schedule / assignment | Associates eligible programming with a device or group and local-time rule; all references share tenant and permitted branch scope |
| Publication / manifest | Immutable validated snapshot of programming, assets and interpretation version; references remain resolvable through retention |
| Device publication state | Separates desired, staged, active and last-reported versions per device; acknowledgement is not proof of continuous playback |
| Device report / audit event | Observation belongs to a tenant/device; attributable action evidence has independent integrity and retention requirements |

**Initial release requirements:** [release policies](release-policies.md) define the owner-approved freeform/hybrid regional behavior and configurable catalogs, including automatic versioned price publication. [Acceptance targets](release-targets.md) define the qualification envelope. [ADR-0023](../adr/0023-propose-versioned-catalog-and-composition-publications.md) proposes the schema/composition/publication architecture and remains proposed, alongside ADR-0019. Serialization, renderer, physical storage, exact module collaboration and executable contracts are not selected or implemented by product-policy approval.

**Further evolution unless separately approved:** richer external-data widgets, managed campaign engines, ERP/POS workflows and AI authoring. Configurable fields, product presets and weekly-agenda views are already initial requirements. Versioned textual layouts and automatic price publication must preserve snapshot consistency rather than mutate live data behind an issued publication. Custom catalogs do not imply arbitrary executable plugins or direct per-customer SQL/schema administration.

Tenant IDs must participate in ownership validation for references and uniqueness. The physical enforcement choice (including compound constraints and possible row-level security) is [ADR-0018](../adr/0018-propose-tenant-owned-data-in-the-modular-backend.md), still proposed. IDs supplied by the caller never establish authority.

## Publication and integration boundaries

[Playback/sync](playback-and-sync.md) owns publication consistency and recovery. Candidate HTTP operations must follow existing [API principles](../api/principles.md), [error contract](../api/error-contract.md), [API versioning](../api/versioning.md), and [delivery policy](../architecture/delivery-and-side-effects.md). No endpoint paths, payload schemas, protocol version numbers, jobs, broker, WebSocket, S3 provider, CDN, or Kotlin client generator are selected here. Polling/reconciliation is a candidate; notification transport remains D-04.

**Future:** an externally consumable documented API should allow authorized partners to update product/price data from ERP/POS systems, with stable generated OpenAPI documentation, scoped machine identities, rate limits, versioning, and safe retry/webhook semantics. Documentation must be usable by partner companies without private repository access. The current internal living portal is not proof of a public integration service. Integrations must pass application authorization and validation; no direct ERP database coupling.

## Pending decisions

This table owns unresolved technical design/verification questions. PH-09 has completed business-policy/target selection, with provenance in the release policies; it does not accept technical ADRs or supply hardware/operations evidence. No item is accepted merely because it has an ID.

| ID | Pending question / candidate direction | Evidence required before dependent work |
| --- | --- | --- |
| D-01 | Tenant persistence isolation, constraints, module ownership and administrative scope; ADR-0018 proposed | Adversarial cross-tenant/reference tests and reviewed data-access design before first product migration |
| D-02 | Human identity provider, enrollment/recovery, session/refresh/revocation and permission matrix | Standards-based provider evaluation compatible with accepted ADR-0012; no bespoke authentication. [PH-11](human-actions.md#ph-11) |
| D-03 | Established credential/pairing mechanisms, revocation enforcement, trusted offline time and verifiable cleanup | Implement/verify selected AT-15/AT-16 and unlink/reassignment policies, threat model and PH-08 lifecycle cases; no unanswered PH-09 offline-duration choice |
| D-04 | Manifest serialization/integrity, sync transport, durable atomic activation and protocol compatibility implementation; ADR-0019 proposed | Contract examples and failure/compatibility tests against AT-26; latest-authorized-compatible reconciliation and required schedule history. No push infrastructure is selected |
| D-05 | Exact allowed media/codec/rendition profiles, parser/processing isolation and reference-safe garbage collection | Enforce selected ingestion/retention limits; PH-08 codec/memory/storage and file-abuse tests before support claims. Tool/provider choices remain unselected |
| D-06 | Shared scheduling fixtures, timezone representation and regional/page state-machine implementation | Product calendar/conflict/coordination semantics are decided in release policies; verify date/DST/page/override/no-match and boundary cases rather than silently selecting different behavior |
| D-07 | Android runtime/persistence, supported devices/orientations, restart/startup, packaging and updates; ADR-0020 proposed | PH-08 hardware list, unattended operation and power-cut tests; controlled installation and rollback design |
| D-08 | Host/network exposure, HTTPS/proxy, storage, backups, restore/migration; ADR-0021 proposed | PH-10 inspection and recovery rehearsal; budget/availability targets; no presumed tunnel/provider guarantees |
| D-09 | Audit persistence/integrity, telemetry enforcement, alerts and scoped support mechanisms | Apply selected AT-20/AT-24 report/freshness defaults; audit/legal retention remains PH-13. Review volume, access and observability evidence; do not infer alert channels or remote shell |
| D-10 | Locale precedence, exact numeric/money representation and field/timezone library contracts | Business timezone/DST/price override rules and AT-16 are selected; implementation needs cross-locale/timezone/money fixtures. No conversion service or library selected |
| D-11 | Versioned catalog/layout schemas, physical storage, editor/renderer and durable price-publication collaboration | Review proposed ADR-0023 with ADR-0019, implement FR-10/FR-11 policies and qualify AT-04 plus schema evolution, offline recovery and import security; PH-08/PJ-07 remain open |

Keep the inherited [technology map](../architecture/technology-decisions.md) unchanged by these product proposals. Review/accept significant choices through [ADR authoring](../adr/authoring.md), then update the owning product specification before implementing them.
