# Development Setup

[Repository README](../README.md) · [Validation](validation.md) · [API runtime](../apps/api/README.md) · [Web workflow](../apps/web/README.md)

This is the canonical local setup and execution path. Tests use disposable PostgreSQL and synthetic identities; no production database, identity provider, telemetry vendor, or deployment account is needed. Commands address workspace packages by path (`pnpm -C apps/api …`), so they work unchanged whatever a project names its packages.

| Goal | Prerequisites after installing pinned Node.js/pnpm | Start here |
| --- | --- | --- |
| Browse the documentation portal | Frozen dependency install; no container, API, or test browser needed | [Portal](#living-documentation-portal) |
| Run the API and web application locally | Frozen dependency install, generated Prisma client, and local configuration | [Configuration](#load-local-configuration) |
| Use a local PostgreSQL or access-token issuer | A database or issuer you control for development | [Local database and authentication](#local-database-and-authentication) |
| Run the complete validation gate | All clean-checkout prerequisites, including containers and test browsers | [Prepare a clean checkout](#prepare-a-clean-checkout), then [validate](#validate-regenerate-and-build) |
| Start a new project from Orion or upgrade a project's Orion baseline | A fresh full clone and frozen dependency install | [Project derivation](project-derivation.md) |

## Prepare a clean checkout

Use Node.js 24.13.0 and pnpm 11.25.0, as pinned by `.node-version` and `package.json`. For full validation, start Docker or another Testcontainers-compatible container runtime and verify that its daemon is reachable with `docker info`. From a fresh checkout, run:

```sh
pnpm install --frozen-lockfile
pnpm db:generate
pnpm -C apps/web exec playwright install chromium
```

On Linux, use `pnpm -C apps/web exec playwright install --with-deps chromium` if the browser's system libraries are absent. Windows browser component tests use the installed Edge channel; Playwright end-to-end tests use Chromium. Do not put credentials in tracked files.

## Load local configuration

For a new local configuration, copy the safe, schema-checked [example](../.env.example) into an ignored root `.env.local` file; preserve an existing file's settings. The example activates only `ORION_ENV=development`; uncomment and fill an optional setting only when needed. The API `dev` script uses Node's `--env-file-if-exists` to load this file before `src/main.ts` parses and validates configuration. Existing shell environment variables take precedence over file values. The following works in PowerShell and POSIX shells:

```sh
cp .env.example .env.local
pnpm -C apps/api dev
```

PowerShell also accepts `Copy-Item .env.example .env.local`. The default listener is `127.0.0.1:3000`; `GET http://127.0.0.1:3000/health/ready` returns `{"status":"ok"}`. Without database or token settings, the API serves its health routes; [modules](../apps/api/README.md#modules) that require the database or bearer authentication stay unmounted until those settings are configured. `.env.local` and other real environment files are ignored by Git; do not place secrets in `.env.example`.

Start the web development server in another terminal:

```sh
pnpm -C apps/web dev
```

Open the URL printed by Vite, normally `http://127.0.0.1:5173`. Vite forwards `/api` to the local API by default and loads its own `apps/web/.env.local` if web-specific `VITE_` values are needed. Do not copy the root API `.env.local` into the web app: server-only values must not enter a browser build. The home page lists the workflows that [web modules](../apps/web/README.md#modules) compose.

## Local database and authentication

[API configuration](generated/configuration/api.md) names the runtime settings. `ORION_DATABASE_URL` enables PostgreSQL for modules that require it and adds the database to readiness. The three token settings enable bearer authentication together; a trusted issuer must provide the claims described by the [authentication policy](security/authentication.md).

For a separate **local** PostgreSQL, create distinct migration and restricted runtime credentials. Supply `ORION_MIGRATION_DATABASE_URL` in the shell only for `pnpm -C apps/api db:migrate:deploy`; the Prisma CLI reads it from that process. Keep `ORION_DATABASE_URL` in the root ignored `.env.local` for the API runtime, alongside the trusted token issuer, audience and JWKS URL. Human sessions use the selected Keycloak realm and the additional identity settings in the [configuration reference](generated/configuration/api.md); [the disposable identity stack](#try-sign-in-locally) is the available local qualification path. No persistent environment is provisioned by this guide. Do not copy Testcontainers' synthetic credentials into a persistent environment, and clear the migration credential from the shell after deployment.

## Living Documentation Portal

The portal needs no API, database, identity provider, or `.env.local`. After the clean-checkout install above, run `pnpm -C apps/web dev` and open `http://127.0.0.1:5173/docs` (or the Vite-printed port plus `/docs`). Use its section navigation and breadcrumbs for API operations, tables, component examples, architecture, guides, policies, and ADRs. Repository documentation opens locally with headings and search, rather than requiring GitHub. Relevant sections also expose AI-readable OpenAPI, database, error, and component references.

To try an API route, also run the API as described above, open an API operation, enter declared inputs and a token when the operation requires one, then select **Send request**. Writes require explicit acknowledgement. Tokens and responses remain in memory; no request executes automatically. Cancellation/timeouts do not prove a write was undone. Without the API, reading remains available and request failures are shown safely.

After editing repository Markdown or reference sources, run `pnpm docs:references:write` and `pnpm docs:references:check`. Build with `pnpm -C apps/web build`; preview with `pnpm -C apps/web exec vite preview --host 127.0.0.1`, then open `/docs` on the printed port. Production/static serving must support the existing SPA fallback for nested routes; no deployment provider is selected here.

## Try sign-in locally

The identity workflow needs a Keycloak that the API calls back, so it runs as a disposable stack rather than with `.env.local`. With Docker running, from the repository root:

```sh
pnpm db:generate
pnpm -C apps/api build
node apps/web/test/e2e/identity/manual.ts
```

It starts a migrated PostgreSQL with the restricted runtime role, the pinned Keycloak with the provisioned `teluni` realm and one synthetic verified user, Mailpit as the mail inbox, the emitted API with generated session keys and client secrets, and Vite. It prints the panel URL, the Mailpit inbox URL and the synthetic user's email and password; you can also create an account on the Keycloak sign-in page and read its verification email in Mailpit. Every credential is generated for that run only, and Ctrl+C discards all containers and data. The same stack drives the [identity browser journeys](../apps/web/test/e2e/identity/login.spec.ts).

## Exercise automated workflows

Automated workflows use disposable databases and synthetic identities. No seed data or external account is needed:

```sh
pnpm build
pnpm smoke
pnpm test:e2e
```

`pnpm smoke` exercises the emitted API process, then any module process smokes. `pnpm test:e2e` runs the emitted API and the Vite web app for the shared documentation and shell journeys; module journeys start their own migrated PostgreSQL and synthetic issuer through the shared [end-to-end stack helpers](../apps/web/test/e2e/stack.ts). These fixtures are disposable and are not release or production data.

## Validate, regenerate, and build

Run the full, non-mutating tracked-source gate after changes:

```sh
pnpm validate
```

It checks format, lint, types, dependency boundaries, documentation, `.env.example` against API configuration metadata, migration release history, project provenance, current generated references, real PostgreSQL and browser tests, builds, and process smokes. `pnpm references:check` diagnoses generated API/database/SDK drift independently; it migrates a fresh PostgreSQL for the physical database reference and does not repair tracked files. To intentionally change those references, edit their canonical TypeBox/schema/metadata sources and run `pnpm -C apps/api references:write`, then `pnpm -C packages/sdk generate` after an OpenAPI change. Review the generated diff and rerun `pnpm references:check`.

After intentional repository Markdown, API, database, or component-metadata changes, run `pnpm docs:references:write` and review the generated component Markdown, catalog, detail pages, and search shards. Vite serves/emits the existing API, database, error, and component artifacts without committing duplicate copies. `pnpm docs:references:check` is non-mutating and fails on drift, missing component metadata, or known secret patterns; it runs within `pnpm validate` and CI. Do not edit either generated layer directly.

`pnpm build` emits the API ESM and web static assets into ignored `dist/` directories and checks the browser bundle for known server-only markers. The [release evolution workflow](database/release-evolution.md) governs migrations; no durable release is recorded merely by running these commands.
