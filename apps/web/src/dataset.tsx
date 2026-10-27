import { useId, type ReactNode } from "react";
import type { Locale } from "./locale.js";
import "./dataset.css";

export type DataSetMode = "grid" | "form";

export type DataSetColumn<Row> = {
  /** Stable column identity. */
  key: string;
  header: string;
  render: (row: Row) => ReactNode;
  align?: "start" | "end";
};

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
    select: (name: string) => `Selecionar ${name}`,
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
    select: (name: string) => `Select ${name}`,
  },
} as const;

const icons = {
  grid: "M3 4h18v16H3zM3 9h18M3 14h18M9 9v11",
  form: "M5 3h14v18H5zM8 8h8M8 12h8M8 16h5",
  add: "M12 5v14M5 12h14",
  previous: "m15 6-6 6 6 6",
  next: "m9 6 6 6-6 6",
  delete: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  duplicate: "M8 8h12v12H8zM4 16V4h12",
  refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
} as const;

function ToolbarButton({
  icon,
  label,
  onClick,
  pending = false,
  primary = false,
}: {
  icon: keyof typeof icons;
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
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d={icons[icon]} />
      </svg>
      {primary && <span aria-hidden="true">{label}</span>}
    </button>
  );
}

/**
 * Presentation for record-oriented CRUD: a toolbar, a selectable grid and a
 * caller-rendered form. The caller owns records, selection, mode, API calls
 * and permissions; an omitted handler disables its action.
 */
export function DataSet<Row>({
  label,
  locale,
  mode,
  rows,
  columns,
  rowId,
  rowName,
  selectedId,
  onSelect,
  onModeChange,
  onAdd,
  onPrevious,
  onNext,
  onDelete,
  onDuplicate,
  onRefresh,
  refreshing = false,
  empty,
  children,
}: {
  label: string;
  locale: Locale;
  mode: DataSetMode;
  rows: readonly Row[];
  columns: readonly DataSetColumn<Row>[];
  rowId: (row: Row) => string;
  rowName: (row: Row) => string;
  selectedId?: string;
  onSelect?: (id: string) => void;
  onModeChange?: (mode: DataSetMode) => void;
  onAdd?: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  /** Omit when the records cannot be deleted; null shows it disabled. */
  onDelete?: (() => void) | null;
  onDuplicate?: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Shown in grid mode when there are no rows. */
  empty?: ReactNode;
  /** The form for the current record, rendered in form mode. */
  children?: ReactNode;
}) {
  const t = messages[locale];
  const radioGroup = useId();
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
            onClick={onPrevious}
          />
          <ToolbarButton icon="next" label={t.next} onClick={onNext} />
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
      </div>
      {mode === "form" ? (
        <div className="ui-dataset-form">{children}</div>
      ) : rows.length === 0 ? (
        <div className="ui-dataset-empty">{empty}</div>
      ) : (
        <div className="ui-dataset-grid">
          <table>
            <thead>
              <tr>
                <td />
                {columns.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    data-align={column.align ?? "start"}
                  >
                    {column.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const id = rowId(row);
                const selected = id === selectedId;
                return (
                  <tr
                    key={id}
                    aria-selected={selected}
                    onClick={(event) => {
                      if (
                        event.target instanceof Element &&
                        event.target.closest("a, button")
                      )
                        return;
                      onSelect?.(id);
                    }}
                    onDoubleClick={(event) => {
                      if (
                        event.target instanceof Element &&
                        event.target.closest("a, button")
                      )
                        return;
                      onSelect?.(id);
                      onModeChange?.("form");
                    }}
                  >
                    <td className="ui-dataset-select">
                      <input
                        type="radio"
                        name={radioGroup}
                        aria-label={t.select(rowName(row))}
                        checked={selected}
                        disabled={!onSelect}
                        onChange={() => onSelect?.(id)}
                      />
                    </td>
                    {columns.map((column) => (
                      <td key={column.key} data-align={column.align ?? "start"}>
                        {column.render(row)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
