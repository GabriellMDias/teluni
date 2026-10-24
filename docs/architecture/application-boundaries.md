# Application Boundaries

[Documentation index](../README.md) · [Repository placement](repository-structure.md) · [Dependency rules](dependency-rules.md)

Applications are executable boundaries with explicit ownership; sharing a monorepo does not merge their runtime, trust, or persistence responsibilities. This page owns runtime separation and composition. [ADR-0004](../adr/0004-select-fastify-as-the-backend-http-framework.md) governs the API adapter and [ADR-0008](../adr/0008-select-react-vite-and-tanstack-for-web-applications.md) the web stack.

## Types of Boundaries

| Boundary | Required reasoning |
| --- | --- |
| Runtime/process | Separate processes are distributed participants even when deployed together. Use explicit protocols and account for network failure, timeouts, partial results, retries, and duplicate requests. Remote operations are not local function calls. |
| Deployment/distribution | Versions may coexist. Define supported old/new combinations and migration requirements under [compatibility policy](versioning-and-compatibility.md). |
| Trust | Validate data crossing security contexts, including external-provider responses. Client applications remain untrusted regardless of repository proximity. |
| Persistence | Access follows explicit application/domain ownership. A shared database client does not authorize every module to access every table. |

Applications must not import another application's internal implementation. Share genuinely common capabilities through public package APIs and communicate through deliberate runtime contracts. A package must not become an indirect way to bypass another application's boundary.

## Backend API Application

The implemented `apps/api` uses Fastify and Pino. It owns HTTP parsing/validation, authentication integration, authorization enforcement, correlation, transport error mapping, application orchestration, dependency composition, telemetry, and health endpoints. Plugins organize runtime integration; they do not define business domains.

Keep HTTP requests/responses, status codes, headers, cookies, and framework concepts at the transport boundary unless the operation is inherently transport-specific. Map validated application input to business operations and map their outcomes back to public responses. Exposing a rule through HTTP does not make it transport logic.

The API is an executable application, not a shared backend library. If another runtime needs the same business capability, establish shared ownership explicitly instead of importing API internals. Each [API module](../../apps/api/README.md#modules) owns its capability inside the API.

## Web Application

The implemented `apps/web` is a React/Vite client-first SPA. TanStack Router owns URLs/navigation, TanStack Query owns server state through the generated SDK, and React state/context owns local UI state. The accepted direction includes React Compiler when compatible. No general global-state library or full-stack web framework is selected by default; server rendering requires product justification. Fastify retains authoritative backend responsibilities.

The web application owns pages/layouts, interactions, accessibility, browser rendering/storage, local state, web authentication integration, client composition, localization, and any frontend telemetry. Keep DOM/navigation and other browser-specific behavior local unless a genuinely compatible shared responsibility exists. UI components can share visual concepts without sharing implementation across platforms.

The browser can be inspected, modified, bypassed, replayed, or automated. Client validation and hidden/disabled controls improve experience; trusted backend boundaries still enforce validation, identity, permissions, and business invariants. Clients receive neither database credentials nor privileged server secrets. See [authentication](../security/authentication.md) and [authorization](../security/authorization.md).

## Shared Contracts

The [internal documentation portal](living-documentation.md#build-and-deployment-boundary) reuses the web toolchain behind a compile-time distribution boundary. Its UI is an engineering tool and imposes no layout, navigation, or identity on a product. Product help and public API documentation have separately approved sources and application-owned presentation; sharing a repository does not grant publication authority.

Cross-application requests, responses, events, errors, identifiers, and serialization/validation rules need explicit ownership. Current API wire contracts generate OpenAPI and the SDK; the web application does not consume API implementation types. See [API principles](../api/principles.md) and [artifact ownership](backend-execution-and-generated-artifacts.md#artifact-ownership-and-storage).

Database records, domain entities, application results, wire responses, and view models have different responsibilities even when their shapes match. Share representations only when their meaning matches; otherwise map deliberately. Do not expose ORM models as public responses accidentally or manually duplicate a canonical public contract.

Compile-time sharing and runtime communication are different: a shared type does not execute another application's behavior. Choose HTTP, messages, events, IPC, or another explicit mechanism from actual needs. Prefer synchronous calls when callers require immediate results; introduce asynchronous work for real latency, retry isolation, temporal decoupling, or independent-consumer needs. A queue is not a remedy for an unwanted import dependency.

## Composition and Ownership

Executable applications select and wire concrete adapters at bootstrap. Dependencies should be visible through explicit composition; a dependency-injection framework is not required. Minimize mutable globals and service locators. Process-scoped connection pools and telemetry providers are reasonable when lifecycle and access are intentional.

Business capabilities have one identifiable home regardless of how many applications expose them. Delivery-specific feature directories do not authorize cross-application imports or independent reimplementation of core rules. Workers and administrative CLIs must preserve the same invariants as equivalent API operations.

The default data path is client → trusted backend → owned persistence → database. Multiple trusted runtimes may share controlled persistence when they belong to an explicitly shared logical ownership model. Modifying another service's owned tables is architectural coupling, not a shortcut. See [database ownership](../database/principles.md).

External providers should be isolated enough to contain meaningful provider-specific risk and ownership. Do not spread a provider SDK throughout business behavior, but do not wrap every third-party library without benefit. A Backend for Frontend requires a concrete client orchestration, latency, identity, aggregation, or independent-evolution need; multiple clients alone do not justify it.

## Additional Runtime Boundaries

These are conditional rules, not implemented applications:

| Runtime | Local responsibility and additional obligations |
| --- | --- |
| Mobile | Device capabilities, native UI/navigation, secure local storage, offline behavior, notifications, permissions, and lifecycle. It remains an untrusted client; installed old versions may require a documented longer API support window. |
| Desktop | OS/filesystem integration, local caching, credential storage, updates, UI, and lifecycle. Possession of a binary does not confer backend trust. |
| Worker | Queue/schedule/event processing or long-running work. Define retries, idempotency, duplicate delivery, ordering, dead letters, poison messages, concurrency, timeouts, telemetry, and graceful shutdown; never assume exactly-once execution without evidence. |
| CLI | Command parsing, terminal interaction/output, command lifecycle, and identity integration. Administrative convenience cannot bypass domain or access controls. |

Events must describe meaningful facts or integration signals with owned schemas, delivery guarantees, ordering, and compatibility. Follow [delivery and side effects](delivery-and-side-effects.md) for reliable processing. Remote calls need deliberate bounded timeout/retry behavior; evaluate whether an error is transient, effects can repeat safely, and retry load will worsen the failure.

## Creating a New Application Boundary

Before creating or splitting an application, identify:

1. The runtime/product responsibility and why an existing application cannot own it.
2. Needed scaling, deployment/distribution independence, security, failure isolation, or operational ownership.
3. Exposed/consumed contracts, shared packages, persistent-data ownership, and trust boundaries.
4. Configuration, lifecycle, telemetry, compatibility, and new failure modes.
5. Whether the value justifies its operational complexity and requires an ADR.

Establish a logical modular boundary before extracting another process. Size alone does not justify splitting; merging is appropriate when separate applications add no meaningful independence. Microservices are not a default goal, and serverless deployment units do not determine domain boundaries. Prefer modular ownership within one backend until separation has a concrete benefit.

Local [README and agent instructions](repository-structure.md#local-agent-instructions) make each application independently understandable without repeating repository policy. When placement is unclear, distinguish runtime-specific behavior, genuinely shared domain meaning, shared wire contracts, development tooling, and operational infrastructure before creating a new owner.

## Boundary Enforcement

The existing [dependency checks](dependency-rules.md#mechanical-enforcement) reject cross-application imports and other forbidden edges. They do not prove runtime trust, data ownership, or contract compatibility. When a boundary obstructs a legitimate requirement, identify the correct owner, try its existing public contract, then deliberately extend or revise the boundary and its tests/enforcement. Document significant changes through the ADR process; do not bypass constraints silently.
