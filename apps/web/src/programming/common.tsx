import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ApiFailure } from "../api-client.js";
import { loginHref, sessionQuery } from "../identity/api.js";
import { browserLocale } from "../locale.js";
import {
  companyKey,
  describe,
  getCompany,
  listBranchChoices,
  type CompanyWithAccess,
} from "../organizations/api.js";
import { programmingMessages } from "./messages.js";

// Building blocks every programming page shares: localized copy, the
// session and company gate, failures and confirmed deletion.

export function useProgrammingMessages() {
  const locale = useMemo(browserLocale, []);
  return { locale, t: programmingMessages[locale] };
}

export type Messages = ReturnType<typeof useProgrammingMessages>["t"];

export function Failure({
  error,
  operation,
  onReload,
}: {
  error: unknown;
  operation: "read" | "write";
  onReload?: () => void;
}) {
  const { t } = useProgrammingMessages();
  return (
    <div role="alert" className="notice notice-error">
      {describe(error, t, operation)}
      {onReload && (
        <button type="button" onClick={onReload}>
          {t.reload}
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

export const can = (company: CompanyWithAccess, capability: string) =>
  company.access.capabilities.some((granted) => granted === capability);

/**
 * Loads the session and the company access every programming page needs,
 * and renders sign-in and denial states before the page itself.
 */
export function CompanyGate({
  companyId,
  returnTo,
  children,
}: {
  companyId: string;
  returnTo: string;
  children: (company: CompanyWithAccess) => React.ReactNode;
}) {
  const { locale, t } = useProgrammingMessages();
  const session = useQuery(sessionQuery);
  const company = useQuery({
    queryKey: companyKey(companyId),
    queryFn: () => getCompany(companyId),
    enabled: Boolean(session.data),
  });
  let body: React.ReactNode;
  if (session.isPending || (session.data && company.isPending))
    body = <p>{t.loading}</p>;
  else if (session.isError)
    body = (
      <Failure
        error={session.error}
        operation="read"
        onReload={() => void session.refetch()}
      />
    );
  else if (!session.data)
    body = (
      <a className="button-link button-primary" href={loginHref(returnTo)}>
        {t.errors.AUTHENTICATION_REQUIRED}
      </a>
    );
  else if (company.isError)
    body = (
      <Failure
        error={company.error}
        operation="read"
        onReload={() => void company.refetch()}
      />
    );
  else if (company.data && !can(company.data, "programming.view"))
    body = (
      <p role="alert" className="notice notice-error">
        {t.errors.PERMISSION_DENIED}
      </p>
    );
  else if (company.data) body = children(company.data);
  return (
    <section
      className="panel organization-panel programming-panel"
      aria-labelledby="programming-title"
      lang={locale}
    >
      <p className="eyebrow">
        <Link to="/companies/$companyId" params={{ companyId }}>
          {company.data?.company.displayName ?? t.backToCompany}
        </Link>
      </p>
      {body}
    </section>
  );
}

export function useBranchChoices(companyId: string) {
  return useQuery({
    queryKey: ["programming", "branches", companyId],
    queryFn: () => listBranchChoices(companyId),
  });
}

export const scopeName = (branch: { name: string } | null, t: Messages) =>
  branch ? branch.name : t.companyScope;

export function BackLink({
  companyId,
  view,
}: {
  companyId: string;
  view?: "groups" | "layouts";
}) {
  const { t } = useProgrammingMessages();
  return (
    <p className="hint">
      <Link
        to="/companies/$companyId/programming"
        params={{ companyId }}
        search={view ? { view } : {}}
      >
        {t.backToProgramming}
      </Link>
    </p>
  );
}

export function ConfirmedDelete({
  title,
  lead,
  confirm,
  label,
  run,
  onDone,
}: {
  title: string;
  lead: string;
  confirm: string;
  label: string;
  run: () => Promise<void>;
  onDone: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const remove = useMutation({ mutationFn: run, onSuccess: onDone });
  return (
    <form
      className="form-stack programming-danger"
      aria-label={title}
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        remove.mutate();
      }}
    >
      <h2>{title}</h2>
      <p>{lead}</p>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        {confirm}
      </label>
      {remove.error && <Failure error={remove.error} operation="write" />}
      <button
        type="submit"
        className="button-danger"
        disabled={!confirmed || remove.isPending || mustReload(remove.error)}
      >
        {label}
      </button>
    </form>
  );
}
