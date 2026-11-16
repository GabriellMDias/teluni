import { useMemo } from "react";
import { ApiFailure } from "../api-client.js";
import { describe } from "../organizations/api.js";
import { browserLocale } from "../locale.js";
import { mediaMessages } from "./messages.js";

export function useMediaMessages() {
  const locale = useMemo(browserLocale, []);
  return { locale, t: mediaMessages[locale] };
}

export type Messages = ReturnType<typeof useMediaMessages>["t"];

/**
 * Like the shared description, except that a full media volume is a known
 * refusal: nothing was written, so it is explained rather than reported as
 * an unknown outcome.
 */
export function explain(
  error: unknown,
  t: Messages,
  operation: "read" | "write",
) {
  if (error instanceof ApiFailure && error.code === "MEDIA_STORAGE_FULL")
    return t.errors.MEDIA_STORAGE_FULL;
  return describe(error, t, operation);
}

export function Failure({
  error,
  operation,
  onReload,
  reloadLabel,
}: {
  error: unknown;
  operation: "read" | "write";
  onReload?: () => void;
  reloadLabel?: string;
}) {
  const { t } = useMediaMessages();
  return (
    <div role="alert" className="notice notice-error">
      {explain(error, t, operation)}
      {onReload && (
        <button type="button" onClick={onReload}>
          {reloadLabel ?? t.reload}
        </button>
      )}
    </div>
  );
}

/** A write whose outcome is unknown or stale needs a reload, not a retry. */
export function mustReload(error: unknown): boolean {
  return (
    Boolean(error) &&
    (!(error instanceof ApiFailure) ||
      error.status >= 500 ||
      error.code === "RESOURCE_VERSION_CONFLICT")
  );
}
