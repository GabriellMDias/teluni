import {
  useId,
  useLayoutEffect,
  useRef,
  type ComponentPropsWithRef,
  type ReactNode,
} from "react";
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

/** Native checkbox with a persistent label and an optional mixed state. */
export function Checkbox({
  label,
  indeterminate = false,
  className = "",
  ref,
  onChange,
  ...props
}: Omit<ComponentPropsWithRef<"input">, "type"> & {
  label: ReactNode;
  /** Shows the mixed state, for example when only some options are chosen. */
  indeterminate?: boolean;
}) {
  const input = useRef<HTMLInputElement | null>(null);
  // The browser clears the mixed state on activation; restore the caller's.
  useLayoutEffect(() => {
    if (input.current) input.current.indeterminate = indeterminate;
  });
  return (
    <label className={`ui-checkbox ${className}`.trim()}>
      <input
        {...props}
        ref={(node) => {
          input.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node;
        }}
        type="checkbox"
        className="ui-checkbox-input"
        onChange={(event) => {
          const input = event.currentTarget;
          onChange?.(event);
          input.indeterminate = indeterminate;
        }}
      />
      <span className="ui-checkbox-box" aria-hidden="true" />
      <span className="ui-checkbox-label">{label}</span>
    </label>
  );
}
