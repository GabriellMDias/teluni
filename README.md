# Teluni

Teluni is a planned multi-tenant digital signage SaaS built on the [Orion](https://github.com/GabriellMDias/Orion) engineering foundation. It will let companies centrally manage images, videos, playlists and schedules on displays, with reliable offline playback. Brazil is the initial market, with international use anticipated. The core is intended for multiple business segments, from a single shop to a branch network.

**Every screen. One place.** · **Todas as suas telas. Um só lugar.**

Start with the [product documentation](docs/project/README.md) for the vision, MVP acceptance criteria, proposed architecture, risks and delivery phases. Teluni is the intended identity; trademark/domain verification and commercial pricing remain pending.

## Current state

This repository was initialized on 2026-10-17 from Orion commit `53bcc705a9f68f01aa1bbea3a0f4df4a009577ea`. It contains the foundation's architecture, policies, accepted ADRs, tooling, validation gate, CI, generated references, and [Living Documentation Portal](apps/web/README.md#living-documentation-portal), and no product modules yet: the API serves only health endpoints, and the web application shows its shell and the portal. A concrete authentication provider and production environment have not been selected.

The [project plan](docs/project/implementation-plan.md) and [project human actions](docs/project/human-actions.md) own this repository's current work and external prerequisites. The [project manifest](.orion/project.json) records the project identity, the immutable initialization commit, and the Orion baseline currently integrated. [Project derivation](docs/project-derivation.md) explains how to inspect provenance and adopt newer Orion revisions through reviewed merges.

The initial product brief is documented. Tenant workflows, media/programming/publication modules, the Android TV player, and production deployment remain unimplemented. The [product architecture](docs/project/architecture.md) and ADR-0018 through ADR-0021 are proposals for review; this documentation does not authorize their implementation.

## Start here

| Task | Entry point |
| --- | --- |
| Understand Teluni's product, MVP, proposed modules, risks and roadmap | [Product documentation](docs/project/README.md) |
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
