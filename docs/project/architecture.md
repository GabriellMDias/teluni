# Teluni Product Architecture

[Project documentation](README.md) · [MVP requirements](mvp.md) · [Foundation technology map](../architecture/technology-decisions.md)

## Baseline and proposed topology

**Implemented foundation:** Node.js/TypeScript ESM, Fastify, PostgreSQL/Prisma infrastructure, TypeBox/OpenAPI and generated TypeScript SDK, React/Vite with TanStack Router/Query, Pino/OpenTelemetry, local validation and CI configuration. [Actual product composition is empty](README.md#verified-baseline). Installed versions are owned by package manifests/lockfile, not this proposal. No new service/library is selected by this document.

**Decided constraints:** use Orion's boundaries; keep a modular backend; support tenants from the first product slice; treat clients and uploaded files as untrusted; avoid premature microservices and distributed infrastructure.

**Proposed:** three product components: an administration web panel, the backend, and a native Android TV player. The initial deployment would serve the panel/API and private media over HTTPS, with PostgreSQL and local persistent media storage on one managed host. The player downloads authorized publications and plays locally. This is a logical topology, not deployed infrastructure.

| Component | Responsibility | Trust and persistence boundary |
| --- | --- | --- |
| Web panel | Companies, branches, members, devices, media, playlists, schedules, previews, publication, status, operational history; future layouts/campaigns | Untrusted client; generated SDK for API access; no server secrets or direct database/storage access |
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
| `programming` | Playlists/items, schedules, default assignment, preview and deterministic schedule validation | References media and devices by owned contracts; owns scheduling semantics shared with player contract. MVP |
| `publications` | Immutable publication snapshot/manifest, target desired version and device synchronization acknowledgements | Uses validated programming/media/device contracts; never reads another module's tables as a shortcut. MVP |
| `monitoring` | Last contact, reported app/storage/sync health and sanitized diagnostic records | Consumes device-scoped reports; separates observation freshness from playback success. MVP |
| Audit responsibility | Attributable security/publication/lifecycle events across modules | Each capability owns event meaning. Decide persistence/integrity/retention and whether a shared audit component is warranted before extraction; no mandatory generic audit package. MVP |
| `layouts`, `catalog`, `campaigns` | Structured layouts, product/price facts, and promotional lifecycle respectively | Future Phase 3; expose explicit versioned data dependencies to publication |
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
| Media asset / stored object | Tenant-owned metadata points to a validated immutable file version; storage location is not authorization |
| Playlist / item | Company-owned ordered references to eligible media with duration semantics; edits produce draft changes |
| Schedule / assignment | Associates eligible programming with a device and local-time rule; all references share tenant and permitted branch scope |
| Publication / manifest | Immutable validated snapshot of programming, assets and interpretation version; references remain resolvable through retention |
| Device publication state | Separates desired, staged, active and last-reported versions per device; acknowledgement is not proof of continuous playback |
| Device report / audit event | Observation belongs to a tenant/device; attributable action evidence has independent integrity and retention requirements |

**Future:** a layout has versioned structured components/regions and reusable assets; a catalog product has description/images/category/availability and normal/promotional price facts, with combo support; a campaign connects promotional intent, validity and priority to programming/publications. A product-price update must eventually update dependent published content without manual artwork recreation. Decide controlled version propagation and caching before implementation; editing mutable data behind an immutable publication is not an implied solution.

Tenant IDs must participate in ownership validation for references and uniqueness. The physical enforcement choice (including compound constraints and possible row-level security) is [ADR-0018](../adr/0018-propose-tenant-owned-data-in-the-modular-backend.md), still proposed. IDs supplied by the caller never establish authority.

## Publication and integration boundaries

[Playback/sync](playback-and-sync.md) owns publication consistency and recovery. Candidate HTTP operations must follow existing [API principles](../api/principles.md), [error contract](../api/error-contract.md), [API versioning](../api/versioning.md), and [delivery policy](../architecture/delivery-and-side-effects.md). No endpoint paths, payload schemas, protocol version numbers, jobs, broker, WebSocket, S3 provider, CDN, or Kotlin client generator are selected here. Polling/reconciliation is a candidate; notification transport remains D-04.

**Future:** an externally consumable documented API should allow authorized partners to update product/price data from ERP/POS systems, with stable generated OpenAPI documentation, scoped machine identities, rate limits, versioning, and safe retry/webhook semantics. Documentation must be usable by partner companies without private repository access. The current internal living portal is not proof of a public integration service. Integrations must pass application authorization and validation; no direct ERP database coupling.

## Pending decisions

This table owns unresolved technical questions. ADR files own their proposal status/rationale; human actions own required owner input. No item is accepted just because it has an ID.

| ID | Pending question / candidate direction | Evidence required before dependent work |
| --- | --- | --- |
| D-01 | Tenant persistence isolation, constraints, module ownership and administrative scope; ADR-0018 proposed | Adversarial cross-tenant/reference tests and reviewed data-access design before first product migration |
| D-02 | Human identity provider, enrollment/recovery, session/refresh/revocation and permission matrix | Standards-based provider evaluation compatible with accepted ADR-0012; no bespoke authentication. [PH-11](human-actions.md#ph-11) |
| D-03 | Device credentials, pairing expiry/rate limiting, revocation, offline authorization duration, reassignment/erasure | Threat model and hardware lifecycle cases; owner's acceptable disconnected-revocation limit, PH-09 |
| D-04 | Manifest format, integrity metadata, sync transport, atomic activation and backend/player support window; ADR-0019 proposed | Contract examples and failure/compatibility tests; no need to add push infrastructure before evidence |
| D-05 | Media profiles/limits, validation/processing, private delivery and file retention | Pilot hardware codec/memory/storage tests, file-abuse review, reference/deletion model |
| D-06 | Schedule conflicts/fallback, recurrence/time boundaries, duration rules, MVP device-group scope | Confirm candidate policies in MVP, PH-09; shared preview/player fixtures |
| D-07 | Android runtime/persistence, supported devices/orientations, restart/startup, packaging and updates; ADR-0020 proposed | PH-08 hardware list, unattended operation and power-cut tests; controlled installation and rollback design |
| D-08 | Host/network exposure, HTTPS/proxy, storage, backups, restore/migration; ADR-0021 proposed | PH-10 inspection and recovery rehearsal; budget/availability targets; no presumed tunnel/provider guarantees |
| D-09 | Audit persistence, heartbeat/offline thresholds, telemetry retention, alerting/support access | Scope/volume review and operator needs; apply inherited security/observability policies |
| D-10 | Locale/timezone inheritance and numeric/money representation | Explicit override rules and cross-locale/timezone fixtures; no library selected by planning |
| D-11 | Future layout schema and dynamic-data version propagation | Portable structured representation (JSON/XML or evaluated alternative), migration/validation policy, copy/import/export and rendering proofs; independent regions if retained |

Keep the inherited [technology map](../architecture/technology-decisions.md) unchanged by these product proposals. Review/accept significant choices through [ADR authoring](../adr/authoring.md), then update the owning product specification before implementing them.
