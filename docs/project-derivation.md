# Start and Upgrade a Project from Orion

[Repository README](../README.md) · [Development setup](setup.md) · [Validation](validation.md) · [Foundation versioning](versioning.md) · [ADR-0014](adr/0014-derive-projects-from-orion-through-git-ancestry-with-recorded-provenance.md) · [ADR-0017](adr/0017-start-derived-projects-from-a-clean-foundation-baseline.md)

This is the practical reference for turning a revision of Orion into a new, independent project and for keeping that project's foundation current: what to decide and provide, how to run the initialization, what the new repository contains, what to do next, and how provenance and foundation upgrades work. [ADR-0014](adr/0014-derive-projects-from-orion-through-git-ancestry-with-recorded-provenance.md) records the ancestry and provenance decision; [ADR-0017](adr/0017-start-derived-projects-from-a-clean-foundation-baseline.md) records the clean-baseline contract. The commands exist in every Orion checkout; the canonical Orion repository itself is never initialized as a project.

## Model

The canonical `GabriellMDias/Orion` repository is the upstream development foundation. A derived project is an independent Git repository with its own `origin`, branches, pull requests, CI history, human actions, product decisions, and releases. It starts from a clean clone of Orion and keeps Orion's commit history, so Git can compute what changed upstream and merge it later, but its first commit removes Orion's own reference implementation and development history and gives the repository the project's identity.

| Concern | Mechanism |
| --- | --- |
| Identity and provenance | [`.orion/project.json`](../.orion/project.json), validated by `pnpm orion:check` |
| Clean-baseline contract | [`.orion/derivation.json`](../.orion/derivation.json): foundation-only paths, project-owned files and their templates, and the foundation workspace package scope |
| Immutable starting point | `foundation.initializedFromCommit`: the published Orion commit the project was initialized from; never changes |
| Current foundation | `foundation.baselineCommit`: the newest Orion commit integrated and validated through a reviewed merge |
| Canonical upstream | Local remote `orion-upstream`: fetch-only (its push URL is disabled), fetches no tags, and is tracked by no local branch |
| Product repository | Recorded as `repository.url`; each clone's `origin` is that repository or a fork or mirror of it, never the foundation ([remote rules](#remote-rules)) |

In the Orion repository the manifest has `"kind": "foundation"` and only describes Orion. A derived project's manifest (schema version 2) has `"kind": "project"` and additionally records its npm `packageScope` and its foundation ancestry. The Living Documentation Portal links source files to the manifest's repository.

A derived project inherits [Apache-2.0-licensed Orion source](../LICENSE). The project remains responsible for licensing its independently created product code and for applicable obligations of inherited and third-party material; Orion's license does not choose the project's overall license.

## Before you start

### What you decide and provide

Only the first two inputs are required. Product decisions such as scope, license, identity provider, deployment, and branding are not needed to initialize; the new project's plan and human actions track them afterward.

| Input | Option | How the project uses it | Rules |
| --- | --- | --- | --- |
| Project name | `--name`, required | Manifest `name`, README and documentation titles, browser title, web shell, portal, OpenAPI title (`<name> API`), plan, human actions, and the initialization commit message | 1–80 letters, digits, spaces, dots, underscores, or hyphens, starting with a letter or digit; accented letters are allowed |
| Product repository | `--repository`, required | Recorded, normalized, as `repository.url`; configured as `origin` | HTTPS, SSH, or scp-like URL of the repository the project will publish to; it need not exist yet. It must not embed credentials, use a non-default SSH port (supply its HTTPS URL instead), or identify Orion ([repository identities](#remote-rules)) |
| Package scope | `--package-scope`, optional | Workspace packages `@<scope>/api`, `@<scope>/web`, and `@<scope>/sdk`, the root package `<scope>`, and the telemetry service name `<scope>-api` | Defaults to the name in lowercase, without accents, with other characters replaced by hyphens (`Pedido Fácil` → `@pedido-facil`). Otherwise `@` and 1–50 lowercase letters, digits, or hyphens, starting with a letter or digit, and not the foundation scope `@orion` |
| Orion revision | optional | Becomes `foundation.initializedFromCommit` and the first `foundation.baselineCommit` | Defaults to the latest commit on Orion's `main`. Any commit on `main` that contains `.orion/derivation.json` may be chosen; [stable tags](versioning.md) name released points. A revision from before the clean-baseline contract runs its own older initialization and produces that revision's layout instead |

### Prerequisites

- Git with `user.name` and `user.email` configured, Node.js 24.13.0, and pnpm 11.25.0.
- A running Testcontainers-compatible container runtime: initialization regenerates the database reference from a migrated PostgreSQL.
- Playwright Chromium for the browser tests in `pnpm validate` ([setup](setup.md#prepare-a-clean-checkout)).
- A fresh, full clone of Orion that contains no other work. Shallow clones cannot preserve Orion's ancestry.
- Permission to create the product repository before publishing. Initialization never contacts the product repository: it creates no repositories and pushes nothing.

## Start a new project

1. Clone Orion and install its dependencies. To start from an older published Orion revision, run `git reset --hard <commit>` on `main` before initializing.

   ```sh
   git clone https://github.com/GabriellMDias/Orion.git acme-ledger
   cd acme-ledger
   pnpm install --frozen-lockfile
   ```

2. Run a dry run. It checks every precondition and lists the actions without changing anything.

   ```sh
   pnpm orion:init-project --name "Acme Ledger" --repository git@github.com:acme/acme-ledger.git
   ```

3. Initialize. Add `--package-scope @acme` to choose a scope other than the default.

   ```sh
   pnpm orion:init-project --name "Acme Ledger" --repository git@github.com:acme/acme-ledger.git --apply
   ```

4. Verify the result. `pnpm orion:status` shows the identity, package scope, and recorded Orion commits; the last commit is `Initialize Acme Ledger from Orion <commit>` on top of Orion's history.

   ```sh
   pnpm orion:status
   git log --oneline -2
   pnpm validate
   ```

5. Create an empty repository at the URL you supplied, without a generated README, license, or ignore file (project human action PH-01), and publish:

   ```sh
   git push -u origin main
   ```

Initialization refuses, without changing anything, when:

- the checkout is not the repository root, is shallow, or has uncommitted or untracked changes (ignored files such as `node_modules/` and `.env.local` are allowed);
- the manifest already describes a project, `docs/project/` exists, or an `orion-upstream` remote exists;
- `main` is not checked out, any configured `origin` URL does not identify the canonical Orion repository, or `HEAD` has commits that are not on `origin/main`;
- the project name is invalid, the package scope is not a valid npm scope or equals the foundation scope, the repository URL embeds credentials, uses a non-default SSH port (see [repository identities](#remote-rules)), or identifies the Orion repository;
- the derivation contract is invalid or a template is missing;
- the migration release registry records durable releases, which would describe another deployment;
- Git has no committer identity.

With `--apply`, it:

1. writes the project manifest;
2. removes every foundation-only path;
3. renders the project-owned files with the project name, repository, package scope, date, and Orion baseline;
4. renames the workspace package scope in package manifests, `pnpm-lock.yaml`, and source, and names the root package after the scope (authored Markdown and ADRs are not rewritten);
5. regenerates workspace links, the Prisma client, API and database references, SDK types, and portal data;
6. commits `Initialize <name> from Orion <commit>` on top of Orion's history, renames `origin` to the protected `orion-upstream`, and adds the project repository as `origin`.

It never creates remote repositories or pushes. If a step before the commit fails, it restores the clean checkout; run `pnpm install --frozen-lockfile` before retrying.

## What carries over, what is removed, and what is adapted

| Outcome | Content |
| --- | --- |
| Preserved from the foundation | Architecture, principles, policies, accepted ADRs, setup and validation guides, runbook guidance, and this guide; the validation gate, agent instructions, CI workflow, and Renovate configuration; the API runtime (configuration, telemetry, health, error registry, module contract, PostgreSQL client, optional JWT verification); the web shell and Living Documentation Portal; the SDK package; the derivation tooling and contract; Orion's full Git history |
| Removed as foundation-only | Orion's Approval Request reference implementation: its API feature, Prisma models, migration, metadata, runtime grants, smoke, tests, web module, browser tests and journeys, and domain documentation. Orion's own implementation plan, human actions, and acceptance and release history |
| Adapted or created for the project | The manifest (`kind: project`, name, package scope, provenance); `README.md`; the API and web composition files, which compose no modules; a neutral brand mark and touch icon; the project's plan and human actions in `docs/project/`; workspace package names, the lockfile, and imports; generated OpenAPI, SDK types, configuration, error, and database references, and portal data; the remotes `origin` and `orion-upstream` |
| Kept as the foundation's technical namespace | `ORION_*` configuration names, `orion_*` token claims and database role names, the `Orion required gate` check name, the `.orion/` directory, the `orion:*` commands, and the `orion-upstream` remote. Renaming them would touch shared files throughout the repository and conflict on every upgrade; the check name is also referenced by branch protection. Accepted ADRs keep their original wording |

The [content ownership](#content-ownership) contract defines these categories precisely and how each behaves during upgrades.

## A newly derived project

The full internal engineering catalog, generators, references, search, previews, and `/docs` development workflow remain in the repository for developers and AI agents. Default production builds exclude the portal and its generated assets through [the build boundary](architecture/living-documentation.md#build-and-deployment-boundary). This requires no generated environment setting or manifest schema change. The application owns its UI and any product/public documentation sources; the internal catalog is never automatically published. Existing projects adopting this change follow [the migration guidance](architecture/living-documentation.md#existing-project-migration).

Immediately after initialization the repository contains:

| Area | State |
| --- | --- |
| Identity | `README.md`, `<title>`, the web shell, the portal, the OpenAPI title (`<name> API`), and the telemetry service name (from `@<scope>/api`) use the project name; workspace packages are `@<scope>/api`, `@<scope>/web`, and `@<scope>/sdk`; the brand mark is a neutral placeholder |
| API | The shared runtime with health endpoints, configuration, telemetry, error registry, module contract, PostgreSQL client, and optional JWT verification; `apps/api/src/modules.ts` composes no modules |
| Database | The Prisma schema folder with only shared configuration, no migrations, no metadata or grants, an empty release registry, and a generated database reference stating that no application tables exist |
| Web | The shell, home page, and Living Documentation Portal; `apps/web/src/modules.tsx` mounts no module routes |
| Documentation | Shared architecture, policies, ADRs, setup, validation, runbook guidance, this guide, and the project's README, plan (PJ-01 to PJ-05), and human actions (PH-01 to PH-06); no Orion plan, human actions, acceptance report, or reference-feature documentation |
| Tooling and CI | Unchanged validation gate, agent instructions, CI workflow, Renovate configuration, and derivation commands |
| Provenance | Orion's full history plus the initialization commit; `foundation.initializedFromCommit` and `foundation.baselineCommit` both name the Orion commit; `orion-upstream` fetch-only; `origin` the project repository |
| Worktree | Clean; nothing is pushed until you publish |

`pnpm validate` passes in this state, including the shell and portal browser journeys.

## Next steps after creation

The project's [README](../README.md) routes to its plan and human actions, which track these steps with stable IDs.

1. **Publish and validate (PH-01, PJ-01).** Push `main` to the new repository and confirm that `pnpm validate` passes locally and that the repository's CI runs.
2. **Protect the repository (PH-02 to PH-04).** Require pull requests and the `Orion required gate` check on `main`, keep merge commits available for foundation upgrades, enable Renovate, and enable the applicable GitHub security controls. Settings verified for Orion do not apply to the new repository.
3. **Onboard contributors.** Each clone needs `pnpm install --frozen-lockfile` and the local configuration from [setup](setup.md). Run `pnpm orion:upstream` and `git fetch orion-upstream` in any clone that will inspect or perform foundation upgrades; clones receive no `orion-upstream` remote automatically.
4. **Define the product (PH-05, PJ-02).** Record the product scope, actors, first capabilities, data classification, and acceptance criteria, then replace the README introduction and current state.
5. **Build the first module (PJ-03).** Add its schema, reviewed migration, contract, SDK use, web workflow, tests, and documentation as described for [API modules](../apps/api/README.md#modules) and [web modules](../apps/web/README.md#modules), and compose it in `apps/api/src/modules.ts` and `apps/web/src/modules.tsx`. [Orion's reference implementation](#orions-reference-implementation) shows a complete module.
6. **Replace the placeholder identity (PJ-04).** Replace the brand mark and regenerate the touch icon as described under [web identity](../apps/web/README.md#identity).
7. **Decide the product license (PH-06)** before distribution requires it.
8. **Add conditional work when it becomes real (PJ-05).** An identity provider, durable releases, or a deployment environment become new tasks and human actions in the project's own files.

Keep the project's plan and human actions current as work proceeds; `AGENTS.md` routes contributors and agents to them through the README's Current state.

## Content ownership

[`.orion/derivation.json`](../.orion/derivation.json) divides Orion's content into three categories. `pnpm orion:check` enforces the boundaries in both Orion and projects.

| Category | Contents | In Orion | In a new project | Upgrade behavior |
| --- | --- | --- | --- | --- |
| Shared foundation | Architecture, policies, ADRs, tooling, CI, the API runtime and module contract, the web shell and portal, generated-reference machinery, and `.orion/derivation.json` | Present; must not import, link to, name, or describe foundation-only content | Identical to Orion except for package-scope renames | Normal three-way merges; product changes to the same lines need review |
| Foundation-only | Orion's reference implementation and Orion's own implementation plan, human actions, and acceptance history | Present | Absent | Reintroduced or conflicting paths are removed with `pnpm orion:prune` |
| Project-owned | `README.md`, `apps/api/src/modules.ts`, `apps/web/src/modules.tsx`, the brand mark and touch icon, `docs/project/implementation-plan.md`, `docs/project/human-actions.md` | Orion's own versions, composing its reference implementation | Rendered from [templates](../.orion/derivation.json) at initialization; then owned by the project | Keep the project's version when Orion changes them; port relevant upstream facts deliberately |
| Generated | OpenAPI, SDK types, configuration/error/database references, portal data | Derived from Orion's sources | Regenerated from the project's sources at initialization | Resolve source conflicts, then regenerate; never hand-merge |

`AGENTS.md` routes implementation work to the plan and human actions linked from the README's Current state; in a project that is `docs/project/`. Orion's completed human actions verified settings for the Orion repository only; initialization creates pending project actions for the new repository's equivalents.

## Orion's reference implementation

The Orion repository composes a complete Approval Request module that demonstrates the architecture from database to browser and is exercised by Orion's validation gate. It is foundation-only: initialization removes it, and no project-owned or shared file refers to it. To study it while building a module, read it in Orion at the commit recorded as the project's baseline, for example in a separate Orion clone or with `git show <baseline>:<path>` after `git fetch orion-upstream`. The paths it occupies are listed in [`.orion/derivation.json`](../.orion/derivation.json). Copy patterns, not the feature: a product module belongs under its own name and is composed in the project's `modules.ts` and `modules.tsx`.

## Provenance and foundation upgrades

Provenance is what makes upgrades possible. Initialization records the Orion commit in both `foundation.initializedFromCommit`, which never changes, and `foundation.baselineCommit`. Because the project keeps Orion's history, Git can compute what changed upstream since the baseline and merge it with a normal three-way merge. Each upgrade merges a newer Orion commit with its history and then records it as the new baseline; `pnpm orion:check` verifies that the baseline is an ancestor of `HEAD`, and `pnpm orion:status` compares it with a fetched `orion-upstream`. The derivation contract travels with every upgrade, and `pnpm orion:prune` reapplies it, so the project stays free of foundation-only content and keeps its own package scope. [Stable semantic tags](versioning.md) make released foundation points easier to identify: a project may be described as derived from a tagged Orion release when its initialization commit matches that tag, while the manifest continues to record the exact commit SHA.

### Inspect provenance

```sh
pnpm orion:status
```

It prints the project identity and package scope, the initialization and recorded baseline commits, whether `orion-upstream` is configured and fetch-only, and, after `git fetch orion-upstream`, how many upstream commits follow the baseline and whether integrated commits are not yet recorded. It does not fetch or change anything.

`pnpm orion:check` runs in `pnpm validate`.

- In Orion, it validates the manifest and derivation contract, requires every foundation-only path and template to exist, and rejects shared tracked files that link to, import, name, or mention foundation-only content. Derivation tooling, ADRs, this guide, and generated output are exempt.
- In a project, it validates the manifest and contract, requires the project plan and human actions and the root package name of the recorded scope, rejects any foundation-only path and any remaining reference to the foundation package scope in code or configuration, requires both recorded commits to exist with the initialization commit an ancestor of the baseline and the baseline an ancestor of `HEAD`, and applies the [remote rules](#remote-rules). It needs full history; CI already uses `fetch-depth: 0`.

### Remote rules

Git remotes are local configuration, so other clones of the project do not receive `orion-upstream`. Configure it in any clone with:

```sh
pnpm orion:upstream
git fetch orion-upstream
```

| Remote | Rule | Enforced by |
| --- | --- | --- |
| `origin` | Must not identify the Orion foundation through its fetch or push URL, so product work never has the foundation as its normal push target. It need not equal the project's `repository.url`: contributors may work through a fork or mirror. | `pnpm orion:upstream` refuses; `pnpm orion:check` fails |
| `orion-upstream`, when present | Its fetch URL must identify the foundation repository recorded in the manifest. | `pnpm orion:upstream` refuses; `pnpm orion:check` fails |
| `orion-upstream`, when present | Its only push URL must be the disabled `orion-upstream-is-fetch-only`. | `pnpm orion:check` fails and directs you to rerun `pnpm orion:upstream` |
| `orion-upstream`, when absent | Valid; a normal clone has no foundation remote until a developer configures it. | — |
| Local branches | No local branch may track `orion-upstream`; an argument-free `git pull` would otherwise merge foundation changes outside a reviewed upgrade. | `pnpm orion:check` fails and directs you to rerun `pnpm orion:upstream` |

`pnpm orion:upstream` adds `orion-upstream` from the manifest when absent, replaces every push URL of it with the disabled one, disables its tags, and removes upstream tracking of it from every local branch. It is safe to rerun.

Repository identities compare as normalized HTTPS URLs, so HTTPS, SSH, and scp-like forms of the same repository match. Host names are case-insensitive, but repository path case is significant because self-hosted servers may treat `acme/Ledger` and `acme/ledger` as different repositories: accepting a URL as a given repository, as for `orion-upstream` or the `origin` checked before initialization, requires the exact path. Refusing a URL because it could reach the foundation, as for `origin` or a new project's repository, ignores path case, because hosts such as GitHub resolve differently cased paths to the same repository. An explicit non-default HTTPS port is part of the identity: `https://git.example.com:8443/acme/ledger` differs from `https://git.example.com/acme/ledger`, while `:443` is the same endpoint as no port. A non-default SSH port only selects the SSH transport and does not identify the HTTPS endpoint, so such a URL is refused as a project repository and never matches the foundation; supply the repository's HTTPS URL instead.

## Upgrade to a newer Orion revision

An upgrade is a normal reviewable engineering change on a branch. Nothing is applied automatically, and semantic conflicts are resolved by people or agents under review. Tags help humans choose a known release point but do not change this workflow. Ordinary conflicts in project-modified shared files do not by themselves indicate a MAJOR Orion release.

1. Run `git fetch orion-upstream` and `pnpm orion:status`. Review upstream changes with `git log --oneline <baseline>..orion-upstream/main` and `git diff <baseline> orion-upstream/main`, including ADRs, policies, migrations, tooling, and `.orion/derivation.json`.
2. Choose the candidate commit; it must be on `orion-upstream/main`. Create a branch, for example `git switch -c codex/orion-upgrade/<short-commit>`, and run `git merge --no-ff --no-commit <commit>` so even a conflict-free merge remains available for inspection and regeneration before committing.
3. Resolve conflicts in `.orion/project.json`, `.orion/derivation.json`, the release registry, and `package.json` first if they prevent the command from loading. Run `pnpm orion:prune` while other merge conflicts remain. It deletes foundation-only paths the merge changed or added (resolving their modify/delete conflicts), renames foundation package-scope references in resolved shared files, and stages those changes. It leaves unresolved shared files and project-owned files untouched, reports the unresolved paths, and refuses to delete a recorded durable migration or follow linked paths outside the checkout. Resolve and stage reported conflicts, then rerun it.
4. Resolve remaining conflicts according to [content ownership](#content-ownership): keep the project's version of project-owned files and merge shared files. Git may also change project-owned files automatically without a conflict: inspect every `projectFiles` path in `.orion/derivation.json`, restore existing project-owned files from the pre-merge project commit (for example `git restore --source=<project-commit> --staged --worktree -- README.md`), and deliberately port any needed upstream facts. Do not blindly restore paths absent from that commit; new composition seams in a schema version 1 migration need product behavior ported into them. Never hand-merge generated output: run the generators from step 5, then stage their results (for example `git add -A apps/web/src/generated docs/generated packages/sdk/src/generated`), which resolves conflicts in generated files, including ones the project's output no longer contains. Rerun `pnpm orion:prune` until it reports no unresolved files. Review semantic interactions with product code even where Git reports no conflict.
5. Run `pnpm install --frozen-lockfile`, `pnpm db:generate`, `pnpm -C apps/api references:write`, `pnpm -C packages/sdk generate`, `pnpm docs:references:write`, and `pnpm validate`. Commit the merge.
6. Run `pnpm orion:record-baseline <commit>`. It refuses unless the worktree is clean and `orion-upstream` exists and satisfies the [remote rules](#remote-rules). It then fetches `main` from that verified foundation, so refs fetched earlier from another repository cannot vouch for the commit. Finally it requires the commit to be on `orion-upstream/main`, descend from the recorded baseline, and already be an ancestor of `HEAD`. Commit the manifest change, rerun `pnpm validate`, and open the pull request against the project's `main`.
7. Merge the pull request with a merge commit. Squash or rebase merges discard Orion's commit identities, and `pnpm orion:check` then fails because the recorded baseline is not an ancestor of `HEAD`. The project repository must therefore keep merge commits enabled (project human action PH-02). This applies only to Orion upgrade pull requests.

If the project's default branch requires pull requests, as PH-02 establishes, the merge and baseline update reach `main` together through that pull request. Record the upgrade and any project-specific follow-up in the project plan.

## Migrate a project from schema version 1

Projects initialized before the clean-baseline contract have a schema version 1 manifest with `referenceImplementations`, Orion's plan, human actions, and acceptance report, and usually the Approval Request implementation and `@orion/*` packages. After merging an Orion revision that contains this contract, `pnpm orion:check` refuses the old manifest. Migrate in the upgrade branch:

1. If the project adopted Approval Request as product behavior, move its code, schema, metadata, grants, and tests out of the foundation-only paths first (for example to `src/features/<product-module>/` and matching paths under the module's own name). Preserve every released migration at its original path and remove that path from the project's `foundationOnly` list in `.orion/derivation.json`; never rename or delete it. Verify uncertain release status under [migration policy](database/migrations.md) before classifying a migration as removable. Only genuinely unreleased reference migrations may be removed or renamed. `orion:prune` refuses removal of recorded durable migrations.
2. Edit `.orion/project.json`: set `schemaVersion` to `2`, remove `referenceImplementations`, and add `"packageScope": "@<scope>"`.
3. Run `pnpm orion:prune` to remove foundation-only paths and rename package-scope references.
4. Replace the project-owned files that still carry Orion's content: render `README.md`, `apps/api/src/modules.ts`, `apps/web/src/modules.tsx`, and the brand assets from the [templates](../.orion/derivation.json) (substituting each `{{PLACEHOLDER}}`), keeping existing project-specific text. Keep `docs/project/`; remove its references to Orion's plan, human actions, acceptance report, and reference implementation, and port the maintenance rules from the plan and human-action templates.
5. Regenerate as in [upgrade step 5](#upgrade-to-a-newer-orion-revision), run `pnpm validate`, and continue with baseline recording.

## Contributing improvements back to Orion

Product work never goes to `orion-upstream`; its push URL is disabled. To improve the foundation itself, make the change in a separate clone of Orion and submit it there under Orion's own review, then adopt it in projects through the upgrade workflow. Do not move product code, requirements, or history into Orion. In Orion, keep new shared content independent of foundation-only content; extend `.orion/derivation.json` when adding foundation-only or project-owned files.

## Limits

- Provenance proves which Orion commits are ancestors of the project; it does not prove that the project still follows every inherited policy. Validation and review remain the enforcement.
- `pnpm orion:check` can verify that the recorded baseline is integrated, but only `pnpm orion:status` with a fetched upstream can report newer integrated commits that were not yet recorded.
- Upgrades that change foundation-only or project-owned files conflict in projects; projects that diverge heavily from shared files should expect more conflicts there.
- The isolation check matches links, imports, path names, and listed terms; it cannot judge whether shared prose implicitly assumes the reference implementation. Review remains necessary.
- The immutable Git commit remains the exact foundation revision and provenance identity. [Foundation versioning](versioning.md) assigns human-readable tags only to deliberate stable release points; commits between tags remain usable by SHA.
