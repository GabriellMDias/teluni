# Teluni

Teluni is a planned multi-tenant digital signage SaaS built on the [Orion](https://github.com/GabriellMDias/Orion) engineering foundation. It will let companies centrally manage images, videos, playlists and schedules on displays, with reliable offline playback. Brazil is the initial market, with international use anticipated. The core is intended for multiple business segments, from a single shop to a branch network.

**Every screen. One place.** · **Todas as suas telas. Um só lugar.**

Start with the [product documentation](docs/project/README.md) for the vision, initial release policies/acceptance targets, accepted architecture directions, pending detailed design, risks and delivery phases. The name Teluni and principal domain `teluni.app` are approved; [branding](docs/project/branding/README.md) records the defensive `teluni.com.br` option, current exclusion of `teluni.com`, and the approved Connected Tiles identity. Domain registration/control evidence and trademark outcome remain pending. The owner approved [initial commercial policies](docs/project/commercial-policies.md) and validation prices; actual customer acceptance, costs, capacity and billing readiness remain unverified.

## Current state

This repository was initialized on 2026-10-17 from Orion commit `53bcc705a9f68f01aa1bbea3a0f4df4a009577ea`. It contains the foundation's architecture, policies, accepted ADRs, tooling, validation gate, CI, generated references, and [Living Documentation Portal](apps/web/README.md#living-documentation-portal). The API and web application compose `identity` (Keycloak login, server-managed human sessions and OTP step-up) and the first `organizations` increments (companies, creator memberships, scoped standard-role access, branches, company settings, paginated change history, member administration, role grants, responsibility transfer and email invitations), with a `mail` module that delivers transactional email through a PostgreSQL outbox, and `devices` (screen pairing with temporary codes and device-generated credentials, configuration, moves and unlinking with erasure tracking), `media` (a company media library with uploads, FFmpeg processing into playback renditions, archive and trash) `programming` (playlists, layouts with catalog views and pages, programming groups, programs with a layout's areas as outputs, schedules in local time, screen assignments and timelines), `catalogs` (typed catalogs with exact prices per branch, promotions, an effective-price preview and automatic price publication to the screens that show them) and `publications` (immutable publications of programs, in protocol 2 with layouts and catalog snapshots for programs with a layout, screen synchronization with signed authorization statements and screens' reported state). The [identity/access policies](docs/project/identity-and-access.md) and D-01/D-02 designs are owner-approved. Tests use disposable Keycloak/PostgreSQL; real-environment provisioning and qualification remain pending. The [Android TV player](apps/player/README.md) has its JVM `core` (schedules, protocols 1 and 2 with layouts and catalog prices, statements, trusted time, storage and synchronization); its Android application is not built yet.

The [project plan](docs/project/implementation-plan.md) and [project human actions](docs/project/human-actions.md) own this repository's current work and external prerequisites. The [project manifest](.orion/project.json) records the project identity, the immutable initialization commit, and the Orion baseline currently integrated. [Project derivation](docs/project-derivation.md) explains how to inspect provenance and adopt newer Orion revisions through reviewed merges.

The initial product brief is documented. Real email sending (the D-13 [invitation and email delivery design](docs/project/invitation-delivery-design.md) is implemented locally with Mailpit; a real sender awaits PH-17), custom profile capabilities beyond the organization module, identity recovery qualification, the Android TV player's application and device qualification, and production deployment remain unfinished. The owner accepted the [product architecture directions](docs/project/architecture.md) in ADR-0018–ADR-0021 and ADR-0023–ADR-0025 on 2026-10-18. The D-01 [tenant data](docs/project/tenant-data-design.md) and D-02 [identity/session](docs/project/identity-session-design.md) designs were approved that day with an explicit request to implement PJ-24/PJ-03. Their implementation status and remaining work are recorded in the designs and plan; other detailed designs and release-readiness checks remain pending. No real-environment deployment is authorized by those approvals. The [pilot deployment](infra/pilot/README.md) of the D-08 [deployment design](docs/project/deployment-design.md) is built and rehearsed locally and in CI; installing it on a real host awaits PH-10.

## Start here

| Task | Entry point |
| --- | --- |
| Understand Teluni's product, release policies/targets, proposed modules, risks and roadmap | [Product documentation](docs/project/README.md) |
| Find the policy for a change | [Documentation task index](docs/README.md) |
| Understand contributor and agent obligations | [Global instructions](AGENTS.md), [contributing workflow](docs/contributing.md), [agent tool compatibility](docs/architecture/agent-instructions.md) |
| Understand architecture and code placement | [Principles](docs/architecture/principles.md), [repository structure](docs/architecture/repository-structure.md) |
| Add a product capability | [API modules](apps/api/README.md#modules), [web modules](apps/web/README.md#modules), [Orion's reference implementation](docs/project-derivation.md#orions-reference-implementation) |
| Find a selected technology or its rationale | [Technology map](docs/architecture/technology-decisions.md), [ADR index](docs/adr/README.md) |
| Determine available verification | [Validation](docs/validation.md) |
| Reproduce the local workflow | [Development setup](docs/setup.md) |
| Explore local guides, architecture, API routes, data, and components | [Portal setup](docs/setup.md#living-documentation-portal), [living documentation architecture](docs/architecture/living-documentation.md), [AI-readable references](docs/README.md#apis-and-data) |
| Find outstanding work or required owner decisions | The plan and human actions linked from [Current state](#current-state) |
| Inspect provenance or adopt a newer Orion revision | [Project derivation](docs/project-derivation.md) |
| Create an operational procedure | [Runbooks](docs/runbooks/README.md) |

Accepted architecture and implemented capability are different states. Consult the [technology map](docs/architecture/technology-decisions.md) for selected directions and deliberately deferred choices, and [validation availability](docs/validation.md) for current checks. With Node.js 24.13.0 and pnpm 11.25.0, follow the canonical [development setup](docs/setup.md) for installation, local environment loading, execution, and the full gate.

Directory trees in architecture documents describe intended responsibilities, not proof that those directories exist. The physical repository takes precedence over illustrations. English is the canonical repository language; product localization is separate.

## License

Teluni repository source and documentation are licensed under the [Apache License, Version 2.0](LICENSE) (`Apache-2.0`), including independently developed Teluni material. [ADR-0022](docs/adr/0022-license-teluni-under-apache-2-0.md) records the product owner's decision. Material inherited from Orion retains its Apache-2.0 license and provenance; third-party dependencies and separately licensed material retain their own terms.
