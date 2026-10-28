import { failureMessage, type FailureOperation } from "./api-client.js";
import { Button } from "./controls.js";

export { Button, Checkbox, TextField } from "./controls.js";

export function ErrorNotice({
  error,
  onReload,
  operation = "read",
  messages,
  reloadLabel = "Reload",
}: {
  error: unknown;
  onReload?: () => void;
  operation?: FailureOperation;
  messages?: Readonly<Record<string, string>>;
  reloadLabel?: string;
}) {
  return (
    <div role="alert" className="notice notice-error ui-notice">
      <strong>{failureMessage(error, operation, messages)}</strong>
      {onReload && <Button onClick={onReload}>{reloadLabel}</Button>}
    </div>
  );
}
export { Menu, Popover } from "./popover.js";
export { MultiSelectList } from "./multi-select-list.js";
export { DataGrid } from "./data-grid.js";
export { DataSet } from "./dataset.js";
