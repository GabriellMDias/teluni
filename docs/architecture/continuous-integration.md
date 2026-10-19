# Continuous Integration

This page owns the map from repository CI configuration to the accepted policy in [ADR-0011](../adr/0011-establish-continuous-integration-dependency-automation-and-supply-chain-security-strategy.md). See [validation availability](../validation.md) for local commands. Effective remote settings and completed-run evidence have a separate owner in the repository's human-action checklist (linked from the README's [Current state](../../README.md#current-state)).

## Current implementation and activation

The [repository workflow](../../.github/workflows/ci.yml) validates pull requests to `main`, pushes to `main`, merge-queue commits, and manual dispatches. It uses repository-pinned Node.js/pnpm and frozen installation, installs Playwright Chromium/system libraries and the distribution FFmpeg used by media tests, and runs `pnpm validate` on GitHub-hosted Ubuntu. It fetches Git history and supplies the base commit for release-history validation. The stable branch-protection check name is **Orion required gate**; it fails if validation fails or does not finish successfully. Superseded pull-request runs are cancelled; primary-branch runs are not. No diagnostic artifacts are uploaded. Future uploads need bounded retention and must exclude secrets/sensitive data.

The workflow passes the PR base SHA, merge-group base SHA, or `github.event.before` unchanged to the release-history validator. That shared validator handles GitHub's first-push zero-SHA sentinel under the [release-history rules](../database/release-evolution.md#record-the-first-durable-migration-boundary), so local and CI checks enforce the same missing-base and append-only protections. Manual dispatches without an explicit base use the validator's local Git-base discovery.

The dependency-review job runs on pull requests when `DEPENDENCY_REVIEW_ENABLED=true` and blocks newly introduced high/critical vulnerabilities. The aggregate gate treats an enabled review that fails or skips as a failure. The repository's human actions record dated evidence and how to reverify the variable, security settings, and actual review execution.

The [Renovate configuration](../../renovate.json) selects the recommended baseline, Dependency Dashboard, weekly routine cadence, grouped compatible TypeScript/lint updates, majors requiring dashboard approval, SHA-pin maintenance, and no automerge. Vulnerability-remediation pull requests are not held to the routine schedule. The repository's human actions own app activation/Dashboard and effective branch-protection evidence.

Committed workflow/configuration does not prove current GitHub activation, entitlement, branch protection, or a successful remote run. Effective settings belong to each repository: a project derived from Orion inherits this configuration but none of Orion's activation evidence, and tracks its own settings in its [project human actions](../project-derivation.md#content-ownership). Reverify effective settings when relying on them; do not turn dated acceptance evidence into an undated live assertion.

## Read for this change

| Change | Governing decision section |
| --- | --- |
| Local/CI command parity and incremental capabilities | [Canonical validation contract](../adr/0011-establish-continuous-integration-dependency-automation-and-supply-chain-security-strategy.md#canonical-validation-contract) |
| Required PR gate, primary-branch checks, manual runs | [Pull-request validation](../adr/0011-establish-continuous-integration-dependency-automation-and-supply-chain-security-strategy.md#pull-request-validation) and [required gate](../adr/0011-establish-continuous-integration-dependency-automation-and-supply-chain-security-strategy.md#required-ci-gate) |
| Runner, versions, lockfile, caching, concurrency | [Execution environment](../adr/0011-establish-continuous-integration-dependency-automation-and-supply-chain-security-strategy.md#ci-execution-environment) through [pull-request concurrency](../adr/0011-establish-continuous-integration-dependency-automation-and-supply-chain-security-strategy.md#pull-request-concurrency) |
| Integration/browser tests and artifacts | [Integration infrastructure](../adr/0011-establish-continuous-integration-dependency-automation-and-supply-chain-security-strategy.md#integration-test-infrastructure) and [testing strategy](testing-strategy.md) |
| Permissions, action pins, untrusted PRs, secrets, OIDC | [Actions security](../adr/0011-establish-continuous-integration-dependency-automation-and-supply-chain-security-strategy.md#github-actions-security) |
| Renovate cadence, grouping, majors, automerge, lockfiles | [Dependency automation](../adr/0011-establish-continuous-integration-dependency-automation-and-supply-chain-security-strategy.md#dependency-automation) |
| Dependency review, scanning, feature availability, licenses | [Dependency security alerts](../adr/0011-establish-continuous-integration-dependency-automation-and-supply-chain-security-strategy.md#dependency-security-alerts) and subsequent security sections |
| Validation mutations, reusable workflows, CI versus CD | [CI-generated modifications](../adr/0011-establish-continuous-integration-dependency-automation-and-supply-chain-security-strategy.md#ci-generated-modifications) and [continuous delivery](../adr/0011-establish-continuous-integration-dependency-automation-and-supply-chain-security-strategy.md#continuous-delivery) |

## Policy boundaries

GitHub Actions uses the same repository validation capabilities as local development. GitHub-hosted Linux is the initial runner, with repository-pinned versions and frozen lockfile installation. The primary branch must require the stable aggregate gate; effective activation is verified separately as described above. Validation must not silently fix tracked sources.

Renovate owns version-update automation, with routine weekly grouping and automerge disabled initially. Dependabot vulnerability alerts are a separate capability, not a second version-update system. GitHub security features retain the availability and entitlement qualifications in the ADR; paid security features are not a mandatory architectural dependency.

Deployment, release approvals, rollback environments, and CD remain deferred until concrete deployment requirements exist. Use [secrets management](../security/secrets-management.md), [production access](../security/production-access.md), and [retention](../security/data-retention.md) for those cross-cutting policies. Local validation commands are listed in [validation](../validation.md); remote run results and effective settings must be verified separately.
