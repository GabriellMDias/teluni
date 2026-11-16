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
| `filters` | `{ active: number; render: (close) => ReactNode }` | Offers an icon-only Filter action right of Refresh that opens these filters in a modal dialog; active is the number of filters in effect, shown as a count on the action, and render returns the caller's fields and actions, which call close after applying or clearing. Omit it where the records have no filters. | See type | — |
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
- Filters open in a modal and active filters counted
- Exporting

Accessibility: The toolbar uses role=toolbar with labeled icon buttons and tooltips. The grid follows DataGrid: rows show selection only through color and aria-selected, are reached with the arrow keys, and Enter opens the form like a double-click. Links and buttons inside cells keep their own behavior. The Export menu is a labeled Menu; it is busy while a file is prepared, and a failure is announced as an alert. The Filter action has an accessible name and tooltip that include the number of active filters; its modal is a native dialog labelled Filters that keeps focus inside, focuses the field marked data-autofocus, closes with Escape, the close button or a click outside its box, and returns focus to the action.

Usage: Keep records, selection, mode, API calls, permissions and draft handling in the feature. Pass handlers only for actions the API supports and the person may perform, and withhold onSelect and navigation while a form has unsaved changes. Sorting, filters and column widths persist while the dataset switches modes; previous and next follow the order the grid shows. Enable multiple only where several records can be acted on together. Pass exportName to offer exports; columns without a value are left out, numbers stay numeric in Excel, and CSV uses the locale's separator and decimal mark. Pass filters for criteria the caller applies when loading records, such as server-side filters kept in the URL; the grid's column filters still act only on the loaded rows.

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


## ScreenCard

Groups one screen-related topic or task with a heading and optional explanation.

Category: Layout. Scope: feature-specific. Owner: Devices.

Source: [apps/web/src/devices/components.tsx](../../../apps/web/src/devices/components.tsx) (export `ScreenCard`). Metadata: [apps/web/src/devices/components.docs.json](../../../apps/web/src/devices/components.docs.json).

### Props

| Name | Type | Meaning | Required | Default |
| --- | --- | --- | --- | --- |
| `title` | `string` | Visible heading and accessible section name. | Yes | — |
| `description` | `string` | Optional contextual guidance below the heading. | See type | — |
| `children` | `ReactNode` | Topic-specific facts, status or caller-owned form. | Yes | — |
| `className` | `string` | Optional feature styling, such as the danger section. | See type | — |

### States

- Facts populated
- Loading or unavailable information supplied by the caller
- Management form
- Danger section with a native disclosure

Accessibility: The section has the supplied title as its accessible name and an h2 heading. Consumers own meaningful heading order, form labels, errors and status announcements. Uses inherited product colors for light and dark themes and collapses through the surrounding feature grid on narrow screens.

Usage: Use within the screen detail sections for display settings, hardware, synchronization, diagnostics and management. This feature-owned composition uses native section/header markup; it does not load data, enforce permissions or own form state. Prefer the existing native link navigation for URL-owned sections rather than introducing a tab widget.

### Examples

- **Device information** (`screen-card-hardware`): Groups reported device facts without inferring support or connection state.

```tsx
<ScreenCard title="Device and application" description="Reported by the screen."><dl><dt>App version</dt><dd>1.0.0</dd></dl></ScreenCard>
```


## ScreenStatus

Compact, noninteractive screen status with a decorative dot and semantic tone.

Category: Data Display. Scope: feature-specific. Owner: Devices.

Source: [apps/web/src/devices/components.tsx](../../../apps/web/src/devices/components.tsx) (export `ScreenStatus`). Metadata: [apps/web/src/devices/components.docs.json](../../../apps/web/src/devices/components.docs.json).

### Props

| Name | Type | Meaning | Required | Default |
| --- | --- | --- | --- | --- |
| `children` | `ReactNode` | Localized visible status text. | Yes | — |
| `tone` | `positive \| danger \| info \| neutral` | Semantic visual emphasis; does not infer business state. | See type | neutral |

### States

- Positive
- Danger
- Informational
- Neutral or unknown

Accessibility: Always includes readable status text. Color and the decorative CSS dot are supplementary. Does not add a live region, avoiding repeated announcements from five-second polling.

Usage: Use in the screen list and details for pairing, connection and publication states. Keep those concepts distinct: a paired screen is not necessarily connected. The caller supplies the authorized API value and localized text; missing data stays unknown rather than appearing healthy.

### Examples

- **Publication failure** (`screen-status-publication`): The visible text explains the status independently of color.

```tsx
<ScreenStatus tone="danger">Update failed</ScreenStatus>
```


## MediaBrowser

Company media file manager with URL-owned navigation and an in-memory selection and clipboard.

Category: Data Display. Scope: feature-specific. Owner: Media.

Source: [apps/web/src/media/manager.tsx](../../../apps/web/src/media/manager.tsx) (export `MediaBrowser`). Metadata: [apps/web/src/media/components.docs.json](../../../apps/web/src/media/components.docs.json).

### Props

| Name | Type | Meaning | Required | Default |
| --- | --- | --- | --- | --- |
| `companyId` | `string` | Authorized company identifier. | Yes | — |
| `company` | `CompanyWithAccess` | Current company and capability snapshot; the API enforces owning scope. | Yes | — |
| `filter` | `MediaFilter` | Validated router-owned view, folder, filters, layout and cursors. | Yes | — |
| `branches` | `BranchChoice[]` | Visible branch labels for scope selection. | Yes | — |
| `renderUpload` | `function` | Existing upload workflow with destination, initial files and busy-state callback. | Yes | — |
| `renderPreview` | `function` | Existing authorized rendition renderer for one asset. | Yes | — |

### States

- Root or nested folder
- Global name search
- Grid/list
- Multiple selection and cut/copy clipboard
- Upload/rename/destination/preview dialogs
- Read denial or stale write
- Unknown outcome with same-command reconciliation
- Archived and trash views

Accessibility: Native breadcrumbs and links preserve navigation. Grid tiles have named selection checkboxes and Enter/double-click activation; list view uses DataGrid keyboard semantics. Ctrl/Command+A/C/X/V and F2 skip editable inputs and modal tasks. Menus and native dialogs manage keyboard/focus; visible status and failures accompany semantic colors. Responsive layouts and semantic tokens support narrow screens and both themes.

Usage: Use as the company library inside its existing session/company gate. Composes shared Menu, Checkbox and DataGrid. Folder/filter/layout/page state belongs to the router, remote resources to Query, and temporary selection, clipboard and dialogs to React. Server permissions, scope, lifecycle, depth and reference checks remain authoritative. Upload and full media rendering are supplied by the owning workflow. Keep this authenticated composition out of static live catalog examples.

### Examples

- **Authenticated library composition** (`media-browser-composition`): Feature composition is documented without making live requests in the catalog.

```tsx
<MediaBrowser companyId={companyId} company={company} filter={search} branches={branches} renderUpload={renderUpload} renderPreview={renderPreview} />
```


## MediaDialog

Native modal shell for bounded media management tasks.

Category: Feedback. Scope: feature-specific. Owner: Media.

Source: [apps/web/src/media/dialogs.tsx](../../../apps/web/src/media/dialogs.tsx) (export `MediaDialog`). Metadata: [apps/web/src/media/components.docs.json](../../../apps/web/src/media/components.docs.json).

### Props

| Name | Type | Meaning | Required | Default |
| --- | --- | --- | --- | --- |
| `title` | `string` | Dialog heading and accessible name. | Yes | — |
| `children` | `ReactNode` | Task content. | Yes | — |
| `onClose` | `function` | Dismisses caller-owned state. | Yes | — |
| `busy` | `boolean` | Prevents dismissal during an operation. | See type | false |
| `wide` | `boolean` | Larger preview width. | See type | false |

### States

- Open
- Busy
- Preview width

Accessibility: Uses dialog.showModal, a labelled heading, autofocus target, native focus containment and Escape, with opener restoration when still connected. Close controls are unavailable while busy.

Usage: Supply a localized title and close callback. Set busy during writes/uploads to prevent dismissal; wide is reserved for previews. The caller owns form state and write recovery.

### Examples

- **Rename task** (`media-dialog-task`): Feature modal with caller-owned fields.

```tsx
<MediaDialog title="Rename" onClose={close}><form>…</form></MediaDialog>
```


## MediaFolderPicker

On-demand destination browsing for atomic move/copy commands.

Category: Forms. Scope: feature-specific. Owner: Media.

Source: [apps/web/src/media/dialogs.tsx](../../../apps/web/src/media/dialogs.tsx) (export `MediaFolderPicker`). Metadata: [apps/web/src/media/components.docs.json](../../../apps/web/src/media/components.docs.json).

### Props

| Name | Type | Meaning | Required | Default |
| --- | --- | --- | --- | --- |
| `companyId` | `string` | Authorized company. | Yes | — |
| `initialId` | `string \| null` | Starting folder or root. | Yes | — |
| `action` | `MOVE \| COPY` | Controls scope guidance. | Yes | — |
| `sourceFolderIds` | `readonly string[]` | Selected folders to exclude as destinations. | Yes | — |
| `sourceScopes` | `readonly (string \| null)[]` | Owning scopes for move compatibility. | Yes | — |
| `onChoose` | `function` | Submits the chosen destination identity. | Yes | — |
| `pending` | `boolean` | Write in progress. | Yes | — |
| `error` | `unknown` | Authoritative command failure. | Yes | — |
| `onReload` | `function` | Reconciles unknown outcomes or refreshes stale selection. | Yes | — |

### States

- Root
- Nested folder
- Pagination
- Scope/descendant refusal
- Read failure
- Unknown write outcome

Accessibility: Named native breadcrumb and folder buttons, visible scope hints, loading/error feedback and a disabled confirmation for incompatible or unresolved destinations.

Usage: Use within MediaDialog, with source identities/scopes and the action. Loads paginated visible folders rather than the entire tree. Scope and descendant hints improve choice; server validation remains authoritative.

### Examples

- **Move destination** (`media-folder-picker-task`): Documented composition requires authenticated data.

```tsx
<MediaFolderPicker companyId={companyId} initialId={null} action="MOVE" sourceFolderIds={ids} sourceScopes={scopes} pending={pending} error={error} onReload={reload} onChoose={move} />
```


## ProgrammingGuide

Explains the existing content-to-screen workflow.

Category: Layout. Scope: feature-specific. Owner: Programming.

Source: [apps/web/src/programming/workspace.tsx](../../../apps/web/src/programming/workspace.tsx) (export `ProgrammingGuide`). Metadata: [apps/web/src/programming/components.docs.json](../../../apps/web/src/programming/components.docs.json).

### Props

| Name | Type | Meaning | Required | Default |
| --- | --- | --- | --- | --- |

### States

- Localized Portuguese/English
- Light/dark and narrow/wide screens

Accessibility: Native navigation, aria-current and hidden semantics preserve keyboard navigation and remove inactive controls from the accessibility tree. Product semantic colors support both themes; layouts wrap at narrow widths.

Usage: Use above the programming overview. Static guidance explains playlists, shared/individual schedules and the separate publish action without inferring task completion.

### Examples

- **Programming composition** (`programmingguide-composition`): Feature-owned composition without live authenticated requests.

```tsx
<ProgrammingGuide />
```


## ProgramNavigation

URL-owned sections for group and screen programming.

Category: Navigation. Scope: feature-specific. Owner: Programming.

Source: [apps/web/src/programming/workspace.tsx](../../../apps/web/src/programming/workspace.tsx) (export `ProgramNavigation`). Metadata: [apps/web/src/programming/components.docs.json](../../../apps/web/src/programming/components.docs.json).

### Props

| Name | Type | Meaning | Required | Default |
| --- | --- | --- | --- | --- |
| `companyId` | `string` | Authorized company identifier. | Yes | — |
| `source` | `ProgramSource` | Group or screen identity. | Yes | — |
| `section` | `ProgrammingSection` | Current validated URL section; omitted means Program. | No | — |
| `editable` | `boolean` | Current programming edit capability. | Yes | — |
| `assignable` | `boolean` | Current screen assignment capability. | No | — |

### States

- Default schedule
- Preview
- Group screens
- Publication
- Permitted settings or destination

Accessibility: Native navigation, aria-current and hidden semantics preserve keyboard navigation and remove inactive controls from the accessibility tree. Product semantic colors support both themes; layouts wrap at narrow widths.

Usage: Use within the authorized programming details page. Native router links separate schedule, preview, group membership, publication and permitted settings/destination; API permissions remain authoritative.

### Examples

- **Programming composition** (`programnavigation-composition`): Feature-owned composition without live authenticated requests.

```tsx
<ProgramNavigation companyId={companyId} source={source} section={section} editable={editable} assignable={assignable} />
```


## ProgrammingPanel

Retains visited programming drafts across section navigation.

Category: Layout. Scope: feature-specific. Owner: Programming.

Source: [apps/web/src/programming/workspace.tsx](../../../apps/web/src/programming/workspace.tsx) (export `ProgrammingPanel`). Metadata: [apps/web/src/programming/components.docs.json](../../../apps/web/src/programming/components.docs.json).

### Props

| Name | Type | Meaning | Required | Default |
| --- | --- | --- | --- | --- |
| `active` | `boolean` | Whether the validated URL selects this section. | Yes | — |
| `children` | `ReactNode` | Owning workflow and local form state. | Yes | — |

### States

- Unvisited
- Active
- Visited and hidden

Accessibility: Native navigation, aria-current and hidden semantics preserve keyboard navigation and remove inactive controls from the accessibility tree. Product semantic colors support both themes; layouts wrap at narrow widths.

Usage: Use for sections of the same resource. Initial content mounts on demand; visited children remain mounted under native hidden. Key the resource and write forms by authoritative identity/version; this preserves temporary state, not persistence across reloads.

### Examples

- **Programming composition** (`programmingpanel-composition`): Feature-owned composition without live authenticated requests.

```tsx
<ProgrammingPanel active={section === "preview"}>{preview}</ProgrammingPanel>
```
