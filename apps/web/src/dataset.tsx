import type { ReactNode } from "react";
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
