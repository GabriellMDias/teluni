# Web Application

[Setup](../../docs/setup.md) · [Generated API](../../docs/generated/api/openapi.json) · [Living documentation](../../docs/architecture/living-documentation.md) · [Validation](../../docs/validation.md)

This React/Vite application provides the application shell, a home page, composed product [modules](#modules), and the Living Documentation Portal. It calls the API only through the generated workspace SDK (`packages/sdk`). TanStack Router owns navigation and shareable state in the URL, TanStack Query owns API state, and React owns temporary form/interaction state. The API remains the authority for authorization and business rules.

## Find the owning implementation

| Concern | Source |
| --- | --- |
| Shell, shared routes, and home page | [`src/shell.tsx`](src/shell.tsx), [`src/home.tsx`](src/home.tsx), [`src/main.tsx`](src/main.tsx) |
| Module composition | [`src/modules.tsx`](src/modules.tsx), [`src/module-navigation.tsx`](src/module-navigation.tsx) |
| API client and failure wording | [`src/api-client.ts`](src/api-client.ts) |
| Client configuration and build identity | [`src/config.ts`](src/config.ts), [`vite.config.ts`](vite.config.ts), [`scripts/project-identity.ts`](scripts/project-identity.ts) |
| Exported shared components and canonical examples | [`src/components.tsx`](src/components.tsx), [`src/components.docs.json`](src/components.docs.json) |
| Documentation presentation | [`src/documentation.tsx`](src/documentation.tsx) under [portal ownership](../../docs/architecture/living-documentation.md) |

## Modules

A web module is the browser side of a product capability. It defines its routes as children of the shared root route, keeps its pages, client calls, styles, and wording in its own `src/<module>/` folder, and exports a navigation link component. [`src/modules.tsx`](src/modules.tsx) is the only composition point: it adds the module's routes to the route tree and its link to the header and home page. Shared shell and portal code never import a module. Module browser journeys belong in `test/e2e/<module>/` and may start their own disposable stack with the shared [end-to-end stack helpers](test/e2e/stack.ts). [Orion's reference implementation](../../docs/project-derivation.md#orions-reference-implementation) is a complete example.

Use the shared [`ErrorNotice`](src/components.tsx) and [`api-client.ts`](src/api-client.ts) for public API failures: pass a module's own stable codes when unwrapping responses and its own wording for them. A failed or lost write is an unknown outcome, never proof that nothing changed.

## Identity

The display name comes from `.orion/project.json` at build time: page titles, the shell brand, and the portal show the repository's own name. The [brand mark](src/assets/brand-mark.svg) and its derived [touch icon](src/assets/brand-touch-icon.png) belong to the repository. The Orion foundation uses the Orion mark; project initialization replaces both files with a neutral placeholder for the project to redesign.

The shell, documentation navigation, and browser favicon consume the SVG directly. Only the Apple touch icon uses a derived 180×180 PNG on the approved `#F8FAFC` light background. After editing the SVG, run `pnpm -C apps/web identity:write` to regenerate that raster through the [export script](scripts/generate-touch-icon.mjs), using the Playwright Chromium installation described in [setup](../../docs/setup.md#prepare-a-clean-checkout). Commit both files, then rebuild. Do not edit the PNG independently. Adjacent live text names the decorative mark for accessibility.

Teluni uses the owner-approved [Connected Tiles identity](../../docs/project/branding/README.md): the selected symbol, a locally served Plus Jakarta Sans variable font with its OFL notice, titlecase live brand text, and blue/teal/navy palette. The runtime SVG is canonical, and `identity:write` derives its touch PNG. The branding guide owns the single identity kit and remaining domain/trademark evidence.

## Run the application

Use the canonical [setup guide](../../docs/setup.md) for installation, environment loading, and prerequisites. For an API at `127.0.0.1:3000`, run `pnpm -C apps/web dev`.

Vite forwards the default `/api` browser path to the local API and removes that prefix. `ORION_WEB_API_TARGET` changes only the development-server target. `VITE_ORION_API_BASE_URL` is the sole browser API setting, defaults to `/api`, and must be a same-origin path. A deployed static build needs an equivalent same-origin route/reverse proxy; this guide does not select deployment infrastructure. Server-only URLs and credentials must not enter browser configuration.

Human sign-in uses the server-managed session of the API's `identity` module. The [`identity` web module](src/identity/routes.tsx) provides `/sign-in`, `/account/sessions` and the header's sign-in/sign-out entry. Login is a full navigation to `/api/auth/login`; the browser then holds only the API's `HttpOnly` session cookie, and the session's CSRF token stays in module memory for unsafe requests through the SDK. Sign-out clears all cached query data. `loginHref(returnTo, "strong" | "recent")` starts two-step verification when an operation answers `STRONG_AUTHENTICATION_REQUIRED` or `RECENT_AUTHENTICATION_REQUIRED`; the sessions page offers it directly. The header entry neither queries nor shows the session on `/docs` pages, so the portal still makes no API calls while browsing. Copy is localized through a typed pt-BR/en-US catalog in `src/identity/messages.ts`; no i18n library is selected yet. The API still verifies every business request, and production credentials must never be used in tests.

## Living Documentation Portal

The public `/docs` hub provides separate API, data dictionary, component, and repository-documentation collections, nested local pages, breadcrumbs, page outlines, and full-text search. Reading and synthetic previews need no token, API process, or database. The API explorer sends only explicit requests to the configured same-origin API, keeps tokens in memory, and asks for acknowledgement before writes. See [portal setup](../../docs/setup.md#living-documentation-portal) to run it.

Shared component examples/descriptions belong in [`components.docs.json`](src/components.docs.json) beside the real exports in `components.tsx`. `pnpm docs:references:write` produces [component Markdown](../../docs/generated/components/web.md) and a lightweight catalog, separately loaded pages, and search shards. All `docs/` Markdown and repository README/instruction files are rendered locally; normal documentation links stay in the portal. Regenerate after authored documentation edits too. API/database/error references come from their respective canonical generators. The portal is a presentation of those facts, not another authoring source.

## Validate changes

Run commands from the repository root. `pnpm -C apps/web typecheck`, `build`, `bundle:check`, `test:unit`, `test:browser`, and `test:e2e` are individual package scripts; use `pnpm validate` for the complete gate. After intentional contract changes, follow the [artifact workflow](../../docs/architecture/backend-execution-and-generated-artifacts.md) to regenerate API, SDK, and portal data in order. `pnpm references:check` and `pnpm docs:references:check` detect drift without repairing tracked output.

Browser component tests use Vitest Browser Mode with Playwright: installed Edge on Windows, bundled Chromium on Linux CI. Playwright end-to-end tests use matching Chromium against the emitted API and the Vite web app; module journeys add fresh Testcontainers PostgreSQL, committed migrations, a restricted runtime role, and synthetic identities. Install missing Chromium with `pnpm -C apps/web exec playwright install chromium`; [setup](../../docs/setup.md#prepare-a-clean-checkout) covers system prerequisites.
