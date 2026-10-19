# API Runtime

[Setup](../../docs/setup.md) · [API principles](../../docs/api/principles.md) · [OpenAPI](../../docs/generated/api/openapi.json) · [Validation](../../docs/validation.md)

The Fastify API runtime provides configuration, structured logging and tracing, health/lifecycle behavior, the public error envelope, optional PostgreSQL access through Prisma, and optional bearer access-token verification. Product capabilities are [modules](#modules) composed in [`src/modules.ts`](src/modules.ts). The [web application](../web/README.md) consumes the generated API contract through the workspace SDK package (`packages/sdk`). The composed `identity` module implements Keycloak login and server-managed human sessions without handling passwords; see [identity and sessions](#identity-and-sessions).

## Find the owning implementation

| Concern | Source |
| --- | --- |
| Configuration and process composition | [`src/config.ts`](src/config.ts), [`src/main.ts`](src/main.ts) |
| HTTP boundary, lifecycle, and failures | [`src/app.ts`](src/app.ts), [`src/lifecycle.ts`](src/lifecycle.ts), [`src/errors.ts`](src/errors.ts) |
| Module contract and composition | [`src/module.ts`](src/module.ts), [`src/modules.ts`](src/modules.ts), [`src/error-registry.ts`](src/error-registry.ts) |
| Database client and token verification | [`src/database.ts`](src/database.ts), [`src/authentication.ts`](src/authentication.ts) |
| Prisma schema, schema meaning, and runtime grants | [`prisma/schema/`](prisma/schema/schema.prisma), `prisma/metadata/`, `prisma/runtime-grants/`, reviewed `prisma/migrations/` |
| Generated references | [`generate-references.ts`](scripts/generate-references.ts), [`openapi.ts`](scripts/openapi.ts), [`database-reference.ts`](scripts/database-reference.ts) |
| Process smokes | [`scripts/smoke.mjs`](scripts/smoke.mjs) and module smokes in `scripts/smoke/` |

## Modules

A module is one cohesive API capability. It implements the `ApiModule` contract in [`src/module.ts`](src/module.ts): a name, an OpenAPI tag, its requirements (`database`, `authentication`), its executable operations, its public error codes, and an `activate` function that mounts routes once its requirements are configured. Shared runtime files never import a module; [`src/modules.ts`](src/modules.ts) is the only composition point, and dependency rules enforce that boundary.

Keep a module's files together under its name: `src/features/<module>/` for domain, application, persistence, contracts, routes, and errors; `prisma/schema/<module>.prisma` for its models; `prisma/metadata/<module>.json` for table meaning; `prisma/runtime-grants/<module>.sql` for least-privilege runtime access; a reviewed migration; tests under `test/<module>/`; and an optional emitted-process smoke at `scripts/smoke/<module>.ts`. Follow [application boundaries](../../docs/architecture/application-boundaries.md), [dependency rules](../../docs/architecture/dependency-rules.md), and the [database policies](../../docs/database/principles.md). [Orion's reference implementation](../../docs/project-derivation.md#orions-reference-implementation) is a complete example.

Outside production, a module whose requirements are not configured stays unmounted. In production, startup fails instead, so a composed capability cannot silently disappear. Generated OpenAPI and the public error registry always include every composed module, whether or not it is configured locally.

## Local commands

Use [setup](../../docs/setup.md) for the frozen install, generated Prisma client, environment loading, containers, and startup order. `pnpm -C apps/api dev` loads the ignored root `.env.local` when present; `start` runs emitted code and expects its process environment without loading that file.

From the repository root:

| Purpose | Command |
| --- | --- |
| Generate ignored Prisma client | `pnpm -C apps/api db:generate` |
| Apply committed migrations to the configured database | `pnpm -C apps/api db:migrate:deploy` |
| Check API behavior/types | `pnpm -C apps/api test` and `pnpm -C apps/api typecheck` |
| Emit/start API | `pnpm -C apps/api build`, then `pnpm -C apps/api start` |
| Intentionally regenerate tracked API/database/configuration/error references | `pnpm -C apps/api references:write` |
| Check current API/database/SDK references without editing them | `pnpm references:check` |

Tests and reference generation use fresh migrated Testcontainers PostgreSQL, and identity tests also start the pinned Keycloak image, so a compatible container runtime must be reachable. Follow the [artifact workflow](../../docs/architecture/backend-execution-and-generated-artifacts.md) for downstream SDK/portal generation after source changes. The root `pnpm validate` also checks emitted builds, real-process recovery, and browser behavior; a focused package check alone does not replace it.

## Configuration and database access

[`config.ts`](src/config.ts) is the sole runtime environment parser; the [generated configuration reference](../../docs/generated/configuration/api.md) owns the setting catalog. `ORION_ENV` is always required. `ORION_DATABASE_URL` enables the database for modules that require it and adds a bounded database check to readiness. `ORION_TOKEN_ISSUER`, `ORION_TOKEN_AUDIENCE`, and `ORION_TOKEN_JWKS_URL` enable bearer authentication and must be configured together.

`ORION_DATABASE_URL` is the restricted runtime credential. Only the Prisma CLI reads `ORION_MIGRATION_DATABASE_URL`, supplied separately for migration commands; the CLI does not automatically load the API's root `.env.local`. Keep both out of tracked files and do not leave the migration credential in the runtime environment.

The runtime role needs `USAGE` on the application schema plus only the table and column privileges that each module declares in `prisma/runtime-grants/`. It needs no DDL grant. The [database fixture](scripts/migrated-database.ts) provisions separate migration/runtime roles and applies those grants, so integration tests run with the same least-privilege runtime role.

The [release workflow](../../docs/database/release-evolution.md) owns durable migration recording. An empty registry is not permission to rewrite unverified history.

## Identity and sessions

The [`identity` module](src/features/identity/AGENTS.md) owns application principals and PostgreSQL-backed browser sessions under the [identity and session design](../../docs/project/identity-session-design.md). It requires the database, the token settings and the six `TELUNI_` human identity settings, and stays unmounted outside production until they are configured. Login, callback and back-channel logout are public browser/provider routes under `/auth`; session routes and every product module that needs a human authenticate through its session boundary, exposed to other modules only by `src/features/identity/public.ts`. That boundary passes the stored provider access token through the unchanged verifier below, so the cookie never bypasses it. Bearer-only requests without a session are rejected by session-protected operations.

The realm contract is provisioned by [`scripts/identity-realm.ts`](scripts/identity-realm.ts) and qualified against the pinned Keycloak image in [`scripts/keycloak.ts`](scripts/keycloak.ts). Identity tests start that image and PostgreSQL through Testcontainers.

## Organizations

The [`organizations` module](src/features/organizations/AGENTS.md) depends on the identity session boundary. It owns companies, branches, creator memberships, responsibility, standard-role grants and branch scopes, and append-only organization audit under [D-01](../../docs/project/tenant-data-design.md#implementation-status). Every request resolves current tenant access; administrator and manager grants require strong authentication. Company creation is idempotent per principal/key and atomically creates the creator relationships and audit event. Company and branch changes use expected versions and write audit in the same transaction. Branch and audit pagination reject invalid or incorrectly bound cursors. Runtime grants exclude tenant-column changes, audit edits/deletion and membership/grant administration that has no implemented operation.

The [`mail` module](src/features/mail/AGENTS.md) owns the transactional outbound-email outbox under [ADR-0026](../../docs/adr/0026-propose-a-postgresql-outbox-and-smtp-relay-for-transactional-email.md). It requires the database and the `TELUNI_MAIL_` settings (which also need `TELUNI_PUBLIC_ORIGIN`) and stays unmounted outside production until they are configured. Producers enqueue messages inside their own transactions through `src/features/mail/public.ts`; the dispatcher starts when the server is ready, claims due messages with expiring leases, submits them through SMTP at least once with bounded retries, and stops during shutdown drain.

The `invitations` module, composed from the organizations feature, requires organizations and mail and owns company invitations under [D-13](../../docs/project/invitation-delivery-design.md#implementation-status): administrators and branch managers invite by email, and the person signed in with the invited verified address accepts with the credential from the email link in a request body. Organizations keeps working without it when mail is not configured.

The [two-company suite](test/organizations/integration.test.ts) runs against migrated PostgreSQL as the restricted runtime role; its synthetic session port is confined to the test. The [organizations browser journeys](../web/test/e2e/organizations/companies.spec.ts) use the real identity stack. Platform/support access and bulk operations remain pending in PJ-03/PJ-24.

## Devices

The [`devices` module](src/features/devices/AGENTS.md) requires identity, organizations, the database and `TELUNI_DEVICE_CODE_KEYS`, and owns screen enrollment, pairing and lifecycle under [ADR-0027](../../docs/adr/0027-propose-device-generated-credentials-and-code-based-enrollment.md) and the [device enrollment design](../../docs/project/device-enrollment-design.md#implementation-status). A player starts an anonymous enrollment with the hash of a credential it generated, shows the returned code, and polls until a person with `devices.manage` on the target branch claims the code in the panel. Device routes authenticate that credential as a bearer token; check-in renews offline authorization for seven days. Unlinking is irreversible and leaves erasure pending until the device confirms it or a person records a controlled reset. Archiving a branch with active screens is refused with `BRANCH_IN_USE`. The [two-company suite](test/devices/integration.test.ts) covers claims, limits, concurrency, scope, rotation and erasure against migrated PostgreSQL.

## Media

The [`media` module](src/features/media/AGENTS.md) requires identity, organizations, the database and `TELUNI_MEDIA_STORAGE_PATH`, and owns the company media library under [ADR-0028](../../docs/adr/0028-propose-local-content-addressed-media-storage-and-isolated-ffmpeg-processing.md) and the [media library design](../../docs/project/media-library-design.md#implementation-status). A person with `media.upload` creates an item for the company or one branch, then streams its bytes with `PUT .../content` (`application/octet-stream`, exact declared length); uploads alone may run longer than the standard 30-second request limit. An in-process processor inspects and converts each upload with FFmpeg into a display rendition and a thumbnail, and the item becomes `READY` or `REJECTED` with a reason. Content is served with range support, `nosniff` and a sandboxing CSP. Archive, delete (to a 30-day trash), restore and discard use expected versions; registered reference guards block deleting media in use. FFmpeg/ffprobe 6.1 or later are required; production refuses to start without them. The [two-company suite](test/media/integration.test.ts) processes synthetic media with real FFmpeg against migrated PostgreSQL.

## Identity and contract

The shared [token verifier](src/authentication.ts) accepts verified `at+jwt` tokens signed with RS256 or ES256 by the configured issuer for the configured audience. It validates expiration and requires nonempty `sub`, valid issuance/expiry timing, a stable `orion_principal_id` UUID, `orion_actor_type=human`, and a string `scope`. It yields the principal ID and the issuer-granted scopes; product modules also enforce current session and application-owned memberships. Stored ownership must survive provider changes; request bodies cannot grant identity or capability. The [authentication policy](../../docs/security/authentication.md) and [ADR-0012](../../docs/adr/0012-verify-jwt-access-tokens-at-the-first-api-boundary.md) govern this boundary. Keycloak is selected and locally qualified; no real environment is provisioned.

Executable module contracts own operations, stable operation IDs, typed inputs/outputs, and expected failures. The [OpenAPI reference](../../docs/generated/api/openapi.json) includes health and every composed module's operations; the [error reference](../../docs/generated/api/errors.md) derives from the shared and module registries.

## Request protection

A module that exposes authenticated routes should apply request limiting before token verification and database access, as the reference module does with a process-local source-IP limit; health probes stay outside it. Exhaustion returns `429 RATE_LIMITED` in the public envelope with a bounded `Retry-After`. This is resource protection, not a product quota.

Process-local limiting uses the direct peer address; trusted proxies are not configured. A multi-replica or reverse-proxy deployment must define shared/edge limiting and trusted client-IP handling before promising fleet-wide or per-user limits.

## Lifecycle and diagnostics

`main.ts` validates configuration, initializes Pino/OpenTelemetry, then dynamically imports Fastify, Prisma, and composed modules before listening. Preserve that order for instrumented infrastructure. Incoming W3C trace context propagates; each request receives a fresh server-generated `x-request-id`. Errors follow the [public envelope](../../docs/api/error-contract.md). Logs and traces identify the service by the API package name.

Startup reports initialization, liveness reports process-local health, and readiness becomes unavailable while draining or when a configured database is unavailable. A configured database is probed before readiness and through a bounded readiness check. SIGINT/SIGTERM trigger bounded HTTP, database, and telemetry shutdown.

Logs and exported spans/metric dimensions use allowlisted operational fields. The runtime does not log payloads, raw URLs, headers, configuration objects, or arbitrary exception messages. Unexpected failures produce one sanitized diagnostic occurrence. A readiness failure or a lost response cannot prove that a prior write failed; see [delivery and side effects](../../docs/architecture/delivery-and-side-effects.md).
