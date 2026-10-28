# Web Component Reference

<!-- Generated from owned components.docs.json files and verified against named component exports. Do not edit. -->

[Component architecture](../../architecture/web-components.md) · [Living documentation](../../architecture/living-documentation.md)

## Button

A native action button with explicit variants and safe pending behavior.

Category: Actions. Scope: shared. Owner: Web UI.

Source: [apps/web/src/components.tsx](../../../apps/web/src/components.tsx) (export `Button`). Metadata: [apps/web/src/components.docs.json](../../../apps/web/src/components.docs.json).

### Props

| Name | Type | Meaning | Required | Default |
| --- | --- | --- | --- | --- |
| `children` | `ReactNode` | Visible action name or content with an equivalent accessible name. | Yes | — |
| `type` | `button \| submit \| reset` | Native form behavior; the safe default does not submit a form. | No | button |
| `variant` | `primary \| secondary` | Semantic action emphasis, styled through product-owned tokens. | No | secondary |
| `pending` | `boolean` | Disables activation and exposes aria-busy while the caller owns pending work. | No | false |
| `…buttonProps` | `ComponentPropsWithRef<"button">` | Native props such as disabled, onClick, className, ref and ARIA attributes are forwarded. | See type | — |

### States

- Default and primary
- Hover and keyboard focus
- Disabled
- Pending
- Product token override

Accessibility: Uses a native button and visible focus. Pending disables activation and sets aria-busy; preserve meaningful button text while work is pending.

Usage: Use for actions. Use a link for navigation. Keep a visible accessible name; choose type=submit explicitly inside forms. Native button props and refs are forwarded.

### Examples

- **Action states and product styling** (`button-states`): Local actions, disabled and pending states, and a scoped token override.

```tsx
<Button variant="primary" onClick={save}>Save</Button>
<Button pending>Saving…</Button>
```


## TextField

A labeled native input with linked hints and validation messages.

Category: Inputs. Scope: composed. Owner: Web UI.

Source: [apps/web/src/components.tsx](../../../apps/web/src/components.tsx) (export `TextField`). Metadata: [apps/web/src/components.docs.json](../../../apps/web/src/components.docs.json).

### Props

| Name | Type | Meaning | Required | Default |
| --- | --- | --- | --- | --- |
| `type` | `Text-entry native input types` | Supports text, email, password, search, tel, url, number and native date/time inputs. Use separate native controls for checkbox, radio, file, range or other selection behavior. | No | text |
| `label` | `string` | Persistent accessible label; a placeholder cannot replace it. | Yes | — |
| `id` | `string` | Optional DOM id; a stable useId value is generated when absent. | No | Generated with useId |
| `hint` | `string` | Optional help linked to the input through aria-describedby. | No | — |
| `error` | `string` | Caller-owned validation message linked to the input; also marks it invalid. | No | — |
| `…inputProps` | `ComponentPropsWithRef<"input">` | Native value/defaultValue, onChange, type, required, disabled, className, ref and ARIA props are forwarded. Existing aria-describedby references are retained. | See type | — |

### States

- Empty and populated
- Hint
- Validation error
- Required
- Disabled
- Keyboard focus

Accessibility: Associates label and input through a stable id; links hint and error descriptions and sets aria-invalid for errors. Native required, disabled, ref and keyboard behavior are preserved. The feature owns dynamic error summaries or announcements.

Usage: Use for a single native input with a persistent label. The caller owns value, validation and submission. Keep domain-specific validation and credentials in the feature; use other native controls for multiline text or selection.

### Examples

- **Labeled input and validation** (`text-field-states`): Synthetic form input with a hint, validation message and disabled state.

```tsx
<TextField label="Name" hint="Shown to your colleagues." required />
<TextField label="Email" type="email" error="Enter an email address." />
```


## Checkbox

A native checkbox with a persistent label and an optional mixed state.

Category: Inputs. Scope: shared. Owner: Web UI.

Source: [apps/web/src/components.tsx](../../../apps/web/src/components.tsx) (export `Checkbox`). Metadata: [apps/web/src/components.docs.json](../../../apps/web/src/components.docs.json).

### Props

| Name | Type | Meaning | Required | Default |
| --- | --- | --- | --- | --- |
| `label` | `ReactNode` | Visible label that names the checkbox. | Yes | — |
| `indeterminate` | `boolean` | Shows the mixed state, for example when only some options are chosen. | No | false |
| `…inputProps` | `ComponentPropsWithRef<"input">` | Native props such as checked, onChange, disabled, name and ref are forwarded. | See type | — |

### States

- Unchecked
- Checked
- Mixed
- Keyboard focus
- Disabled

Accessibility: The native input stays focusable and announced while a drawn box shows checked, mixed, focus and disabled states; the whole label toggles it. indeterminate sets the native mixed state that assistive technology reports.

Usage: Use for independent on/off choices and for select-all controls whose options are partly chosen. The checked value stays caller-owned. Native input props and refs are forwarded.

### Examples

- **Checkbox states** (`checkbox-states`): Checked, mixed and disabled examples held locally.

```tsx
<Checkbox label="Select all" checked={all} indeterminate={some} onChange={toggleAll} />
```


## ErrorNotice

Displays a public API failure message and an optional reload action.

Category: Feedback. Scope: composed. Owner: Web UI.

Source: [apps/web/src/components.tsx](../../../apps/web/src/components.tsx) (export `ErrorNotice`). Metadata: [apps/web/src/components.docs.json](../../../apps/web/src/components.docs.json).

### Props

| Name | Type | Meaning | Required | Default |
| --- | --- | --- | --- | --- |
| `error` | `unknown` | Mapped through the shared public failure-message boundary. | See type | — |
| `operation` | `read \| create \| write` | Selects the failure wording; failed or lost writes are reported as unknown outcomes. Defaults to read. | See type | — |
| `messages` | `Record<string, string> (optional)` | Module-specific wording for its own stable error codes. | See type | — |
| `onReload` | `() => void` | Optional recovery action when current data can be refreshed. | See type | — |
| `reloadLabel` | `string (optional)` | Accessible name of the reload action; defaults to Reload. | See type | — |

### States

- Failure message
- Failure message with reload action

Accessibility: Uses role=alert so the failure is announced; the optional reload control is a native button.

Usage: Pass the original error to preserve stable-code mapping. Offer reload only when the current data can be refreshed, and never imply that an unknown write outcome failed.

### Examples

- **Unavailable service with reload** (`unavailable-reload`): A synthetic SERVICE_UNAVAILABLE response; no live request is involved.

## Popover

A non-modal surface in the browser's top layer, placed next to an anchor element.

Category: Overlays. Scope: shared. Owner: Web UI.

Source: [apps/web/src/components.tsx](../../../apps/web/src/components.tsx) (export `Popover`). Metadata: [apps/web/src/components.docs.json](../../../apps/web/src/components.docs.json).

### Props

| Name | Type | Meaning | Required | Default |
| --- | --- | --- | --- | --- |
| `anchor` | `HTMLElement \| null` | Element the popover is placed below, or above when only that fits. | Yes | — |
| `open / onClose` | `boolean / () => void` | Caller-owned visibility; onClose reports Escape, outside clicks and other popovers. | Yes | — |
| `label` | `string` | Accessible name of the popover. | Yes | — |
| `returnFocus` | `HTMLElement \| null` | Receives focus when the popover closes with focus inside it. | No | anchor |
| `role` | `dialog \| menu` | Semantic role of the surface. | No | dialog |
| `align` | `start \| end` | Aligns the popover with the anchor's start or end edge. | No | start |
| `children` | `ReactNode` | Content rendered while open. | Yes | — |

### States

- Closed
- Open below the anchor
- Open above when only that fits
- Dismissed by Escape or an outside click

Accessibility: Uses the native popover attribute with role=dialog (or menu) and an aria-label. Opening focuses the element marked data-autofocus, or the popover itself. Escape, an outside click or another popover closes it; focus that would otherwise be lost returns to returnFocus or the anchor.

Usage: Use for small panels tied to a control, such as filters or details, that should not be clipped by scrolling containers. The caller owns open and closes it from onClose. Content renders only while open, so its local state starts fresh each time. Use a page or form for long workflows.

### Examples

- **Anchored details** (`popover-anchored`): A button toggles synthetic details; no request is made.

```tsx
<Button ref={setAnchor} onClick={() => setOpen(!open)}>Details</Button>
<Popover anchor={anchor} open={open} onClose={() => setOpen(false)} label="Details">…</Popover>
```


## Menu

A button that opens a list of actions in a Popover.

Category: Actions. Scope: composed. Owner: Web UI.

Source: [apps/web/src/components.tsx](../../../apps/web/src/components.tsx) (export `Menu`). Metadata: [apps/web/src/components.docs.json](../../../apps/web/src/components.docs.json).

### Props

| Name | Type | Meaning | Required | Default |
| --- | --- | --- | --- | --- |
| `label` | `string` | Names the trigger and the menu; also the trigger's tooltip. | Yes | — |
| `items` | `MenuItem[]` | Items with a stable key, label and onSelect, plus optional icon, checked and disabled. | Yes | — |
| `children` | `ReactNode` | Trigger content, usually an icon. | Yes | — |
| `align` | `start \| end` | Aligns the menu with the trigger's start or end edge. | No | start |
| `…buttonProps` | `ComponentPropsWithRef<"button">` | Native trigger props such as className, ref and data attributes are forwarded. | See type | — |

### States

- Closed
- Open
- Checked item
- Disabled item
- Keyboard focus

Accessibility: The trigger is a labeled button with aria-haspopup=menu and aria-expanded. Items use menuitem or menuitemcheckbox roles. Enter, Space or ArrowDown opens on the first item and ArrowUp on the last; arrow keys, Home and End move between enabled items; Escape returns focus to the trigger and Tab closes the menu.

Usage: Use for a few secondary actions attached to a control, such as column options. Each item's onSelect runs as the menu closes; pass checked for items with an on/off state and disabled for unavailable ones. Trigger props such as className, ref and data attributes are forwarded.

### Examples

- **Secondary actions** (`menu-actions`): One available and one disabled synthetic action; no request is made.

```tsx
<Menu label="Store actions" items={[{ key: "rename", label: "Rename", onSelect: rename }]}>
  <MoreIcon />
</Menu>
```


## MultiSelectList

A searchable list for choosing several options, with select-all, that renders only the options in view.

Category: Inputs. Scope: composed. Owner: Web UI.

Source: [apps/web/src/components.tsx](../../../apps/web/src/components.tsx) (export `MultiSelectList`). Metadata: [apps/web/src/components.docs.json](../../../apps/web/src/components.docs.json).

### Props

| Name | Type | Meaning | Required | Default |
| --- | --- | --- | --- | --- |
| `label` | `string` | Accessible name of the option list. | Yes | — |
| `locale` | `pt-BR \| en-US` | Language of the search and select-all labels, and of search matching. | Yes | — |
| `options` | `readonly MultiSelectOption[]` | Options with a stable value and a label, in display order. Keep the array stable between renders. | Yes | — |
| `selected / onChange` | `ReadonlySet<string> / (selected: Set<string>) => void` | Caller-owned chosen values. | Yes | — |
| `query / onQueryChange` | `string / (query) => void` | Optional controlled search text. | See type | — |
| `height` | `number` | Maximum height of the scrolling list in pixels. | No | 240 |

### States

- All chosen
- Some chosen (mixed select-all)
- Searching
- No results
- Keyboard focus on the active option

Accessibility: Composes TextField for the search and Checkbox for select-all, which shows a mixed state when only some options are chosen. The options form a listbox with aria-multiselectable, aria-activedescendant and aria-setsize/aria-posinset, so arrow keys, Page Up/Down, Home and End reach every option while only those in view are rendered; Space toggles the active option, and ArrowDown moves from the search into the list.

Usage: Use when people choose several values from a long list, such as a column filter. Options keep their display order and a stable value; the selection set stays caller-owned. Search ignores case and accents; pass query and onQueryChange when the caller needs the search, and use searchOptions to find the same matches. Select all applies to the options the search found.

### Examples

- **Searchable choices** (`multi-select-list-search`): Synthetic cities chosen locally; no request is made.

```tsx
<MultiSelectList label="Cities" locale="en-US" options={options} selected={selected} onChange={setSelected} />
```


## DataGrid

A virtualized grid that sorts, filters and resizes columns over the rows it receives, with single or multiple selection.

Category: Data Display. Scope: composed. Owner: Web UI.

Source: [apps/web/src/components.tsx](../../../apps/web/src/components.tsx) (export `DataGrid`). Metadata: [apps/web/src/components.docs.json](../../../apps/web/src/components.docs.json).

### Props

| Name | Type | Meaning | Required | Default |
| --- | --- | --- | --- | --- |
| `label` | `string` | Accessible name of the grid. | Yes | — |
| `locale` | `pt-BR \| en-US` | Language of the grid labels, sorting and number formatting. | Yes | — |
| `rows` | `readonly Row[]` | All rows to show. Keep the array stable between renders. | Yes | — |
| `columns` | `DataGridColumn<Row>[]` | Stable key and header; value enables sorting and filtering, render overrides the formatted value, format names values, and width, minWidth, align, sortable, filterable and resizable tune the column. Keep the array stable between renders. | Yes | — |
| `rowId` | `(row) => string` | Stable row identity. | Yes | — |
| `selectedId / onSelect` | `string / (id) => void` | The current row. With single selection it is the highlighted row; clicking a row or moving with the arrow keys calls onSelect. | See type | — |
| `multiple` | `boolean` | Allows choosing several rows: Ctrl/⌘ toggles a row, Shift selects a range, Space toggles the focused row and Ctrl/⌘+A selects every shown row. | No | false |
| `selectedIds / onSelectedIdsChange` | `readonly string[] / (ids) => void` | Caller-owned multiple selection; used only with multiple. | See type | — |
| `onRowActivate` | `(id) => void` | Double-click or Enter on a row. | See type | — |
| `exportName` | `string` | Offers an Export menu in the footer with Excel (.xlsx), CSV and PDF files of the rows the grid shows, in their order and with its filters; the name titles the files. Omit it where records must not leave the screen. | See type | — |
| `empty` | `ReactNode` | Shown instead of the grid when there are no rows. | See type | — |

### States

- Sorted ascending or descending
- Filtered, with the filter shown on the header
- No rows match the filters
- Single selection
- Multiple selection
- Resizing a column
- Many rows (only those in view rendered)
- Exporting

Accessibility: Uses role=grid with aria-rowcount and aria-rowindex, so assistive technology knows the full size while only the rows in view are rendered. Rows expose aria-selected (aria-multiselectable with multiple) and form one tab stop: arrow keys, Page Up/Down, Home and End move between rows, Enter activates and Space selects. Column headers expose aria-sort; their sort button, options Menu and a separator that Left/Right arrows resize are keyboard reachable, and the options appear on hover or focus. A live status reports the shown, total and selected counts. The Export menu is a labeled Menu; it is busy while a file is prepared, and a failure is announced as an alert.

Usage: Use for lists of records that people scan, sort and filter in the browser; DataSet adds the CRUD toolbar and form. Give each column a value to sort and filter by. Sorting and filtering apply to the rows passed in, so a paginated caller sorts and filters only the loaded page; server-side sorting and filtering are not provided. Keep rows and columns stable between renders. Selection stays caller-owned. Pass exportName to offer Excel, CSV and PDF exports of the rows shown.

### Examples

- **Ten thousand rows** (`data-grid-large`): Synthetic screens generated locally; the example passes multiple, so Ctrl/⌘ and Shift choose several rows, and exportName, so the footer exports them. Sorting, filtering, resizing and exports make no request.

```tsx
<DataGrid label="Screens" locale="en-US" rows={screens} columns={columns} rowId={(row) => row.id}
  multiple selectedIds={selected} onSelectedIdsChange={setSelected} exportName="Screens" />
```


## DataSet

Record-oriented CRUD presentation: a toolbar, a DataGrid and a caller-rendered form.

Category: Data Display. Scope: composed. Owner: Web UI.

Source: [apps/web/src/components.tsx](../../../apps/web/src/components.tsx) (export `DataSet`). Metadata: [apps/web/src/components.docs.json](../../../apps/web/src/components.docs.json).

### Props

| Name | Type | Meaning | Required | Default |
| --- | --- | --- | --- | --- |
| `label` | `string` | Accessible name of the dataset region and its grid. | Yes | — |
| `locale` | `pt-BR \| en-US` | Language of the toolbar and grid labels. | Yes | — |
| `mode` | `grid \| form` | Caller-owned view; keep it in the URL when it identifies the page state. | Yes | — |
| `rows` | `readonly Row[]` | Records of the current page, already authorized by the API. Keep the array stable between renders. | Yes | — |
| `columns` | `DataGridColumn<Row>[]` | Stable key and header; value enables sorting and filtering, render overrides the formatted value, format names values, and width, minWidth, align, sortable, filterable and resizable tune the column. Keep the array stable between renders. | Yes | — |
| `rowId` | `(row) => string` | Stable record identity. | Yes | — |
| `selectedId / onSelect` | `string / (id) => void` | The current row. With single selection it is the highlighted row; clicking a row or moving with the arrow keys calls onSelect. | See type | — |
| `multiple` | `boolean` | Allows choosing several rows: Ctrl/⌘ toggles a row, Shift selects a range, Space toggles the focused row and Ctrl/⌘+A selects every shown row. | No | false |
| `selectedIds / onSelectedIdsChange` | `readonly string[] / (ids) => void` | Caller-owned multiple selection; used only with multiple. | See type | — |
| `onModeChange, onAdd, onDuplicate, onRefresh` | `() => void (optional)` | Toolbar actions; an omitted handler disables its button, for example while a draft is unsaved. Double-click or Enter on a row selects it and requests form mode. | See type | — |
| `onDelete` | `(() => void) \| null (optional)` | Omit when the records cannot be deleted; null shows the action disabled. | See type | — |
| `refreshing` | `boolean` | Marks the refresh action busy while the caller reloads data. | No | false |
| `exportName` | `string` | Offers an Export menu in the toolbar with Excel (.xlsx), CSV and PDF files of the rows the grid shows, in their order and with its filters; the name titles the files. Omit it where records must not leave the screen. | See type | — |
| `empty` | `ReactNode` | Grid content when there are no rows. | See type | — |
| `children` | `ReactNode` | The current record's form, rendered only in form mode. | See type | — |

### States

- Grid with single selection
- Grid with multiple selection
- Sorted and filtered grid
- Empty grid
- Form mode
- Actions disabled
- Refreshing
- Exporting

Accessibility: The toolbar uses role=toolbar with labeled icon buttons and tooltips. The grid follows DataGrid: rows show selection only through color and aria-selected, are reached with the arrow keys, and Enter opens the form like a double-click. Links and buttons inside cells keep their own behavior. The Export menu is a labeled Menu; it is busy while a file is prepared, and a failure is announced as an alert.

Usage: Keep records, selection, mode, API calls, permissions and draft handling in the feature. Pass handlers only for actions the API supports and the person may perform, and withhold onSelect and navigation while a form has unsaved changes. Sorting, filters and column widths persist while the dataset switches modes; previous and next follow the order the grid shows. Enable multiple only where several records can be acted on together. Pass exportName to offer exports; columns without a value are left out, numbers stay numeric in Excel, and CSV uses the locale's separator and decimal mark.

### Examples

- **Grid and form modes** (`dataset-modes`): Synthetic local records with single selection, as on the companies page; selection and mode are held by the example and no request is made. A screen that acts on several records at once passes multiple; DataGrid's example shows it.

```tsx
<DataSet label="Stores" locale="en-US" mode={mode} rows={stores} columns={columns}
  rowId={(row) => row.id} selectedId={selected} onSelect={setSelected} onModeChange={setMode}
  exportName="Stores">
  <StoreForm id={selected} />
</DataSet>

// Only where a screen acts on several records at once:
<DataSet multiple selectedIds={chosen} onSelectedIdsChange={setChosen} {...props} />
```
