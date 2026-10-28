import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  columnFacetingFeature,
  columnFilteringFeature,
  columnResizingFeature,
  columnSizingFeature,
  createFacetedRowModel,
  createFacetedUniqueValues,
  createFilteredRowModel,
  createSortedRowModel,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type ColumnDef,
  type FilterFn,
  type ReactTable,
  type RowData,
  type SortFn,
} from "@tanstack/react-table";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import { Button } from "./controls.js";
import {
  exportTable,
  type ExportCell,
  type ExportFormat,
} from "./data-export.js";
import type { Locale } from "./locale.js";
import {
  MultiSelectList,
  searchOptions,
  type MultiSelectOption,
} from "./multi-select-list.js";
import { Menu, Popover, type MenuItem } from "./popover.js";
import { UiIcon } from "./ui-icon.js";
import "./data-grid.css";

/** A plain value a column sorts and filters by. */
export type DataGridValue = string | number | boolean | null | undefined;

export type DataGridColumn<Row> = {
  /** Stable column identity. */
  key: string;
  header: string;
  /** Cell content; defaults to the formatted value. */
  render?: (row: Row) => ReactNode;
  /** Value to sort and filter by; a column without one does neither. */
  value?: (row: Row) => DataGridValue;
  /** Text for a value in the cell and in the filter list. */
  format?: (value: string | number | boolean) => string;
  align?: "start" | "end";
  /** Initial width in pixels. */
  width?: number;
  minWidth?: number;
  sortable?: boolean;
  filterable?: boolean;
  resizable?: boolean;
};

const messages = {
  "pt-BR": {
    sortAscending: "Ordem Crescente",
    sortDescending: "Ordem Decrescente",
    filter: "Filtrar",
    columnOptions: (header: string) => `Opções da coluna ${header}`,
    filterTitle: (header: string) => `Filtrar ${header}`,
    filterValues: (header: string) => `Valores de ${header}`,
    resize: (header: string) => `Largura da coluna ${header}`,
    blank: "(Vazio)",
    apply: "Aplicar",
    cancel: "Cancelar",
    noMatches: "Nenhum registro corresponde aos filtros.",
    clearFilters: "Limpar filtros",
    records: (count: number, text: string) =>
      count === 1 ? `${text} registro` : `${text} registros`,
    filtered: (shown: string, total: string) =>
      `${shown} de ${total} registros`,
    selected: (count: number, text: string) =>
      count === 1 ? `${text} selecionado` : `${text} selecionados`,
    export: "Exportar",
    exportFailed: "Não foi possível exportar. Tente novamente.",
    exported: (date: string, records: string) =>
      `Gerado em ${date} · ${records}`,
    page: (page: number, pages: number) => `Página ${page} de ${pages}`,
  },
  "en-US": {
    sortAscending: "Sort Ascending",
    sortDescending: "Sort Descending",
    filter: "Filter",
    columnOptions: (header: string) => `${header} column options`,
    filterTitle: (header: string) => `Filter ${header}`,
    filterValues: (header: string) => `${header} values`,
    resize: (header: string) => `${header} column width`,
    blank: "(Blank)",
    apply: "Apply",
    cancel: "Cancel",
    noMatches: "No records match the filters.",
    clearFilters: "Clear filters",
    records: (count: number, text: string) =>
      count === 1 ? `${text} record` : `${text} records`,
    filtered: (shown: string, total: string) => `${shown} of ${total} records`,
    selected: (count: number, text: string) => `${text} selected`,
    export: "Export",
    exportFailed: "The export failed. Try again.",
    exported: (date: string, records: string) =>
      `Generated ${date} · ${records}`,
    page: (page: number, pages: number) => `Page ${page} of ${pages}`,
  },
} as const;

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  columnFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  columnFacetingFeature,
  facetedRowModel: createFacetedRowModel(),
  facetedUniqueValues: createFacetedUniqueValues(),
  columnSizingFeature,
  columnResizingFeature,
});

type Features = typeof features;

/** The table model a grid renders; DataSet keeps one across its modes. */
export type DataGridTable<Row extends RowData> = ReactTable<Features, Row>;

const rowHeight = 40;
const headerHeight = 40;
const keyboardResizeStep = 16;

/** Blank values share one filter option, listed last. */
const valueKey = (value: DataGridValue) =>
  value === undefined || value === null ? "" : String(value);

function compareValues(
  a: DataGridValue,
  b: DataGridValue,
  collator: Intl.Collator,
) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean")
    return Number(a) - Number(b);
  return collator.compare(String(a), String(b));
}

function formatValue<Row>(
  column: DataGridColumn<Row>,
  value: DataGridValue,
): string {
  if (value === undefined || value === null) return "";
  return column.format?.(value) ?? String(value);
}

function cellContent<Row>(column: DataGridColumn<Row>, row: Row): ReactNode {
  return column.render
    ? column.render(row)
    : formatValue(column, column.value?.(row));
}

/**
 * Sorting, filtering and column sizing for a grid. Rows and columns should
 * keep their identity between renders (query data, state or memoized
 * values) so the models are only recomputed when they change.
 */
export function useDataGridModel<Row extends RowData>({
  rows,
  columns,
  rowId,
  locale,
}: {
  rows: readonly Row[];
  columns: readonly DataGridColumn<Row>[];
  rowId: (row: Row) => string;
  locale: Locale;
}): DataGridTable<Row> {
  const definitions = useMemo(() => {
    const collator = new Intl.Collator(locale);
    const sortFn: SortFn<Features, Row> = (a, b, columnId) =>
      compareValues(
        a.getValue<DataGridValue>(columnId),
        b.getValue<DataGridValue>(columnId),
        collator,
      );
    // Keeps rows whose value is one of the chosen value keys.
    const filterFn: FilterFn<Features, Row> = Object.assign(
      (
        row: { getValue: (columnId: string) => DataGridValue },
        columnId: string,
        chosen: ReadonlySet<string>,
      ) => chosen.has(valueKey(row.getValue(columnId))),
      {
        resolveFilterValue: (value: readonly string[]) => new Set(value),
        autoRemove: (value: unknown) => value === undefined,
      },
    );
    return columns.map((column): ColumnDef<Features, Row> => ({
      id: column.key,
      header: column.header,
      // Blank values sort last and share the blank filter option.
      accessorFn: (row) => {
        const value = column.value?.(row);
        return value === null || value === "" ? undefined : value;
      },
      size: column.width ?? 200,
      minSize: column.minWidth ?? 80,
      maxSize: 1200,
      enableSorting: Boolean(column.value) && column.sortable !== false,
      enableColumnFilter: Boolean(column.value) && column.filterable !== false,
      enableResizing: column.resizable !== false,
      sortFn,
      sortDescFirst: false,
      sortUndefined: "last",
      filterFn,
    }));
  }, [columns, locale]);
  return useTable({
    features,
    columns: definitions,
    data: rows,
    getRowId: rowId,
    enableMultiSort: false,
    columnResizeMode: "onChange",
  });
}

function filterOptions<Row>(
  facets: Map<unknown, number>,
  column: DataGridColumn<Row>,
  locale: Locale,
): MultiSelectOption[] {
  const collator = new Intl.Collator(locale);
  return ([...facets.keys()] as DataGridValue[])
    .sort((a, b) =>
      a === undefined
        ? 1
        : b === undefined
          ? -1
          : compareValues(a, b, collator),
    )
    .map((value) => ({
      value: valueKey(value),
      label:
        value === undefined
          ? messages[locale].blank
          : formatValue(column, value),
    }));
}

function ColumnFilter({
  header,
  locale,
  options,
  current,
  onApply,
  onCancel,
}: {
  header: string;
  locale: Locale;
  options: readonly MultiSelectOption[];
  current: readonly string[] | undefined;
  onApply: (chosen: string[] | undefined) => void;
  onCancel: () => void;
}) {
  const t = messages[locale];
  const [draft, setDraft] = useState(
    () => new Set(current ?? options.map((option) => option.value)),
  );
  const [query, setQuery] = useState("");
  // As in spreadsheets, a search keeps only the chosen values it found.
  const found = useMemo(
    () => searchOptions(options, query, locale),
    [options, query, locale],
  );
  const kept = found.filter((option) => draft.has(option.value));
  return (
    <form
      className="ui-datagrid-filter-form"
      onSubmit={(event) => {
        event.preventDefault();
        // Keeping every value removes the filter.
        onApply(
          kept.length === options.length
            ? undefined
            : kept.map((option) => option.value),
        );
      }}
    >
      <p className="ui-datagrid-filter-title">{t.filterTitle(header)}</p>
      <MultiSelectList
        label={t.filterValues(header)}
        locale={locale}
        options={options}
        selected={draft}
        onChange={setDraft}
        query={query}
        onQueryChange={setQuery}
      />
      <div className="ui-datagrid-filter-actions">
        <Button onClick={onCancel}>{t.cancel}</Button>
        <Button type="submit" variant="primary" disabled={kept.length === 0}>
          {t.apply}
        </Button>
      </div>
    </form>
  );
}

const exportFormats: readonly { format: ExportFormat; label: string }[] = [
  { format: "xlsx", label: "Excel (.xlsx)" },
  { format: "csv", label: "CSV (.csv)" },
  { format: "pdf", label: "PDF (.pdf)" },
];

/** Numbers without a format stay numeric; everything else is its text. */
function exportCell<Row>(column: DataGridColumn<Row>, row: Row): ExportCell {
  const value = column.value?.(row);
  return typeof value === "number" && !column.format
    ? value
    : formatValue(column, value);
}

/**
 * Exports the rows the grid shows, in their order and with the columns'
 * current widths. Columns without a value are left out.
 */
export function ExportMenu<Row extends RowData>({
  table,
  columns,
  title,
  locale,
  className,
}: {
  table: DataGridTable<Row>;
  columns: readonly DataGridColumn<Row>[];
  title: string;
  locale: Locale;
  className?: string;
}) {
  const t = messages[locale];
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const run = async (format: ExportFormat) => {
    setPending(true);
    setFailed(false);
    try {
      const rows = table.getRowModel().rows;
      const headers = table.getHeaderGroups()[0]?.headers ?? [];
      const exported = columns
        .map((column, index) => ({ column, width: headers[index]?.getSize() }))
        .filter(({ column }) => column.value);
      const count = new Intl.NumberFormat(locale).format(rows.length);
      await exportTable(format, {
        title,
        locale,
        columns: exported.map(({ column, width }) => ({
          header: column.header,
          width: width ?? column.width ?? 200,
          align: column.align ?? "start",
        })),
        rows: rows.map((row) =>
          exported.map(({ column }) => exportCell(column, row.original)),
        ),
        description: t.exported(
          new Intl.DateTimeFormat(locale, {
            dateStyle: "short",
            timeStyle: "short",
          }).format(new Date()),
          t.records(rows.length, count),
        ),
        page: t.page,
      });
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  };
  return (
    <>
      <Menu
        label={t.export}
        className={className}
        disabled={table.getRowModel().rows.length === 0}
        aria-busy={pending || undefined}
        items={exportFormats.map(({ format, label }) => ({
          key: format,
          label,
          disabled: pending,
          onSelect: () => void run(format),
        }))}
      >
        <UiIcon name="download" />
      </Menu>
      {failed && (
        <span role="alert" className="ui-datagrid-export-failed">
          {t.exportFailed}
        </span>
      )}
    </>
  );
}

/** Clicks on links and buttons inside cells keep their own behavior. */
const fromControl = (event: MouseEvent) =>
  event.target instanceof Element &&
  event.target.closest("a, button, input, select, textarea, label") !== null;

export type DataGridSelection = {
  /** The current row: highlighted with single selection. */
  selectedId?: string;
  onSelect?: (id: string) => void;
  /** Allows choosing several rows with Ctrl/⌘ and Shift. */
  multiple?: boolean;
  selectedIds?: readonly string[];
  onSelectedIdsChange?: (ids: string[]) => void;
  /** Double-click or Enter on a row. */
  onRowActivate?: (id: string) => void;
};

/** Renders a grid model; see DataGrid for the behavior. */
export function DataGridView<Row extends RowData>({
  table,
  label,
  locale,
  columns,
  selectedId,
  onSelect,
  multiple = false,
  selectedIds = [],
  onSelectedIdsChange,
  onRowActivate,
  exportName,
}: DataGridSelection & {
  table: DataGridTable<Row>;
  label: string;
  locale: Locale;
  columns: readonly DataGridColumn<Row>[];
  /** Offers exports with this file name and title; omit to offer none. */
  exportName?: string;
}) {
  // The virtualizer keeps one instance whose output changes while scrolling.
  "use no memo";
  const t = messages[locale];
  const gridId = useId();
  const number = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const rows = table.getRowModel().rows;
  const total = table.getCoreRowModel().rows.length;
  const filtered = table.state.columnFilters.length > 0;
  const headers = table.getHeaderGroups()[0]?.headers ?? [];
  const indexById = useMemo(
    () => new Map(rows.map((row, index) => [row.id, index])),
    [rows],
  );
  const chosen = useMemo(() => new Set(selectedIds), [selectedIds]);
  const [focusId, setFocusId] = useState<string>();
  const focusIndex =
    indexById.get(focusId ?? "") ??
    indexById.get(selectedId ?? "") ??
    (rows.length > 0 ? 0 : -1);
  const anchor = useRef<string | undefined>(undefined);
  const pendingFocus = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerCells = useRef(new Map<string, HTMLElement>());
  const triggers = useRef(new Map<string, HTMLButtonElement>());
  const [filter, setFilter] = useState<{
    key: string;
    anchor: HTMLElement | null;
    trigger: HTMLElement | null;
  } | null>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    getItemKey: (index) => rows[index].id,
    overscan: 10,
    scrollMargin: headerHeight,
    scrollPaddingStart: headerHeight,
    // The focusable row stays rendered, so Tab always reaches the body.
    rangeExtractor: (range) => {
      const indexes = defaultRangeExtractor(range);
      return focusIndex < 0 || indexes.includes(focusIndex)
        ? indexes
        : [...indexes, focusIndex].sort((a, b) => a - b);
    },
  });
  // Reveal the current row when the grid appears, e.g. after form mode.
  useEffect(() => {
    const index = indexById.get(selectedId ?? "");
    if (index !== undefined) virtualizer.scrollToIndex(index);
  }, []);
  // Keyboard moves focus to a row once it is rendered, unless focus has
  // meanwhile gone elsewhere, such as into a filter.
  useEffect(() => {
    const index = pendingFocus.current;
    if (index === null) return;
    const active = document.activeElement;
    if (
      active &&
      active !== document.body &&
      !scrollRef.current?.contains(active)
    ) {
      pendingFocus.current = null;
      return;
    }
    const node = scrollRef.current?.querySelector<HTMLElement>(
      `tbody tr[data-index="${index}"]`,
    );
    if (!node) return;
    pendingFocus.current = null;
    node.focus({ preventScroll: true });
  });

  const choose = (index: number, extend: boolean, toggle: boolean) => {
    const id = rows[index].id;
    setFocusId(id);
    if (multiple && onSelectedIdsChange) {
      const from = indexById.get(anchor.current ?? "");
      if (extend && from !== undefined) {
        const [start, end] = from < index ? [from, index] : [index, from];
        onSelectedIdsChange(rows.slice(start, end + 1).map((row) => row.id));
      } else {
        anchor.current = id;
        onSelectedIdsChange(
          !toggle
            ? [id]
            : chosen.has(id)
              ? selectedIds.filter((selected) => selected !== id)
              : [...selectedIds, id],
        );
      }
    }
    onSelect?.(id);
  };
  const moveTo = (from: number, index: number, event: KeyboardEvent) => {
    const target = Math.max(0, Math.min(index, rows.length - 1));
    if (target !== from) pendingFocus.current = target;
    virtualizer.scrollToIndex(target);
    // Ctrl/⌘ moves the focus without changing a multiple selection.
    if (multiple && (event.ctrlKey || event.metaKey))
      setFocusId(rows[target].id);
    else choose(target, event.shiftKey, false);
  };
  const onRowKeyDown = (index: number, event: KeyboardEvent) => {
    if (event.target !== event.currentTarget) return;
    const page = Math.max(
      1,
      Math.floor(
        ((scrollRef.current?.clientHeight ?? 0) - headerHeight) / rowHeight,
      ) - 1,
    );
    const target = {
      ArrowDown: index + 1,
      ArrowUp: index - 1,
      PageDown: index + page,
      PageUp: index - page,
      Home: 0,
      End: rows.length - 1,
    }[event.key];
    if (target !== undefined) moveTo(index, target, event);
    else if (event.key === "Enter") onRowActivate?.(rows[index].id);
    else if (event.key === " ") choose(index, event.shiftKey, multiple);
    else if (
      multiple &&
      onSelectedIdsChange &&
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === "a"
    )
      onSelectedIdsChange(rows.map((row) => row.id));
    else return;
    event.preventDefault();
  };

  const filterColumn =
    filter && columns.find((column) => column.key === filter.key);
  const filterModel = filter ? table.getColumn(filter.key) : undefined;
  const facets = filterModel?.getFacetedUniqueValues();
  const options = useMemo(
    () =>
      facets && filterColumn ? filterOptions(facets, filterColumn, locale) : [],
    [facets, filterColumn, locale],
  );
  const closeFilter = () => setFilter(null);

  const style = {
    "--ui-datagrid-row-height": `${rowHeight}px`,
    "--ui-datagrid-header-height": `${headerHeight}px`,
    ...Object.fromEntries(
      headers.map((header, index) => [
        `--ui-datagrid-col-${index}`,
        `${header.getSize()}px`,
      ]),
    ),
  } as CSSProperties;
  return (
    <div className="ui-datagrid" style={style}>
      <div ref={scrollRef} className="ui-datagrid-scroll">
        <table
          role="grid"
          aria-label={label}
          aria-rowcount={rows.length + 1}
          aria-multiselectable={multiple || undefined}
          style={{ width: table.getTotalSize() }}
        >
          <thead role="rowgroup">
            <tr role="row" aria-rowindex={1}>
              {headers.map((header, index) => {
                const column = columns[index];
                const model = header.column;
                const sorted = model.getIsSorted();
                const canSort = model.getCanSort();
                const canFilter = model.getCanFilter();
                const isFiltered = model.getIsFiltered();
                const titleId = `${gridId}-title-${index}`;
                const title = (
                  <span id={titleId} className="ui-datagrid-title">
                    {column.header}
                  </span>
                );
                const items: MenuItem[] = [
                  ...(canSort
                    ? [
                        {
                          key: "asc",
                          label: t.sortAscending,
                          icon: "sortAscending" as const,
                          checked: sorted === "asc",
                          onSelect: () =>
                            sorted === "asc"
                              ? model.clearSorting()
                              : model.toggleSorting(false),
                        },
                        {
                          key: "desc",
                          label: t.sortDescending,
                          icon: "sortDescending" as const,
                          checked: sorted === "desc",
                          onSelect: () =>
                            sorted === "desc"
                              ? model.clearSorting()
                              : model.toggleSorting(true),
                        },
                      ]
                    : []),
                  ...(canFilter
                    ? [
                        {
                          key: "filter",
                          label: t.filter,
                          icon: "filter" as const,
                          onSelect: () =>
                            setFilter({
                              key: column.key,
                              anchor:
                                headerCells.current.get(column.key) ?? null,
                              trigger: triggers.current.get(column.key) ?? null,
                            }),
                        },
                      ]
                    : []),
                ];
                return (
                  <th
                    key={column.key}
                    ref={(node) => {
                      if (node) headerCells.current.set(column.key, node);
                      else headerCells.current.delete(column.key);
                    }}
                    role="columnheader"
                    scope="col"
                    aria-labelledby={titleId}
                    aria-sort={
                      sorted === "asc"
                        ? "ascending"
                        : sorted === "desc"
                          ? "descending"
                          : undefined
                    }
                    data-align={column.align ?? "start"}
                    style={{ width: `var(--ui-datagrid-col-${index})` }}
                  >
                    <div className="ui-datagrid-heading">
                      {canSort ? (
                        <button
                          type="button"
                          className="ui-datagrid-sort"
                          onClick={model.getToggleSortingHandler()}
                        >
                          {title}
                          {sorted && (
                            <UiIcon
                              name={
                                sorted === "asc"
                                  ? "sortAscending"
                                  : "sortDescending"
                              }
                            />
                          )}
                        </button>
                      ) : (
                        title
                      )}
                      {items.length > 0 && (
                        <Menu
                          ref={(node) => {
                            if (node) triggers.current.set(column.key, node);
                            else triggers.current.delete(column.key);
                          }}
                          label={t.columnOptions(column.header)}
                          items={items}
                          align="end"
                          className="ui-datagrid-options"
                          data-filtered={isFiltered || undefined}
                        >
                          <UiIcon name={isFiltered ? "filter" : "more"} />
                        </Menu>
                      )}
                    </div>
                    {model.getCanResize() && (
                      <div
                        role="separator"
                        aria-orientation="vertical"
                        aria-label={t.resize(column.header)}
                        aria-valuenow={header.getSize()}
                        aria-valuemin={model.columnDef.minSize}
                        aria-valuemax={model.columnDef.maxSize}
                        tabIndex={0}
                        className="ui-datagrid-resize"
                        data-resizing={model.getIsResizing() || undefined}
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                        onDoubleClick={() => model.resetSize()}
                        onKeyDown={(event) => {
                          const step = {
                            ArrowLeft: -keyboardResizeStep,
                            ArrowRight: keyboardResizeStep,
                          }[event.key];
                          if (step === undefined) return;
                          event.preventDefault();
                          const size = Math.max(
                            model.columnDef.minSize ?? 0,
                            Math.min(
                              header.getSize() + step,
                              model.columnDef.maxSize ?? Infinity,
                            ),
                          );
                          table.setColumnSizing((sizes) => ({
                            ...sizes,
                            [model.id]: size,
                          }));
                        }}
                      />
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody role="rowgroup" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index];
              const selected = multiple
                ? chosen.has(row.id)
                : row.id === selectedId;
              return (
                <tr
                  key={row.id}
                  role="row"
                  data-index={item.index}
                  aria-rowindex={item.index + 2}
                  aria-selected={selected}
                  tabIndex={item.index === focusIndex ? 0 : -1}
                  style={{
                    transform: `translateY(${item.start - headerHeight}px)`,
                  }}
                  onMouseDown={(event) => {
                    // Shift extends the selection instead of selecting text.
                    if (multiple && event.shiftKey) event.preventDefault();
                  }}
                  onClick={(event) => {
                    if (fromControl(event)) return;
                    choose(
                      item.index,
                      event.shiftKey,
                      event.ctrlKey || event.metaKey,
                    );
                  }}
                  onDoubleClick={(event) => {
                    if (!fromControl(event)) onRowActivate?.(row.id);
                  }}
                  onKeyDown={(event) => onRowKeyDown(item.index, event)}
                >
                  {columns.map((column, index) => (
                    <td
                      key={column.key}
                      role="gridcell"
                      data-align={column.align ?? "start"}
                      style={{ width: `var(--ui-datagrid-col-${index})` }}
                    >
                      {cellContent(column, row.original)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && filtered && (
          <div className="ui-datagrid-message">
            <p>{t.noMatches}</p>
            <Button onClick={() => table.resetColumnFilters()}>
              {t.clearFilters}
            </Button>
          </div>
        )}
      </div>
      <div className="ui-datagrid-footer">
        <p className="ui-datagrid-status" role="status">
          {filtered
            ? t.filtered(number.format(rows.length), number.format(total))
            : t.records(total, number.format(total))}
          {multiple &&
            selectedIds.length > 0 &&
            ` · ${t.selected(selectedIds.length, number.format(selectedIds.length))}`}
        </p>
        {exportName && (
          <ExportMenu
            table={table}
            columns={columns}
            title={exportName}
            locale={locale}
            className="ui-datagrid-export"
          />
        )}
      </div>
      <Popover
        anchor={filter?.anchor ?? null}
        returnFocus={filter?.trigger ?? null}
        open={Boolean(filterColumn)}
        onClose={closeFilter}
        label={filterColumn ? t.filterTitle(filterColumn.header) : t.filter}
        className="ui-datagrid-filter"
      >
        {filterColumn && filterModel && (
          <ColumnFilter
            header={filterColumn.header}
            locale={locale}
            options={options}
            current={filterModel.getFilterValue() as string[] | undefined}
            onApply={(value) => {
              filterModel.setFilterValue(value);
              closeFilter();
            }}
            onCancel={closeFilter}
          />
        )}
      </Popover>
    </div>
  );
}

export type DataGridProps<Row extends RowData> = DataGridSelection & {
  label: string;
  locale: Locale;
  rows: readonly Row[];
  columns: readonly DataGridColumn<Row>[];
  rowId: (row: Row) => string;
  /** Shown instead of the grid when there are no rows. */
  empty?: ReactNode;
  /** Offers Excel, CSV and PDF exports with this file name and title. */
  exportName?: string;
};

/**
 * A grid for many records: only the rows in view are rendered. Clicking a
 * header sorts by it, and each header's options sort or filter by the
 * column's values; edges resize columns. Selection stays caller-owned.
 */
export function DataGrid<Row extends RowData>({
  rows,
  columns,
  rowId,
  empty,
  ...props
}: DataGridProps<Row>) {
  const table = useDataGridModel({
    rows,
    columns,
    rowId,
    locale: props.locale,
  });
  if (rows.length === 0 && empty !== undefined)
    return <div className="ui-datagrid ui-datagrid-empty">{empty}</div>;
  return <DataGridView {...props} table={table} columns={columns} />;
}
