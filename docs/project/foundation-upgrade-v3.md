# Orion v3.0.0 Upgrade

[Project plan](implementation-plan.md#orion-v300-foundation-upgrade) · [Official workflow](../project-derivation.md#upgrade-to-a-newer-orion-revision) · [Human actions](human-actions.md)

## Identity and scope

PJ-42 adopts the published [Orion v3.0.0 release](https://github.com/GabriellMDias/Orion/releases/tag/v3.0.0) on the owner's 2026-10-23 instruction. The tag resolves to `aafb920a3616f51c0da4b145dbee61a4bf5c3cc7`. Git verifies that the original baseline `53bcc705a9f68f01aa1bbea3a0f4df4a009577ea` is its ancestor and that the release commit is an ancestor of fetched `orion-upstream/main`. The immutable initialization commit stays unchanged.

The upgrade branch is `codex/orion-upgrade-v3.0.0`, based on Teluni `origin/main` at `6e29fb4`. The checkout was clean. The upstream remote is fetch-only, fetches no tags automatically and has no tracking branches. The release tag was fetched explicitly into `refs/orion/releases/v3.0.0`, independently of product tags. Integration uses `git merge --no-ff --no-commit` and the documented pruning, generation and baseline-recording commands.

## Integration decisions

- Preserve Teluni's module compositions, workspace home/sign-in routing, company-scoped navigation, localization, session/CSRF boundaries, light/dark themes, Connected Tiles assets, configurations, player, pilot infrastructure and project documentation. Review automatically merged shared files as well as textual conflicts. Database schemas, migrations, metadata, runtime grants and device/API contracts do not need changes for this release.
- Adopt the Vite documentation-selection helper, fail-closed import guard and emitted-artifact/browser tests. Retain the project-owned conditional route composition and use `__ORION_INTERNAL_DOCS__` consistently. The portal owns its engineering layout; the product retains its existing sidebar and shell. Default production output excludes internal pages, catalogs, search and downloads. Keep Teluni's additional public-bundle check. The pilot Docker build uses this default product boundary; no internal build flags are added to deployment configuration.
- Define the new build constant through the canonical development selection in Teluni's separate Vitest browser configuration, where components import the route composition. This preserves its development-navigation coverage; actual default/internal build tests and E2E cover the distribution boundary. Test assertions and deadlines remain unchanged.
- Keep Vitest's diagnostic attachments ignored alongside Playwright reports, so failed browser checks do not add screenshots to the project's tracked source or publication inputs.
- Adopt Button, TextField, compatible ErrorNotice, the category/owner/scope metadata model, component source validation, examples and design guidance. Map the new UI hooks to Teluni's existing semantic theme tokens; keep feature behavior and existing ErrorNotice wording, operation mapping and localized reload label. No speculative UI framework or feature-form rewrite is introduced.
- Preserve Teluni's Vite 8.3.5 and Vitest 5.0.5; adopt Fastify 5.12.6 and compatible upstream lockfile security corrections. Keep Teluni's workspace package scope, overrides and extra dependencies.
- Prune Orion-only reference implementation and history. Regenerate all portal data from resolved Teluni sources, including deletion of stale foundation-only generated pages.
- Orion's published ADR-0018 collides with Teluni's accepted tenant-data ADR-0018. Preserve both identifiers and accepted meaning; import Orion's record under [its own namespace](../adr/orion/README.md), changing only relative links. Apply the same metadata and index validation within each namespace, with regression coverage for duplicate IDs and invalid imported records.

## Validation and handoff

Regeneration completed with the documented commands: frozen install, `db:generate`, API `references:write`, SDK `generate`, and `docs:references:write`. API/SDK/database/configuration contracts remain unchanged. All validation stages have been qualified, including recovery of the browser configuration integration issue described above:

| Check | Local result, including the final post-baseline aggregate |
| --- | --- |
| Formatting, lint, types, architecture, documentation, agent instructions, environment example, migration history and provenance | Passed; affected configuration/documentation checks repeated after repairs |
| Derivation / documentation generator / distribution isolation | 26 / 21 / 2 tests passed |
| API, including real PostgreSQL, Keycloak and FFmpeg | 323 tests passed |
| Web Node / Chromium component tests | 73 / 95 tests passed |
| Build, public bundle checks and emitted API smoke | Passed; internal portal excluded from the production artifact |
| Chromium E2E | 45 tests passed, including company navigation, both themes, real login/OTP/mail, media, programming and publication/simulated screen synchronization |
| Player `gradle --no-daemon check` | Passed on Linux with Gradle 8.14.3 and JDK 17; all 90 JVM tests |

Linux qualification uses Ubuntu 24.04, the pinned Node/pnpm, Chromium, FFmpeg 6.1, Docker host networking with `TESTCONTAINERS_HOST_OVERRIDE=127.0.0.1`, and `TMPDIR` on a volume satisfying the media reserve and concurrent-rendition capacity. These are local test prerequisites, not product configuration changes. The bridge runner could not reach Mailpit on the separate identity network; the host-network readiness probe and full E2E run passed. No assertions, readiness checks, deadlines or production limits were weakened.

Native Windows qualification remains limited: its Keycloak-image test compares Windows paths with Docker's POSIX paths; the local system volume is below the media policy's ten-percent reserve; and three player tests cannot delete read-only files with Windows semantics. The isolated Fastify transport suite passed all four tests on Windows with its original deadline. The unchanged player and all product flows qualified in Linux.

The initial upgrade qualification reported three existing moderate Nodemailer advisories in Teluni's `nodemailer@10.1.2` dependency (GHSA-8c8m-p3m8-cjg8, GHSA-m943-m63m-w62w and GHSA-85x2-q946-cp5h). The post-upgrade audit below remediates them; existing pilot/security prerequisites remain separate.

The integration commit `6aff2b33db904a6eac844ecfd568fb1aab965bf8` has both Teluni `6e29fb4c69e50fd91a5fc02d0b41269ad4afc324` and Orion `aafb920a3616f51c0da4b145dbee61a4bf5c3cc7` as parents. The official `orion:record-baseline` command fetched and verified canonical upstream ancestry from a clean checkout; commit `1dfd88fd1811b2d518c36de8f1b9e2f224dd9dd8` records the new baseline. The complete `pnpm validate` aggregate then exited successfully on that exact commit in the Linux runner, leaving its worktree clean. Final evidence-only documentation changes are regenerated and checked separately.

The preservation audit against pre-upgrade Teluni `6e29fb4` finds no changes under API source/tests, Prisma schemas/migrations/grants/metadata, the SDK, the player, infrastructure, CI workflows, product feature directories or brand assets. Deliberate shared-shell changes preserve product navigation and styling and are covered by browser/E2E tests. Existing accepted Teluni ADRs retain their content and identifiers. CI still checks out full Git history, validates the locked dependency graph, runs the complete repository and player gates and requires the deployment rehearsal; this upgrade changes none of those controls. The rehearsal runs an isolated CI environment and does not deploy Teluni.

## Post-upgrade audit

The owner requested a comprehensive audit on 2026-10-23. Its corrections stay in [PR #28](https://github.com/GabriellMDias/teluni/pull/28), on the same upgrade branch. Git comparisons use pre-upgrade Teluni `6e29fb4` and the exact published Orion v3.0.0 commit, rather than upstream's two later commits.

| Boundary | Evidence and assessment |
| --- | --- |
| Provenance and derivation | The canonical annotated tag object is `cf199a310ff5cf66f34934827599896dc20a5e03`, peeled to `aafb920a3616f51c0da4b145dbee61a4bf5c3cc7`. Initialization → baseline → upgrade HEAD and release → canonical upstream main ancestry hold. The derivation contract is byte-identical to v3.0.0; foundation-only content is absent and the package scope remains `@teluni`. Fetch-only settings and absence of foundation-tracking branches are verified. |
| API, identity and permissions | All 150 API source/test files are unchanged. The nine composed modules retain their order and public dependencies: identity, mail, organizations, invitations, devices, media, catalogs, programming and publications. The API suite and end-to-end fixtures exercise login, sessions, CSRF, OTP, tenant/branch capabilities, invitation delivery, optimistic conflicts, media processing and published-device boundaries. Compatibility is supported by those executable checks, not inferred merely from a conflict-free merge. |
| Database and contracts | All 44 Prisma schema/history/metadata/grant files and all seven SDK files are unchanged. Fresh migrated PostgreSQL reference checks, runtime-role integration tests and release-history checks remain required. No released migration or durable-release record is rewritten. |
| Frontend and player | All 45 files in the seven product web feature directories, all 40 player files and all five brand/font assets are unchanged. Shared ErrorNotice retains localized messages, operation semantics and reload text; the new UI styling maps to existing Teluni light/dark tokens. Browser tests retain existing assertions, while E2E adds dark-notice color assertions. Player tests cover portable JVM behavior and wire/conformance contracts; no Android app or physical-device qualification is claimed. |
| Documentation distribution | The default product build passes emitted-module, content and fingerprint checks excluding catalog, pages, search and downloads. Accidental internal imports fail closed. Development E2E and explicit internal-artifact browser checks cover navigation, search, source/reference downloads and previews. Protected internal build selection requires the explicit external-access acknowledgement; it supplies no authorization itself. The pilot web build uses the default product selection. |
| React architecture | The shared public inventory is Button (`shared`/Actions), TextField (`composed`/Inputs) and ErrorNotice (`composed`/Feedback), with explicit owner/category/scope, source validation, owned metadata and bounded synthetic previews. Private feature helpers need no forced catalog registration. Native controls and feature-local behavior remain permitted; the audit introduces no parallel UI library, form rewrite or speculative abstraction. |
| Architecture, ownership and automation | All 33 pre-existing numbered Teluni ADRs, all 13 infrastructure/CI files, product compositions and configuration values are preserved. Orion's independent accepted ADR-0018 is isolated in its validated namespace. Project-owned README, web composition, plan and human actions carry deliberate changes only. Generated portal/component references come from canonical sources; API/database/SDK references remain reproducible. Full-history CI and the aggregate gate retain their enforcement. |

Two issues were corrected during this audit:

1. Pin Nodemailer to the compatible patched `10.1.4`, with its exact lockfile integrity, instead of deferring the three recipient-parser advisories. Frozen installation succeeds and a fresh `pnpm audit` reports zero vulnerabilities at every severity. Production SMTP behavior, TLS verification, redaction and outbox semantics are unchanged. Existing real-mail integration and login/invitation E2E coverage qualify the dependency change; no dependency-internal implementation test or relaxed assertion is introduced.
2. Untrack the two inherited Vitest failure screenshots under `apps/web/.vitest/`. Adding an ignore rule alone did not exclude already tracked diagnostics. Local copies are preserved and now ignored; product source and tests are untouched.

The post-audit dependency commit is `3d66895`. Its full local `pnpm validate` rerun is recorded in the PR's qualification report; final documentation/generated-output checks cover the subsequent evidence changes. Remote results are independently available in [PR #28's checks](https://github.com/GabriellMDias/teluni/pull/28/checks). Only a successful required gate qualifies the PR head; earlier green runs do not substitute for it. Review remains necessary for visual intent and operational assumptions beyond test coverage.

Review and merge remain pending. The pull request must use a merge commit so Orion's identities remain ancestors. This work authorizes no Teluni release, deployment, production migration or device qualification. The Android application and real-device work retain their existing PJ-12 and PH-08/PH-26/PH-27 status.
