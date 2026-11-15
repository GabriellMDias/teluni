import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { RowData } from "@tanstack/react-table";
import {
  DataGridView,
  ExportMenu,
  useDataGridModel,
  type DataGridColumn,
  type DataGridSelection,
} from "./data-grid.js";
import type { Locale } from "./locale.js";
import { UiIcon, type UiIconName } from "./ui-icon.js";
import "./dataset.css";

export type DataSetMode = "grid" | "form";

export type DataSetColumn<Row> = DataGridColumn<Row>;

const messages = {
  "pt-BR": {
    toolbar: "Ações do registro",
    showForm: "Modo formulário",
    showGrid: "Modo grade",
    add: "Adicionar",
    previous: "Registro anterior",
    next: "Próximo registro",
    delete: "Excluir",
    duplicate: "Duplicar",
    refresh: "Atualizar",
    filter: "Filtrar",
    filters: "Filtros",
    close: "Fechar",
    activeFilters: (count: number) =>
      count === 1 ? "1 filtro ativo" : `${count} filtros ativos`,
  },
  "en-US": {
    toolbar: "Record actions",
    showForm: "Form mode",
    showGrid: "Grid mode",
    add: "Add",
    previous: "Previous record",
    next: "Next record",
    delete: "Delete",
    duplicate: "Duplicate",
    refresh: "Refresh",
    filter: "Filter",
    filters: "Filters",
    close: "Close",
    activeFilters: (count: number) =>
      count === 1 ? "1 active filter" : `${count} active filters`,
  },
} as const;

function ToolbarButton({
  icon,
  label,
  onClick,
  pending = false,
  primary = false,
}: {
  icon: UiIconName;
  label: string;
  onClick?: () => void;
  pending?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      className={`ui-dataset-action${primary ? " ui-dataset-action-primary" : ""}`}
      aria-label={label}
      title={label}
      disabled={!onClick || pending}
      aria-busy={pending || undefined}
      onClick={onClick}
    >
      <UiIcon name={icon} />
      {primary && <span aria-hidden="true">{label}</span>}
    </button>
  );
}

/** Filters a caller applies to the records it loads, edited in a modal. */
export type DataSetFilters = {
  /** How many filters are in effect; the Filter action shows the count. */
  active: number;
  /** The modal's fields and actions; call close after applying or clearing. */
  render: (close: () => void) => ReactNode;
};

/**
 * The Filter action and its modal dialog. The native dialog keeps focus
 * inside, closes with Escape or a click outside its box and returns focus
 * to the action.
 */
function FilterAction({
  filters,
  t,
}: {
  filters: DataSetFilters;
  t: (typeof messages)[Locale];
}) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) {
      node.showModal();
      // Like Popover, a field marked data-autofocus receives focus first.
      node.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    }
    if (!open && node.open) node.close();
  }, [open]);
  const close = () => setOpen(false);
  const label =
    filters.active > 0
      ? `${t.filter} (${t.activeFilters(filters.active)})`
      : t.filter;
  return (
    <>
      <button
        type="button"
        className="ui-dataset-action ui-dataset-action-filter"
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        data-active={filters.active > 0 || undefined}
        onClick={() => setOpen(true)}
      >
        <UiIcon name="filter" />
        {filters.active > 0 && (
          <span className="ui-dataset-count" aria-hidden="true">
            {filters.active}
          </span>
        )}
      </button>
      <dialog
        ref={dialog}
        className="ui-dataset-dialog"
        aria-labelledby={titleId}
        onClose={close}
        onClick={(event) => {
          // A click on the backdrop lands on the dialog element itself.
          if (event.target === event.currentTarget) close();
        }}
      >
        <div className="ui-dataset-dialog-header">
          <h2 id={titleId}>{t.filters}</h2>
          <button
            type="button"
            className="ui-dataset-dialog-close"
            aria-label={t.close}
            title={t.close}
            onClick={close}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="ui-icon">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div className="ui-dataset-dialog-body">
          {open && filters.render(close)}
        </div>
      </dialog>
    </>
  );
}

/**
 * Presentation for record-oriented CRUD: a toolbar, a DataGrid and a
 * caller-rendered form. The caller owns records, selection, mode, API calls
 * and permissions; an omitted handler disables its action. Sorting, filters
 * and column widths persist while the dataset switches modes, and previous
 * and next follow the order the grid shows.
 */
export function DataSet<Row extends RowData>({
  label,
  locale,
  mode,
  rows,
  columns,
  rowId,
  selectedId,
  onSelect,
  multiple,
  selectedIds,
  onSelectedIdsChange,
  onModeChange,
  onAdd,
  onDelete,
  onDuplicate,
  onRefresh,
  refreshing = false,
  exportName,
  filters,
  empty,
  children,
}: Omit<DataGridSelection, "onRowActivate"> & {
  label: string;
  locale: Locale;
  mode: DataSetMode;
  rows: readonly Row[];
  columns: readonly DataSetColumn<Row>[];
  rowId: (row: Row) => string;
  onModeChange?: (mode: DataSetMode) => void;
  onAdd?: () => void;
  /** Omit when the records cannot be deleted; null shows it disabled. */
  onDelete?: (() => void) | null;
  onDuplicate?: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  /**
   * Offers Excel, CSV and PDF exports of the rows the grid shows, with this
   * file name and title; omit where records must not leave the screen.
   */
  exportName?: string;
  /**
   * Offers a Filter action, right of Refresh, that opens these filters in a
   * modal; omit where the records have no filters.
   */
  filters?: DataSetFilters;
  /** Shown in grid mode when there are no rows. */
  empty?: ReactNode;
  /** The form for the current record, rendered in form mode. */
  children?: ReactNode;
}) {
  const t = messages[locale];
  const table = useDataGridModel({ rows, columns, rowId, locale });
  const shown = table.getRowModel().rows;
  const position = shown.findIndex((row) => row.id === selectedId);
  const toggle = mode === "grid" ? "form" : "grid";
  return (
    <section className="ui-dataset" aria-label={label} data-mode={mode}>
      <div role="toolbar" aria-label={t.toolbar} className="ui-dataset-toolbar">
        <div className="ui-dataset-group">
          <ToolbarButton
            icon={toggle}
            label={toggle === "form" ? t.showForm : t.showGrid}
            onClick={onModeChange && (() => onModeChange(toggle))}
          />
          <ToolbarButton icon="add" label={t.add} onClick={onAdd} primary />
        </div>
        <div className="ui-dataset-group">
          <ToolbarButton
            icon="previous"
            label={t.previous}
            onClick={
              onSelect && position > 0
                ? () => onSelect(shown[position - 1].id)
                : undefined
            }
          />
          <ToolbarButton
            icon="next"
            label={t.next}
            onClick={
              onSelect && position >= 0 && position < shown.length - 1
                ? () => onSelect(shown[position + 1].id)
                : undefined
            }
          />
        </div>
        <div className="ui-dataset-group">
          {onDelete !== undefined && (
            <ToolbarButton
              icon="delete"
              label={t.delete}
              onClick={onDelete ?? undefined}
            />
          )}
          <ToolbarButton
            icon="duplicate"
            label={t.duplicate}
            onClick={onDuplicate}
          />
        </div>
        <div className="ui-dataset-group">
          <ToolbarButton
            icon="refresh"
            label={t.refresh}
            onClick={onRefresh}
            pending={refreshing}
          />
        </div>
        {filters && (
          <div className="ui-dataset-group">
            <FilterAction filters={filters} t={t} />
          </div>
        )}
        {exportName && (
          <div className="ui-dataset-group">
            <ExportMenu
              table={table}
              columns={columns}
              title={exportName}
              locale={locale}
              className="ui-dataset-action"
            />
          </div>
        )}
      </div>
      {mode === "form" ? (
        <div className="ui-dataset-form">{children}</div>
      ) : rows.length === 0 ? (
        <div className="ui-dataset-empty">{empty}</div>
      ) : (
        <DataGridView
          table={table}
          label={label}
          locale={locale}
          columns={columns}
          selectedId={selectedId}
          onSelect={onSelect}
          multiple={multiple}
          selectedIds={selectedIds}
          onSelectedIdsChange={onSelectedIdsChange}
          onRowActivate={(id) => {
            onSelect?.(id);
            onModeChange?.("form");
          }}
        />
      )}
    </section>
  );
}
