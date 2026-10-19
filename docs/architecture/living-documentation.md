# Living Documentation

[Documentation index](../README.md) · [Portal setup](../setup.md#living-documentation-portal) · [Contributing](../contributing.md)

The Living Documentation portal is the repository's local, searchable interface to repository knowledge and generated references. It lives in the existing React/Vite web application. Its routes and header link are composed in each repository's `modules.tsx`; a product may mount them only in development builds so its public build carries no repository knowledge. Markdown, contracts, schemas, and owned metadata remain canonical; browser pages and search assets are disposable generated representations, never separate authoring sources.

## Information architecture

| Route | Responsibility |
| --- | --- |
| `/docs` | Overview and starting routes for contributors |
| `/docs/api` and `/docs/api/<operationId>` | Operation catalog, request/response contracts, local OpenAPI download, and explicit API exploration |
| `/docs/database` and `/docs/database/<table>` | Table catalog, ownership, classification, lifecycle, columns, and physical constraints |
| `/docs/components` and `/docs/components/<export>` | Component properties, usage, accessibility, states, and live synthetic examples |
| `/docs/repository/<repository-path-without-md>` | Locally rendered repository Markdown; parent paths are navigable collections |
| `/docs/search?q=<query>&scope=<kind>` | Full-text results across authored and generated knowledge; links identify the matching page/section |

The shell provides section navigation, breadcrumbs, responsive navigation, search, per-page outlines, focused route changes, and recoverable missing/loading/error states. Collections show at most 24 folders and document entries combined per page, with folder counts computed in one pass. Page IDs derive from repository paths, stable operation IDs, table names, or component names; titles can evolve without changing those IDs. A file move changes its path-based route and requires updating references. Repository hierarchy is derived rather than maintained in a second navigation inventory.

All Markdown under `docs/`, and repository `README.md`/`AGENTS.md` files, are included. Relative links between those documents and their heading anchors stay in the local portal. OpenAPI links lead to the local API artifact section. Links to code and other source-only files may open the repository host at the `repository` recorded in [`.orion/project.json`](../../.orion/project.json), so a derived project links to its own repository; normal documentation reading does not require the host. Existing Markdown/JSON artifacts remain directly available to AI agents and repository readers.

## Sources and representations

The navigation brand displays the Orion foundation revision. At Vite startup/build, [build metadata](../../apps/web/scripts/foundation-version.ts) reads stable Git tags reachable from the foundation checkout; later or modified revisions are marked `unreleased`. Derived projects display their recorded baseline SHA instead of interpreting product tags as Orion releases. Missing Git history is shown as `Version unavailable`. This metadata is embedded in the build, requires no browser network request, and does not duplicate the canonical tag in tracked generated files.

| Subject | Canonical source | Derived representation |
| --- | --- | --- |
| Repository knowledge | Authored Markdown under `docs/` and local README/instruction files | Safe rendered page JSON, headings, catalog summaries, and searchable sections |
| API | Executable TypeBox contracts, route metadata, and error registry, through generated OpenAPI/errors | Operation detail pages with full schemas and referenced components; error-registry document; generated SDK remains a separate consumer |
| Database | Migrated PostgreSQL and schema-adjacent semantic metadata in `apps/api/prisma/metadata/`, through generated database Markdown | Table dictionary pages and complete physical/semantic reference, including enums |
| Components | [Actual exports](../../apps/web/src/components.tsx) and [owned examples/metadata](../../apps/web/src/components.docs.json) | Component detail pages, safe previews, and [AI-readable Markdown](../generated/components/web.md) |
| Configuration | API TypeBox schema and [reference metadata](../../apps/api/src/config.ts) | Locally readable [safe configuration reference](../generated/configuration/api.md); no environment values |

Authored guidance owns intent, constraints, rationale, and procedures. The portal may summarize, index, or render those sources but must not invent missing meaning. Accepted ADRs retain decision-time context and status. Repository policy, current implementation, and deliberately conditional capabilities remain distinguishable.

## Generation and drift protection

The [generator entry point](../../tooling/documentation/generate.mjs) delegates discovery/output handling, Markdown rendering, and reference transformation to small tooling modules. It emits `apps/web/src/generated/manifest.json`, individual JSON files under `pages/`, bounded search assets under `search/`, and the component Markdown reference. The manifest contains navigation metadata, not the repository body text. Repository outlines load with their page. The browser loads only the selected page; the application workflow lazy-loads the documentation UI separately.

Discovery uses Git's tracked and non-ignored new files, constrained to the documented source scope. Dependencies, ignored local files, runtime environment, databases, and arbitrary filesystem paths are not publication inputs. Symlinks and paths escaping the repository are rejected. Files, IDs, headings, search records, and serialized outputs have deterministic ordering; output contains no clock, host path, or environment-dependent values. Line endings normalize before comparison.

`pnpm docs:references:write` deliberately regenerates owned output and removes obsolete generated files. `pnpm docs:references:check` detects missing, stale, or orphaned generated output without repairing it. Component metadata completeness, supported schema metadata, duplicate identifiers, referenced schemas, local links, and known secret patterns are checked at their owning layers. Test fixtures exercise malicious Markdown, links, identifiers, drift, and larger document inventories. These controls do not prove authored meaning is correct or detect every secret; review remains required.

The database introspector supports current ordinary application tables, columns, non-primary constraints/indexes, and enums. Extend it before introducing uncovered PostgreSQL object kinds; [schema documentation](../database/schema-documentation.md) retains the broader physical-truth requirement. The portal does not reinterpret an absent catalog object as permission to omit it.

## Safe local reading and API exploration

Markdown is rendered at generation time with raw HTML disabled. Unsafe protocols and escaping local paths are rejected; links are rewritten from known repository paths. Images do not initiate automatic external requests. Browser insertion is limited to this generated, tested HTML; runtime API responses are rendered as text, never HTML. Keep the generator's escaping and URL rules covered by regression tests.

Reading documentation, searching, and component previews need no API, identity provider, token, database, or external service. Search queries remain local browser work; no third-party search provider receives repository content. Component previews keep synthetic input local and never connect identities or perform domain requests.

The API explorer is an intentionally generic OpenAPI consumer: it uses the generated operation contract to build explicit same-origin HTTP requests. Product workflows continue to use the typed workspace SDK; the explorer imports no API implementation and duplicates no business authorization. A raw HTTP boundary is appropriate here because inspecting rejection and unsupported future operations is part of the tool, not typed product orchestration. It introduces no replacement SDK or new application boundary.

- The configured browser API base must be a safe same-origin path. OpenAPI server URLs and user-provided hosts cannot redirect execution elsewhere. Path and header controls reject traversal, encoded separators, protected headers, and unsupported encodings.
- Nothing executes on page load or navigation. The user fills declared parameters/JSON, supplies an in-memory bearer token when required, and explicitly sends. Writes require acknowledgement that the request can change real data.
- Tokens never enter URLs, storage, logs, generated assets, or copied examples. Execution omits ambient cookies and referrers, rejects redirects, and disables request caching. Navigation, clearing, and unmount release sensitive state and abort pending work.
- Requests have a bounded timeout and cancellation. Cancellation or a network failure cannot prove a mutation was rolled back; inspect actual state and follow the operation's idempotency/concurrency contract before retrying. The explorer does not retry automatically.
- Response display is bounded and masks known credential fields and the supplied bearer value. It displays status, duration, safe headers, and text/JSON without executing content. This is not a general data-loss prevention system; use appropriate local/test data and access.
- Unsupported authentication, media types, or parameter serialization remain inspectable with an explicit execution limitation. The server continues to enforce authentication, authorization, validation, concurrency, and rate limits.

## Scaling and maintenance

Rendering, search, catalog navigation, and API execution have separate modules. Adding a document requires no JSX page or navigation registration. Only live examples need explicit component-owned renderers, so arbitrary metadata cannot instantiate executable UI. Generated operation pages include their referenced schema closure rather than every unrelated schema.

Full-text search runs in a dedicated worker after an explicit query. It processes bounded shards, retains a bounded ranked result set, and terminates obsolete searches. Overlapping chunks preserve terms at boundaries; streamed section matching combines terms across chunks and shards without retaining a complete section or returning duplicates. Initial navigation does not load the search corpus or render all document bodies. Results link to matching headings and can be narrowed by kind. Catalog pagination bounds both folders and documents; outlines are local to the open page.

The catalog still grows with entry count; search and static asset volume grow with indexed content. This is a static local foundation, not a promise of constant-time search over unlimited content. Measure generated sizes, worker latency, build time, and browser memory for the real project. Very large deployments may need further catalog partitioning or a deliberate indexed search service; preserve canonical inputs, local privacy expectations, deterministic artifacts, and a no-service reading path when making that decision. Do not load every detail into one bundle or add an external index merely because more files exist.

## Change and verification workflow

1. Edit the owning Markdown, contract, schema, or component metadata. Regenerate upstream API/database/SDK references when their sources change.
2. Run `pnpm docs:references:write`, including after ordinary authored documentation changes. Review generated differences, links, sensitive content, and obsolete output removal.
3. Run `pnpm docs:references:test`, `pnpm docs:check`, `pnpm docs:references:check`, relevant unit/browser checks, and the full `pnpm validate` gate. Generator tests protect publication boundaries; browser tests cover routes, search, exploration, synthetic previews, and automated accessibility checks plus keyboard/mobile behavior.
4. For substantial generation/build changes, verify frozen installation, regeneration with no diff, build, and a real browser in a clean checkout without a local environment file or existing generated cache. Remote CI runs the same full gate; record actual results separately from local evidence.

See [setup](../setup.md#living-documentation-portal) for commands and [validation](../validation.md) for available checks. The portal does not select providers or deploy infrastructure.

The [manual checklist](../validation.md#living-documentation-manual-browser-checks) is the guide for human-observed acceptance after material UI changes. Keep human-observed acceptance distinct from the automated browser suites in the normal repository gate.
