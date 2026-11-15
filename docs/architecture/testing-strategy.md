# Testing Strategy

[Documentation index](../README.md) · [Validation commands](../validation.md) · [Local setup](../setup.md)

Tests protect behavior, contracts, invariants, security, and architectural boundaries. Ask which important defect a test would detect, then choose the cheapest reliable boundary. [ADR-0009](../adr/0009-establish-testing-strategy-and-tooling.md) owns the accepted tools and rationale; [ADR-0011](../adr/0011-establish-continuous-integration-dependency-automation-and-supply-chain-security-strategy.md) owns CI policy. These tools and the suites below are implemented.

## Test Categories

| Boundary/risk | Execution and existing location |
| --- | --- |
| Pure domain, parser, client logic | Vitest in Node; API tests under `apps/api/test/`, web API tests under `apps/web/test/`. |
| API transport/application | Fastify request injection with real owned behavior; real sockets when listener, network, or process lifecycle is the subject. |
| PostgreSQL persistence/transactions | Vitest with Testcontainers and committed migrations; API integration/failure tests use the migrated-database helper. |
| Browser components | Vitest Browser Mode with Playwright, `apps/web/test/*.browser.test.tsx`; Windows uses installed Edge, other environments use Chromium. |
| Full user journeys | Playwright Test, `apps/web/test/e2e/`; the real built API and web app for the shell and portal, plus migrated PostgreSQL and synthetic signed identities in module journeys under `test/e2e/<module>/`. |
| Emitted runtime | API process and feature smoke scripts verify startup/lifecycle and the real feature flow. |
| Structure and generation | Type/lint/import checks, documentation links/metadata, environment example, release-history checks, API/SDK/portal freshness. |

Coverage, performance/load/stress, mutation testing, additional browser matrices, external provider sandboxes, and deployment smoke/monitoring are introduced only when their risk or product requirement exists. Performance tests need measurable targets; stable microbenchmarks can inform critical algorithms but do not replace realistic system measurements. Chromium is the routine E2E baseline; browser support must not be guessed globally. V8 is the selected Vitest coverage provider when coverage becomes useful, with no initial global coverage threshold.

Browser component files run sequentially in the [browser configuration](../../apps/web/vitest.browser.config.ts), using [Vitest's `fileParallelism` option](https://vitest.dev/config/fileparallelism). Concurrent startup intermittently failed dynamic module imports before test collection in CI, across different files. Sequential file loading limits that startup contention while retaining per-file isolation, every assertion and the existing test timeouts. It does not add retries or change API/Node test scheduling. Verify startup changes with a fresh Vitest optimizer cache as well as the normal suite.

## Test Selection

Prefer focused tests for local rules, real integration for infrastructure semantics, browser component tests for browser behavior, and a small set of representative critical E2E success/failure journeys. A rigid numerical pyramid is not required. Do not use a browser for a pure calculation, a mock for a database constraint, or a full stack for a component interaction a smaller test can prove.

A unit is a cohesive responsibility, not necessarily one function/class/file. Test stable public behavior; avoid private-helper choreography, framework-dependent domain code, test-only production APIs, and interfaces created only to make everything mockable. Explicit dependencies improve testability when they reflect real architecture.

Before changing behavior, inspect existing tests and contracts, identify failure risks and missing coverage, and select meaningful layers. Fixes should reproduce the defect with a test that fails before and passes after where practical; otherwise document the reason and verification. Low-impact prose/formatting changes need appropriate checks, not ceremonial behavior tests. Security, data loss, financial impact, irreversibility, compatibility, and rollout complexity warrant stronger complementary evidence.

## Real Database Tests

Use PostgreSQL when correctness depends on constraints, SQL/types, indexes, ORM mapping, locking, transactions, or custom migrations. SQLite, mocked Prisma, or an in-memory repository cannot prove those semantics. Create isolated disposable infrastructure using committed migrations; never rely on a manually maintained shared database or silently skip core checks when the container runtime is unavailable.

Current helpers own disposable PostgreSQL and separate migration/runtime roles. Preserve reliable isolation when reordering, selecting, or parallelizing tests. Rollback wrappers can hide commits, multiple connections, background work, and transaction boundaries; use them only when suitable. Choose reset/schema/database/unique-data strategies by correctness first, then measured cost.

Migration validation covers fresh creation and, when an actual supported release exists, upgrade from that exact baseline with representative permitted data and supported old/new application combinations. A fresh database is not upgrade proof. [Migration policy](../database/migrations.md) governs verified unreleased history versus immutable released history; [release evolution](../database/release-evolution.md) owns the procedure.

## Contracts and Failure Behavior

Validate requests/responses/errors/serialization against canonical contracts rather than independently copied expectations. Exercise the actual API transport for routing, validation, identity, headers, status, and safe serialization; reserve network-level execution for behavior that needs it. Contract compatibility must reflect real independently evolving consumers.

Important tests include atomic rollback, concurrent writes/stale versions, repeat idempotency, duplicate/reordered delivery, transient/permanent retry classification, attempt bounds, timeout/unknown outcomes, final failure, partial effects, and failed compensation where applicable. Use controlled time to avoid waiting production timeout durations. Follow [delivery](delivery-and-side-effects.md), [error](error-handling.md), [configuration](configuration.md), and [transaction](../database/transactions-and-concurrency.md) policies for their detailed guarantees.

Generated artifacts need deterministic generation, freshness, and consumer compatibility checks at their source/generation boundaries. Never hand-edit outputs or blindly accept changed golden files. Small meaningful snapshots can help; large DOM/response snapshots should not replace focused assertions. Visual screenshot checks are useful only when visual stability matters and fonts/platform/animation/timing are controlled.

## Security Tests

Test denied behavior, not just successful access: anonymous/invalid/expired/wrong-signature or audience credentials, insufficient capability, wrong owner/tenant, forbidden fields, revoked access, and webhook signatures where those models exist. Tests must follow the actual [authentication](../security/authentication.md) and [authorization](../security/authorization.md) contracts, without inventing unimplemented revocation or tenancy behavior.

Verify that secrets/restricted fields do not reach responses, logs, traces, reports, or client builds. Missing credentials and insecure defaults must fail safely. Redaction tests need positive correlation assertions and negative sensitive-data assertions. Current source/generation checks and bundle markers are useful controls, not proofs of all security semantics.

## Client and Observability Tests

Client tests own presentation, interaction, navigation/state, API failures, and accessibility rather than repeating every backend invariant. Prefer real browsers when semantics matter; jsdom is not the browser-fidelity default. Use locators, readiness signals, and automatic waiting instead of arbitrary sleeps. Automated accessibility tests supplement human review.

Test telemetry when it protects production behavior: request/trace propagation, safe unexpected-error reporting, bounded labels, release context where available, and redaction. Mobile device/offline/permission/storage tests, desktop OS/update tests, and worker delivery tests become relevant only when those capabilities exist.

## Determinism, Doubles, and Data

Tests establish their own minimal synthetic state and must not depend on order, unrelated machine environment, locale/timezone, current wall clock, unseeded relevant randomness, uncontrolled internet, or shared mutable rows/files/caches. Control or make irrelevant time/randomness and use collision-safe identifiers. State cleanup must work under failure and parallel execution; all tests have appropriate bounded timeouts.

Factories should expose the fields that explain the behavior, especially ownership/permissions, and must not become a hidden application layer. Large shared development seeds are not test fixtures. Never use production database dumps or credentials as ordinary fixtures. Use clearly synthetic static secrets unless testing credential detection itself; ephemeral signed test identities remain isolated. Production-derived data needs explicit classification handling and meaningful protection against re-identification; synthetic data remains preferred.

Mocks/fakes isolate external responsibilities such as clocks/providers when the integration itself is outside scope. They must respect the real capability contract and should not make impossible states appear valid except for deliberate failure injection. Mocking every internal class tests choreography. Official provider sandbox suites, when needed, must be isolated, credential-safe, clearly categorized, and separated from uncontrolled dependencies in the ordinary loop; document emulator fidelity limits.

## Test Maintenance and Diagnostics

Name tests for behavior, arrange clear inputs/action/outcomes, and assert the actual result/effect/error code. One coherent behavior can need several assertions. A test should fail for a meaningful defect, remain understandable, and add distinct confidence; some cross-layer overlap is justified for critical guarantees.

Flakiness is a defect. Retries may diagnose environmental instability but must not conceal it. A temporary quarantine needs owner, reason, tracking issue, and removal condition. Skips must be explicit; core correctness cannot disappear because infrastructure is missing. Remove tests only when the protected behavior deliberately changes/disappears, stronger coverage replaces them, or they test obsolete implementation details. Never weaken valid tests to make a change pass.

Treat a failure as evidence: investigate implementation, expectation, intentional contract change, or environment, and reproduce CI locally when possible. Diagnostics should show behavior, expected/actual result, and safe identifiers without noisy dumps. Reports, screenshots, traces, source maps, and logs follow classification/access/retention rules. Current CI does not upload diagnostic artifacts; future uploads need bounded retention.

Keep tests near the owning feature/application; system journeys may have dedicated suites. Shared test infrastructure must have genuine reuse. Document complex suite prerequisites, commands, debugging, and limitations; avoid a speculative taxonomy or orchestrator. Measure/optimize slow suites when feedback cost becomes material, without sacrificing isolation or correctness. Any future affected-test selection must preserve complete dependency coverage rather than trading correctness for speed.

## Canonical Test Commands

[Validation](../validation.md) owns the available script list and prerequisites; [setup](../setup.md) owns reproducible installation/browser/container preparation. Iterate with the relevant owning package command, then run the repository-required `pnpm validate` gate before substantial completion. CI calls the same gate. Runtime tests do not replace TypeScript, architectural checks, or generated-source validation.

The repository gate includes API tests, web Node/browser tests, emitted builds/smokes, and full E2E. Release-history tests intentionally use Node's built-in runner for isolated tooling. No generic root `test:integration` or coverage command should be assumed. Report missing prerequisites, failed checks, and unrun remote checks honestly.

Coverage percentages and branch coverage can reveal missing paths but cannot prove assertions, authorization, or concurrency correct. Use risk-based review instead of arbitrary targets. A complete change preserves meaningful tests, contracts, architecture, and the broader [completion criteria](../contributing.md#change-workflow).

## Initial Testing Policy

The implemented baseline above remains the default for new features. Additional suites must serve actual risk; load/stress tests run only in isolated authorized environments, never as accidental production traffic. Never run destructive integration suites against production data. Any production test must be narrowly scoped and safe, such as an authorized synthetic health check. Production synthetic monitoring and deployment validation require separate operational design and authority; this testing strategy does not start deployment work.
