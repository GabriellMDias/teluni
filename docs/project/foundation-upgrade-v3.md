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

| Check | Local result before baseline recording |
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

`pnpm audit` reports three existing moderate Nodemailer advisories in Teluni's unchanged `nodemailer@10.1.2` dependency (GHSA-8c8m-p3m8-cjg8, GHSA-m943-m63m-w62w and GHSA-85x2-q946-cp5h). They require a separate dependency follow-up; no high or critical findings were reported. This upgrade does not claim to complete that remediation or the existing pilot/security prerequisites.

The reviewed merge is ready for the documented `orion:record-baseline` step. After committing provenance, the complete `pnpm validate` aggregate must be rerun before handoff; its final result remains pending.

Review and merge remain pending. The pull request must use a merge commit so Orion's identities remain ancestors. This work authorizes no Teluni release, deployment, production migration or device qualification. The Android application and real-device work retain their existing PJ-12 and PH-08/PH-26/PH-27 status.
