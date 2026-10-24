# React Components and Design Practices

[Web application](../../apps/web/README.md) · [Living Documentation](living-documentation.md) · [Component reference](../generated/components/web.md)

This policy owns component reuse, classification, documentation and styling in the existing React application. It extends the application-owned UI direction in [ADR-0008](../adr/0008-select-react-vite-and-tanstack-for-web-applications.md) and the source/distribution separation in [ADR-0018](../adr/orion/0018-isolate-internal-documentation-from-product-distribution.md). No separate UI package, framework, component vendor or theme provider is selected.

## Inspect before implementing

Before implementing equivalent UI, contributors and AI agents must inspect the shared [component entry point](../../apps/web/src/components.tsx), its [metadata](../../apps/web/src/components.docs.json), applicable feature-owned `components.docs.json` files, and the generated reference or local `/docs/components` catalog. Use `rg --files apps/web/src` and targeted searches for the responsibility and existing controls, then read candidate implementation and tests. The catalog is curated; absence from it is not proof that equivalent private UI does not exist.

Compare responsibility, native semantics, props, states, accessibility, styling hooks and ownership before choosing reuse. Reuse when these genuinely match. Extend an existing component compatibly when the responsibility remains the same. Similar appearance alone does not justify sharing; keep business validation, permissions, credential handling, API calls and workflow state in their feature.

If no suitable component exists, start with native HTML or a local feature component. Extract shared presentation only for demonstrated reuse or a concrete stable primitive, with a narrow contract and an owner. Do not create a wrapper for every element, a speculative component for every category, a large configurable component for unrelated workflows, or a second implementation of equivalent behavior. Explain meaningful reuse or extraction decisions in the change; static checks cannot prove that an agent inspected existing UI.

## Responsibility and placement

| Reuse scope | Responsibility | Placement and documentation |
| --- | --- | --- |
| `shared` | Small reusable UI primitives with native semantics and no domain behavior, such as Button. | The web application's explicit `components.tsx` public entry point; every named uppercase runtime export needs owned metadata. Extract files only when it improves local reasoning. |
| `composed` | Cohesive reusable presentation built from primitives/native controls, such as a labeled TextField or ErrorNotice. | The same public entry point when shared across features; document the composition's own responsibility and states rather than duplicating every native prop. |
| `feature-specific` | A component tied to one workflow's terminology, state, permissions or side effects. | Its feature directory. Catalog notable reusable-within-feature components through local metadata when useful; private helpers and every React export elsewhere do not require catalog entries. |

`owner` names the maintaining boundary or module, not an invented team. Source ownership and reuse scope do not grant new dependency edges: features may consume shared UI; reusable UI and generic portal modules must not depend on feature workflows. Explicit application-specific example registrations follow the preview boundary below. A feature-specific component is not promoted by adding it to the catalog. Keep hooks, domain utilities and type exports outside the curated component export inventory. Type-only exports are exempt; prefer explicit named exports so humans and tools can discover the public surface. The existing generator uses the installed TypeScript parser to verify functions, component values and local re-exports, without executing source modules. Full type checking remains the compiler's responsibility.

## Categories and discovery

The default categories are **Actions, Inputs, Forms, Data Display, Feedback, Navigation, Overlays and Layout**. They describe UI responsibility rather than require implementations. A metadata file may add categories through its `categories` string array; additions should represent a useful discovery distinction. Unknown explicit categories fail validation, helping catch typos. Legacy entries without a category use `Uncategorized` until their owner classifies them.

The internal catalog offers category links with URL-owned selection, searchable ownership/scope/usage, props, states, accessibility, code examples, optional live previews, and source/metadata links. Existing `/docs/components/<name>` URLs remain stable; optional `id` supports namespaced identifiers when features use the same component name. Changing a name need not change an explicitly recorded ID. The generated manifest indexes category, scope, owner and source; its per-component JSON pages contain the normalized metadata. These files and the generated Markdown reference remain machine-readable for agents even when production builds exclude the portal.

## Owned metadata and compatibility

The canonical root [components.docs.json](../../apps/web/src/components.docs.json) remains valid in its existing shape. Additional `components.docs.json` files are discovered under `apps/web/src/` through Git's tracked and non-ignored files. Each uses a `components` array and may declare additional `categories` or a default `source`. Each entry may set:

| Field | Contract |
| --- | --- |
| `name`, `summary`, `usage`, `accessibility`, `props`, `states`, `examples` | Existing required fields remain supported. Props may be empty for a component without props; states and examples must be meaningful and nonempty. |
| `source` | Repository-relative owned source under `apps/web/src/`; defaults to `components.tsx` beside the metadata file. The named export must exist. |
| `exportName` | Actual named export when it differs from the displayed name; defaults to `name`. |
| `id` | Stable unique catalog identifier using letters, digits, dot, underscore or hyphen; defaults to `name`. |
| `category`, `scope`, `owner` | Explicit discovery and maintenance fields. Legacy defaults are `Uncategorized`, `shared` for a matching public entry-point export or `feature-specific` elsewhere, and the source path as owner. A public re-export retains shared scope when its metadata references the implementation file. New or substantially changed entries should specify all three. |
| Prop `required`, `default` | Optional boolean and explanatory string. Existing `name`, `type`, and `meaning` remain canonical authored guidance; native prop inheritance can be described as a rest-props row. |
| Example `code`, `live` | Optional JSX/TSX text and live-preview selection. Code-only examples default to static. Existing examples without code retain their registered live renderer. `live: true` requires the existing explicit renderer in `documentation/examples.tsx`; metadata never instantiates arbitrary code. |

Register a feature component locally with its actual source, owner, `feature-specific` scope and a code example by default. Existing projects' root-owned entries, extension fields and custom registered live examples remain supported; migration is additive. An explicitly maintained application example renderer may compose a feature's presentation with synthetic props and local state. It must not connect credentials, use production adapters, call domain APIs or cause workflow side effects; cover interactions with browser checks that assert no such requests. Generic catalog/rendering modules do not import features or instantiate metadata as code. Orion's foundation-only feature examples remain static so derivation never leaves a shared import of removed implementation. Only metadata owned by a foundation-only feature is removed with that feature; product-owned metadata and registrations remain the project's responsibility. Resolve canonical sources and preserve product examples before regenerating upgrade conflicts.

Run `pnpm docs:references:write` after metadata, public exports, examples or relevant documentation changes. `pnpm docs:references:check` and `pnpm docs:references:test` detect missing public metadata, invalid IDs/categories/scopes/props, duplicate entries/examples, broken source/re-export references, unsafe paths and missing live renderers. Source discovery follows only selected component files and their local re-exports, rejects symlinks and ignored sources, and does not index private source bodies. Generated files are never independently edited. These checks do not verify every prop's runtime meaning, visual quality or reuse decision; review and behavior tests remain required.

## Styling, themes and accessibility

The small [reference stylesheet](../../apps/web/src/ui.css) uses component-scoped classes and inherited semantic CSS variables with neutral fallbacks. `--ui-font-family`, `--ui-font-size` and `--ui-font-weight-semibold` control typography; `--ui-space-2`, `--ui-space-3` and `--ui-space-4` are the implemented spacing hooks; `--ui-radius` controls shape. Semantic `--ui-color-*` values cover surface, text, border, action/on-action, focus, muted text and danger/surface/border. Add a token only for a demonstrated shared visual meaning, and retain one source for each value rather than duplicating unexplained literals across shared controls.

Products own token values, typography, theme selection, brand assets, shell and layout. Override tokens on the application root or a scoped theme container; controls inherit them without a React provider or a mandatory light/dark palette. The catalog's token-override example is synthetic, scoped to the preview, and imposes no product identity. Preserve existing class hooks when evolving a shared component compatibly; migrate legacy feature styling incrementally when touched, rather than redesigning the entire application as a side effect.

Use native semantics and preserve native props/ref forwarding where practical. Define default, hover, focus, disabled, pending, validation and empty/populated states as relevant. Keep focus visible, disabled activation reliable, labels persistent, hint/error relationships explicit and errors understandable without color alone. Preserve keyboard operation and native form behavior; use links for navigation and explicit submit buttons for form submission. Test themes for readable contrast and relevant accessibility at the browser boundary. Features own asynchronous work, validation and live announcements; a visual component never grants authorization or retries an unknown write outcome.

The reference set intentionally stays small: **Button**, **TextField**, and **ErrorNotice**, exercised in real composition and local examples. No modal, grid, form engine or general layout library is implied by a taxonomy entry. More complex keyboard/focus patterns require their own concrete requirement and proportional tests before introduction.
