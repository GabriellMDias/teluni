import { failureMessage, type FailureOperation } from "./api-client.js";
import { useId, type ComponentPropsWithRef, type ReactNode } from "react";
import "./ui.css";

/** Native button semantics with a safe default type and a bounded pending state. */
export function Button({
  children,
  type = "button",
  variant = "secondary",
  pending = false,
  disabled,
  className = "",
  ...props
}: ComponentPropsWithRef<"button"> & {
  children: ReactNode;
  variant?: "primary" | "secondary";
  pending?: boolean;
}) {
  return (
    <button
      {...props}
      type={type}
      className={`ui-button ui-button-${variant} ${className}`.trim()}
      disabled={disabled || pending}
      aria-busy={pending || props["aria-busy"]}
    >
      {children}
    </button>
  );
}

/** Label, hint and validation relationships; value and validation stay caller-owned. */
export function TextField({
  label,
  hint,
  error,
  id,
  className = "",
  "aria-describedby": describedBy,
  ...props
}: Omit<ComponentPropsWithRef<"input">, "type"> & {
  label: string;
  type?:
    | "text"
    | "email"
    | "password"
    | "search"
    | "tel"
    | "url"
    | "number"
    | "date"
    | "time"
    | "datetime-local"
    | "month"
    | "week";
  hint?: string;
  error?: string;
}) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const descriptions =
    [describedBy, hint && `${inputId}-hint`, error && `${inputId}-error`]
      .filter(Boolean)
      .join(" ") || undefined;
  return (
    <div className="ui-field">
      <label htmlFor={inputId}>{label}</label>
      <input
        {...props}
        id={inputId}
        className={`ui-field-control ${className}`.trim()}
        aria-describedby={descriptions}
        aria-invalid={error ? true : props["aria-invalid"]}
      />
      {hint && (
        <p id={`${inputId}-hint`} className="ui-field-hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${inputId}-error`} className="ui-field-error">
          {error}
        </p>
      )}
    </div>
  );
}

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
