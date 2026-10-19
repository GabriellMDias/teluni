import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Locale } from "../locale.js";
import {
  acceptResponsibilityTransfer,
  closeResponsibilityTransfer,
  invalidateCompany,
  type ResponsibilityTransfer,
} from "./api.js";
import { formatInstant, WriteFailure } from "./members.js";
import type { OrganizationMessages } from "./messages.js";

/**
 * The caller's pending responsibility transfer: the successor accepts or
 * declines it, and the proposer can cancel it. Only the two parties see it.
 */
export function ResponsibilityTransferNotice({
  companyId,
  transfer,
  returnTo,
  locale,
  t,
}: {
  companyId: string;
  transfer: ResponsibilityTransfer;
  returnTo: string;
  locale: Locale;
  t: OrganizationMessages;
}) {
  const client = useQueryClient();
  const refresh = () => invalidateCompany(client, companyId);
  const accept = useMutation({
    mutationFn: () => acceptResponsibilityTransfer(companyId, transfer.id),
    onSuccess: refresh,
  });
  const close = useMutation({
    mutationFn: () => closeResponsibilityTransfer(companyId, transfer.id),
    onSuccess: refresh,
  });
  const incoming = transfer.direction === "incoming";
  const name =
    transfer.counterpartName ?? transfer.counterpartEmail ?? t.memberUnknown;
  const until = formatInstant(locale, transfer.expiresAt);
  const busy = accept.isPending || close.isPending;
  const error = accept.error ?? close.error;
  return (
    <div role="status" className="notice notice-info">
      <p>
        {incoming
          ? t.transferIncoming(name, until)
          : t.transferOutgoing(name, until)}
      </p>
      <div className="action-group">
        {incoming && (
          <button
            type="button"
            className="button-primary"
            disabled={busy}
            onClick={() => {
              close.reset();
              accept.mutate();
            }}
          >
            {t.transferAccept}
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            accept.reset();
            close.mutate();
          }}
        >
          {incoming ? t.transferDecline : t.transferCancel}
        </button>
      </div>
      {error && (
        <WriteFailure
          error={error}
          returnTo={returnTo}
          t={t}
          busy={busy}
          onReload={() => {
            accept.reset();
            close.reset();
            void refresh();
          }}
        />
      )}
    </div>
  );
}
