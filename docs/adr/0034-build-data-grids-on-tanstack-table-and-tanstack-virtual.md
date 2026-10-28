# ADR-0034: Build Data Grids on TanStack Table and TanStack Virtual

**Status:** accepted
**Date:** 2026-10-27

**Acceptance scope:** On 2026-10-27 the owner asked for sorting, column filters, column resizing and configurable multiple selection in the shared `DataSet`, designed for very many rows, and asked the agent to use the best available technology. The agent accepted this decision under that request and the delegation recorded with [PH-25](../project/human-actions.md#ph-25); merging the pull request that adds it is the repository review. It selects the web panel's grid libraries. It does not add server-side sorting or filtering to any API.

## Context

[ADR-0008](0008-select-react-vite-and-tanstack-for-web-applications.md) chose React, Vite and TanStack Router and Query, and deferred data grids and virtualization until their requirements were understood. The companies page's `DataSet` now needs a grid that:

- sorts by clicking a header or from a header menu, and filters a column by choosing among its values with search and select-all;
- resizes columns and supports single or multiple selection;
- stays responsive with tens of thousands of rows in the body and in a column's value list.

Rendering every row as DOM does not scale to that size, and sorting, value faceting and resizing have subtle edge cases (blank values, filters that interact, live resizing). The product owns its markup, styles, accessibility and theme through `--ui-*` tokens, so a grid must not impose its own look. The React Compiler is enabled.

## Decision

The web panel builds grids on two headless libraries, pinned exactly in `apps/web`:

- **TanStack Table v9** (`@tanstack/react-table`) owns the grid model: sorting, column filtering, value faceting and column sizing/resizing, with only those features registered.
- **TanStack Virtual v3** (`@tanstack/react-virtual`) renders only the rows, and filter options, in view.

Teluni renders all markup itself in the shared `DataGrid`, which `DataSet` composes, and the shared `MultiSelectList`. Row selection remains caller-owned rather than table state, so features keep selection next to their URL and API state. Sorting and filtering run in the browser over the rows the caller supplies; a list that cannot load all its rows needs server-side sorting and filtering added to its API first.

## Rationale

- Both libraries are headless, so the product keeps its semantic markup, ARIA grid roles, keyboard model and token-based styling.
- They belong to the TanStack family already selected by ADR-0008, are MIT-licensed and widely used, and add only the registered features to the bundle.
- TanStack Table's faceting gives each column's distinct values while applying the other columns' filters, which is the behavior a value filter needs. Its row models are memoized and recompute only when data or state change.
- Virtualization keeps the DOM to a few dozen rows regardless of size. In a development build, 10,000 rows sorted in about 75 ms and a filter with 10,000 distinct values opened in about 80 ms rendering 14 options.
- TanStack Table v9's React adapter returns a new table reference when its state changes, so components compiled by the React Compiler update. The virtualizer keeps one instance whose output changes while scrolling, so the components that read it opt out with the `"use no memo"` directive.

## Alternatives Considered

### A complete data grid component (for example AG Grid or MUI X Data Grid)

These provide sorting, filtering and virtualization, but bring their own markup, styling system and theming, are much larger, and reserve some features for commercial licenses. Adapting them to the product's tokens and accessibility choices would fight the library.

### Own implementation without libraries

Sorting and selection are small, but virtualization with scrolling to a row, faceting under interacting filters and live column resizing would be new code with its own defects and tests, duplicating mature libraries.

### Virtualization only, with an own grid model

TanStack Virtual alone solves rendering size, but leaves the faceting and resizing edge cases above to the product.

## Consequences

### Positive

- One grid serves small lists like companies and large in-browser lists, with consistent sorting, filtering, resizing and selection.
- The headless model keeps the existing styling, theme and accessibility responsibilities in the product.

### Negative

- Two runtime dependencies to keep current; TanStack Table v9 is recent, so upgrades need the browser tests that cover the grid.
- Sorting and filtering apply only to loaded rows; paginated lists filter the loaded page until their APIs support server-side processing.
- Text sorts with `Intl.Collator` for the person's locale without numeric collation, which was about 2.7 times slower in measurement; "Loja 10" therefore sorts before "Loja 9". Numeric values sort as numbers.

### Operational or Migration Impact

- No API, database or deployment change. Replacing either library would affect only `apps/web/src/data-grid.tsx` and `apps/web/src/multi-select-list.tsx`.

## References

- [ADR-0008](0008-select-react-vite-and-tanstack-for-web-applications.md)
- [Component architecture and design practices](../architecture/web-components.md)
- [Web application guide](../../apps/web/README.md#companies-and-branches)
- [Implementation plan](../project/implementation-plan.md#companies-dataset-grid-increment)
