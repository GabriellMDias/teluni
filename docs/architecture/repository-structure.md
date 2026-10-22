# Repository Structure

[Documentation index](../README.md) · [Application boundaries](application-boundaries.md) · [Dependency rules](dependency-rules.md)

This page owns repository placement and local discovery. [ADR-0002](../adr/0002-select-pnpm-for-package-and-workspace-management.md) governs workspace management; [ADR-0003](../adr/0003-establish-repository-validation-and-architecture-enforcement.md) governs enforcement. Organize by responsibility so humans and agents can change one area without loading the whole repository.

## High-Level Structure

These locations exist:

| Location | Responsibility and entry point |
| --- | --- |
| Repository root | Repository-wide instructions, workspace/lockfile, dependency and validation configuration. Start with [README](../../README.md) and [AGENTS.md](../../AGENTS.md). |
| `apps/api/` | Fastify executable, composed API modules, API-owned contracts, Prisma schema/migrations, and runtime/generation tests. Start with its [README](../../apps/api/README.md). |
| `apps/web/` | React/Vite workflow and Living Documentation Portal, browser configuration, components, and tests. Start with its [README](../../apps/web/README.md). |
| `apps/player/` | Android TV player: a Gradle build outside the pnpm workspace whose `core` module holds the screen's rules on the JVM (ADR-0031). Start with its [README](../../apps/player/README.md). |
| `packages/sdk/` | Public API client and generated OpenAPI types. Start with its [README](../../packages/sdk/README.md). |
| `infra/pilot/` | Declarative pilot deployment: the container images, Compose composition, reverse proxy, PostgreSQL bootstrap, backup and restore, systemd timers and the rehearsal CI runs. Start with its [README](../../infra/pilot/README.md). |
| `docs/` | Current policy, domain meaning, accepted decisions, implementation tracking, and generated references. Start with the [task index](../README.md). |
| `tooling/validate/` | Repository documentation, agent-instruction, environment-example, and release-history checks. |
| `tooling/documentation/` | Portal dataset and component-reference generation. |
| `tooling/project/` | Project initialization, pruning, provenance, and Orion upgrade commands and the project-owned file templates; see [project derivation](../project-derivation.md). |
| `.orion/` | [`project.json`](../../.orion/project.json): repository identity and, in derived projects, Orion provenance; [`derivation.json`](../../.orion/derivation.json): the clean-baseline contract of foundation-only and project-owned content. |
| `.gemini/` | Gemini CLI discovery adapter only; see [agent instructions](agent-instructions.md). |
| `.github/` | GitHub CI configuration; [CI policy](continuous-integration.md) separates repository configuration from effective remote settings. |

`docs/project/` exists only in projects derived from Orion, where it holds the project-owned plan and human actions. There is no mobile, desktop, worker, or general shared domain/database/UI package. Their possible responsibilities below are placement rules, not an instruction to create them. Do not create empty directories to mirror a conceptual architecture. The physical repository must represent the current system.

Keep the root small: application-specific implementation belongs to its application; runtime sharing belongs to a meaningful package; repository automation belongs under `tooling/`. Introduce `infra/` only for real declarative deployment/operational infrastructure, never ordinary business logic. Infrastructure may consume application artifacts and configuration requirements; runtime code must not import infrastructure definitions.

## `apps/`

An application is an independently meaningful executable runtime or delivery surface. It owns its entry point, lifecycle, configuration, dependency composition, build, runtime integrations, telemetry initialization, and platform-specific behavior. Its local guide should make purpose, public interfaces, dependencies, commands, operational characteristics, and any deployment assumptions discoverable.

Applications must not import another application's implementation or become shared backend libraries. Runtime communication uses explicit contracts; genuine shared implementation may move into a package. See [application boundaries](application-boundaries.md) for trust, persistence, communication, and extraction decisions.

### Creating a New Application

Establish the concrete runtime/delivery need, why an existing application cannot own it, public contracts, dependencies, data ownership, configuration, observability, failure modes, and deployment/distribution expectations. A significant new boundary normally requires an ADR. Prefer logical modularity before physical distribution; code size alone does not justify another runtime.

## `packages/`

Packages define cohesive shared responsibilities, intentional public APIs, allowed consumers/dependencies, private implementation, and runtime/platform compatibility. Consume a package through its public exports rather than arbitrary internal paths. Packages must not depend on applications. Avoid both one package per small utility and broad `common`, `shared`, or `utils` dumping grounds.

The SDK is currently the only shared package. Extract other capabilities only when ownership or reuse warrants it:

| Responsibility | Constraint if extracted |
| --- | --- |
| Domain concepts and business behavior | Platform-independent where useful; no unnecessary HTTP, UI, database, telemetry-vendor, or filesystem dependency. A domain package is not mandatory for application-local business logic. |
| Communication contracts | Canonical wire schemas, identifiers, errors, or events; internal models do not automatically become public contracts. |
| Database infrastructure | Schema, migrations, client setup, metadata, or shared persistence primitives; sharing infrastructure does not grant unrestricted table access. |
| Observability | Consistent logging, context, propagation, metrics, reporting, and redaction semantics; isolate vendors only where that provides a meaningful boundary. |
| Configuration | Shared validation/loading primitives; application-specific configuration remains owned by its application. |
| Testing | Genuinely reusable fixtures, factories, assertions, or infrastructure; behavior tests remain near their owner. |
| UI | Shared design tokens or components only where runtime, interaction, and accessibility semantics are compatible; do not force cross-platform component reuse. |

### Creating a New Package

First search existing owners. Explain the cohesive responsibility, actual consumers, public API, allowed dependency directions, platform constraints, and architectural benefit. A second consumer alone does not justify extraction: consumers must share meaning, not just similar code. Prefer simple local duplication over an abstraction with conflicting responsibilities. A package should make ownership and the dependency graph clearer.

## Feature Organization

Keep related behavior together by feature/domain where practical. Technical layers may exist inside a feature, but do not impose a folder per layer on small cohesive code. API modules live in `apps/api/src/features/<module>/`, typically as flat domain, service, persistence, contracts, errors, and route files; [Orion's reference implementation](../project-derivation.md#orions-reference-implementation) is a complete example. Domain behavior may stay application-local until sharing has value.

Tests normally live near the behavior they protect or in the owning application's test directory; broader system tests may need dedicated locations. Use the [testing strategy](testing-strategy.md) for existing topology and test boundaries. Name directories/packages in English by domain, capability, or responsibility rather than historical accidents.

## Documentation and Generated Artifacts

[Contributing](../contributing.md#documentation-ownership) owns documentation placement and canonical-source rules. Repository policy lives under `docs/`; application/package knowledge belongs near its owner. Documentation may reference implementation, but ordinary application behavior must not depend on parsing human-authored policy. If behavior needs machine-readable rules, give those rules a canonical machine-readable source. Documentation-as-product content, such as the portal, is an intentional exception.

Generated code and references must be distinguishable from authored files, reproducible, and linked to their source/generator. Current locations and handling are defined by [artifact ownership](backend-execution-and-generated-artifacts.md#artifact-ownership-and-storage) and [living documentation](living-documentation.md). Generated clients are consumers of contracts, never their authority. Reviewed SQL migrations follow their separate release-history rules.

## Local Agent Instructions

Read root [AGENTS.md](../../AGENTS.md), then each applicable nested file before editing an area. Nested instructions add local conventions, important files, commands, or prohibited patterns; they do not remove global requirements or copy repository-wide policy. Current scopes include [API](../../apps/api/AGENTS.md), [web](../../apps/web/AGENTS.md), [player](../../apps/player/AGENTS.md), [SDK](../../packages/sdk/AGENTS.md), [documentation](../AGENTS.md), [ADRs](../adr/AGENTS.md), and [runbooks](../runbooks/AGENTS.md).

Every tool reads the same files; [agent instructions](agent-instructions.md) owns tool compatibility and forbids instruction copies. Add a local instruction file only when the area needs additional guidance. Keep commands near the owner and link canonical policy so agents receive useful context without independently maintained copies.

## Enforcement

[Dependency rules](dependency-rules.md#mechanical-enforcement) identify the implemented import checks and their limits. Runtime code must not depend on repository tooling; tooling may inspect application/package sources. Public package boundaries, domain/data ownership, and shared meaning still require review where no mechanical rule exists. Extend enforcement with real new boundaries rather than describing future checks as available.
