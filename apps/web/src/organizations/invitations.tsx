import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Link,
  useLocation,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { ApiFailure } from "../api-client.js";
import { Button, DataSet, TextField } from "../components.js";
import type { DataSetColumn } from "../dataset.js";
import { NavigationIcon } from "../navigation-icon.js";
import { UiIcon } from "../ui-icon.js";
import { loginHref, sessionQuery, signUpHref } from "../identity/api.js";
import type { Locale } from "../locale.js";
import {
  acceptInvitation,
  companiesKey,
  createInvitation,
  describe,
  invalidateCompany,
  invitationsKey,
  listInvitations,
  previewInvitation,
  resendInvitation,
  revokeInvitation,
  type Invitation,
  type InvitationPreview,
} from "./api.js";
import {
  administratorRoles,
  draftComplete,
  draftExpiry,
  emptyGrantDraft,
  formatInstant,
  grantRequestOf,
  GrantRequestFields,
  WriteFailure,
  type GrantDraft,
} from "./members.js";
import type { OrganizationMessages } from "./messages.js";

function scopeText(
  t: OrganizationMessages,
  item: Pick<Invitation, "scope" | "branches">,
): string {
  return item.scope === "COMPANY"
    ? t.grantCompanyWide
    : `${t.grantBranches}: ${item.branches.map((branch) => branch.name).join(", ")}`;
}

function uncertainWrite(error: unknown): boolean {
  return Boolean(
    error && (!(error instanceof ApiFailure) || error.status >= 500),
  );
}

function InviteForm({
  companyId,
  administrator,
  viewerResponsible,
  returnTo,
  t,
  onSaved,
  onCancel,
  onReload,
}: {
  companyId: string;
  administrator: boolean;
  viewerResponsible: boolean;
  returnTo: string;
  t: OrganizationMessages;
  onSaved: (invitation: Invitation) => void;
  onCancel: () => void;
  onReload: () => Promise<boolean>;
}) {
  const client = useQueryClient();
  const [email, setEmail] = useState("");
  const [draft, setDraft] = useState<GrantDraft>(
    administrator ? emptyGrantDraft : { ...emptyGrantDraft, scope: "BRANCHES" },
  );
  const [reloading, setReloading] = useState(false);
  const invite = useMutation({
    mutationFn: () => {
      const grantExpiresAt = draftExpiry(draft);
      return createInvitation(companyId, {
        email: email.trim(),
        ...grantRequestOf(draft),
        ...(grantExpiresAt ? { grantExpiresAt } : {}),
      });
    },
    onSuccess: async (invitation) => {
      await invalidateCompany(client, companyId);
      onSaved(invitation);
    },
  });
  const mustReload = uncertainWrite(invite.error);
  const frozen = invite.isPending || mustReload || reloading;
  function submit(event: FormEvent) {
    event.preventDefault();
    if (frozen || !email.trim() || !draftComplete(draft)) return;
    invite.mutate();
  }
  return (
    <form
      className="form-stack grant-form invitation-create-form"
      aria-labelledby="invite-title"
      onSubmit={submit}
    >
      <h3 id="invite-title">{t.inviteTitle}</h3>
      <div className="invitation-form-grid">
        <section className="invitation-card">
          <h4>
            <NavigationIcon name="invitations" />
            {t.invitationWorkspace.recipient}
          </h4>
          <TextField
            label={t.inviteEmail}
            type="email"
            required
            maxLength={254}
            autoComplete="off"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={frozen}
            hint={t.invitationWorkspace.emailHint}
          />
          <p className="hint">{t.invitationWorkspace.linkHint}</p>
        </section>
        <section className="invitation-card">
          <h4>
            <NavigationIcon name="profiles" />
            {t.invitationWorkspace.access}
          </h4>
          <fieldset
            className="invitation-grant-fields"
            aria-label={t.invitationWorkspace.access}
            disabled={frozen}
          >
            <GrantRequestFields
              companyId={companyId}
              idPrefix="invite"
              roles={
                administrator
                  ? administratorRoles(viewerResponsible)
                  : ["OPERATOR"]
              }
              companyScope={administrator}
              hints={
                administrator
                  ? viewerResponsible
                    ? []
                    : [t.grantResponsibleOnly]
                  : [t.inviteManagerHint]
              }
              draft={draft}
              onChange={setDraft}
              t={t}
            />
          </fieldset>
          <p className="hint">{t.invitationWorkspace.accessHint}</p>
        </section>
      </div>
      {invite.error && (
        <WriteFailure
          error={invite.error}
          returnTo={returnTo}
          t={t}
          busy={invite.isPending || reloading}
          onReload={
            mustReload
              ? () => {
                  setReloading(true);
                  void onReload()
                    .then((success) => {
                      if (success) onCancel();
                    })
                    .finally(() => setReloading(false));
                }
              : undefined
          }
        />
      )}
      {mustReload && (
        <p className="hint">{t.invitationWorkspace.reviewRequired}</p>
      )}
      <div className="action-group invitation-form-actions">
        <Button
          type="submit"
          variant="primary"
          pending={invite.isPending}
          disabled={frozen || !email.trim() || !draftComplete(draft)}
        >
          {invite.isPending ? t.saving : t.inviteSubmit}
        </Button>
        <Button disabled={invite.isPending || reloading} onClick={onCancel}>
          {t.cancel}
        </Button>
      </div>
    </form>
  );
}

function InvitationStatus({
  invitation,
  t,
}: {
  invitation: Invitation;
  t: OrganizationMessages;
}) {
  return (
    <span className="invitation-status" data-state={invitation.status}>
      {t.invitationStatuses[invitation.status]}
    </span>
  );
}

function InvitationDetail({
  companyId,
  invitation,
  returnTo,
  locale,
  t,
  blocked,
  readError,
  onResent,
  onReload,
}: {
  companyId: string;
  invitation: Invitation;
  returnTo: string;
  locale: Locale;
  t: OrganizationMessages;
  blocked: boolean;
  readError?: unknown;
  onResent: (invitation: Invitation) => void;
  onReload: () => Promise<boolean>;
}) {
  const client = useQueryClient();
  const [action, setAction] = useState<"resend" | "revoke">();
  const [reloading, setReloading] = useState(false);
  const refresh = () => invalidateCompany(client, companyId);
  const resend = useMutation({
    mutationFn: () => resendInvitation(companyId, invitation.id),
    onSuccess: async (next) => {
      await refresh();
      onResent(next);
    },
  });
  // The API keeps revocation idempotent; refreshing also reconciles lost responses.
  const revoke = useMutation({
    mutationFn: () => revokeInvitation(companyId, invitation.id),
    onSuccess: async () => {
      setAction(undefined);
      await refresh();
    },
  });
  const error = resend.error ?? revoke.error;
  const busy = resend.isPending || revoke.isPending || reloading;
  const mustReload = uncertainWrite(error);
  const reconcile = () => {
    setReloading(true);
    void onReload()
      .then((success) => {
        if (success) {
          resend.reset();
          revoke.reset();
          setAction(undefined);
        }
      })
      .finally(() => setReloading(false));
  };
  const label = invitation.recipientEmail ?? t.invitationAddressErased;
  const copy = t.invitationWorkspace;
  const pending = invitation.status === "PENDING";
  return (
    <article
      className="invitation-detail"
      aria-labelledby="invitation-recipient-title"
    >
      {Boolean(readError) && !error && (
        <div role="alert" className="notice notice-error">
          {describe(readError, t, "read")}
          <Button pending={reloading} onClick={reconcile}>
            {t.reload}
          </Button>
        </div>
      )}
      <header className="invitation-detail-heading">
        <div>
          <p className="eyebrow">{copy.detail}</p>
          <h3 id="invitation-recipient-title">{label}</h3>
        </div>
        <InvitationStatus invitation={invitation} t={t} />
      </header>
      <div className="invitation-detail-grid">
        <section
          className="invitation-card"
          aria-labelledby="invitation-access-title"
        >
          <h4 id="invitation-access-title">
            <NavigationIcon name="profiles" />
            {copy.access}
          </h4>
          <dl>
            <dt>{t.grantRole}</dt>
            <dd>{t.roles[invitation.role]}</dd>
            <dt>{t.grantScope}</dt>
            <dd>{scopeText(t, invitation)}</dd>
            <dt>{copy.accessExpiry}</dt>
            <dd>
              {invitation.grantExpiresAt
                ? formatInstant(locale, invitation.grantExpiresAt)
                : copy.noExpiry}
            </dd>
          </dl>
          <p className="hint">{copy.accessHint}</p>
        </section>
        <section
          className="invitation-card"
          aria-labelledby="invitation-delivery-title"
        >
          <h4 id="invitation-delivery-title">
            <NavigationIcon name="invitations" />
            {copy.delivery}
          </h4>
          <p
            className="invitation-delivery"
            data-state={invitation.delivery ?? "UNKNOWN"}
          >
            {invitation.delivery
              ? t.deliveryStates[invitation.delivery]
              : copy.noDelivery}
          </p>
          <dl>
            <dt>{copy.linkExpiry}</dt>
            <dd>{formatInstant(locale, invitation.expiresAt)}</dd>
            <dt>{copy.created}</dt>
            <dd>{formatInstant(locale, invitation.createdAt)}</dd>
            <dt>{copy.sender}</dt>
            <dd>{invitation.invitedByName ?? t.memberUnknown}</dd>
          </dl>
          <p className="hint">{copy.linkHint}</p>
        </section>
      </div>
      {pending ? (
        <section
          className="invitation-actions"
          aria-labelledby="invitation-actions-title"
        >
          <h4 id="invitation-actions-title">{copy.actions}</h4>
          <p className="hint">{copy.resendHint}</p>
          {action ? (
            <form
              className="invitation-confirmation"
              aria-label={
                action === "resend"
                  ? `${t.invitationResend}: ${label}`
                  : `${t.invitationRevoke}: ${label}`
              }
              onSubmit={(event) => {
                event.preventDefault();
                if (busy || mustReload || blocked) return;
                if (action === "resend") resend.mutate();
                else revoke.mutate();
              }}
            >
              <p>
                {action === "resend"
                  ? copy.resendConfirmation
                  : t.invitationRevokeConfirmation}
              </p>
              <div className="action-group">
                <Button
                  type="submit"
                  variant={action === "resend" ? "primary" : "secondary"}
                  pending={busy}
                  disabled={mustReload || blocked}
                >
                  {action === "resend"
                    ? copy.confirmResend
                    : t.grantRevokeConfirm}
                </Button>
                <Button disabled={busy} onClick={() => setAction(undefined)}>
                  {t.cancel}
                </Button>
              </div>
            </form>
          ) : (
            <div className="action-group">
              <Button
                disabled={busy || mustReload || blocked}
                onClick={() => {
                  revoke.reset();
                  resend.reset();
                  setAction("resend");
                }}
              >
                {t.invitationResend}
              </Button>
              <Button
                disabled={busy || mustReload || blocked}
                onClick={() => {
                  revoke.reset();
                  resend.reset();
                  setAction("revoke");
                }}
              >
                {t.invitationRevoke}
              </Button>
            </div>
          )}
        </section>
      ) : (
        <p className="notice invitation-final-note">{copy.finalHint}</p>
      )}
      {error && (
        <WriteFailure
          error={error}
          returnTo={returnTo}
          t={t}
          busy={busy}
          onReload={reconcile}
        />
      )}
      {mustReload && <p className="hint">{copy.reviewRequired}</p>}
    </article>
  );
}

/** Current-page invitations and linkable detail; the public acceptance flow is separate. */
export function CompanyInvitations({
  companyId,
  administrator,
  viewerResponsible,
  cursor,
  invitationId,
  returnTo,
  locale,
  t,
}: {
  companyId: string;
  administrator: boolean;
  viewerResponsible: boolean;
  cursor?: string;
  invitationId?: string;
  returnTo: string;
  locale: Locale;
  t: OrganizationMessages;
}) {
  const navigate = useNavigate();
  const copy = t.invitationWorkspace;
  const [text, setText] = useState("");
  const [status, setStatus] = useState<Invitation["status"] | "all">("all");
  const [selectedId, setSelectedId] = useState<string>();
  const selection = useRef<string | undefined>(undefined);
  const [notice, setNotice] = useState<"created" | "resent">();
  const invitations = useQuery({
    queryKey: [...invitationsKey(companyId), cursor ?? null],
    queryFn: () => listInvitations(companyId, cursor),
    refetchInterval: (query) =>
      query.state.data?.items.some(
        (item) => item.status === "PENDING" && item.delivery === "PENDING",
      )
        ? 5000
        : false,
  });
  const items = invitations.data?.items ?? [];
  const normalize = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase(locale)
      .trim();
  const term = normalize(text);
  const rows = items.filter(
    (item) =>
      (status === "all" || item.status === status) &&
      (!term || normalize(item.recipientEmail ?? "").includes(term)),
  );
  const detail = items.find((item) => item.id === invitationId);
  const openInvitation = (id?: string, firstPage = false) => {
    void navigate({
      to: "/companies/$companyId",
      params: { companyId },
      search: {
        view: "invitations",
        ...(id !== "new" && !firstPage && cursor ? { cursor } : {}),
        ...(id ? { invitation: id } : {}),
      },
    });
  };
  const reload = async () => (await invitations.refetch()).isSuccess;
  const columns = useMemo<readonly DataSetColumn<Invitation>[]>(
    () => [
      {
        key: "recipient",
        header: copy.recipient,
        width: 300,
        value: (row) => row.recipientEmail ?? t.invitationAddressErased,
        render: (row) => (
          <Link
            className="invitation-recipient"
            to="/companies/$companyId"
            params={{ companyId }}
            search={{ view: "invitations", cursor, invitation: row.id }}
          >
            <NavigationIcon name="invitations" />
            <strong>{row.recipientEmail ?? t.invitationAddressErased}</strong>
          </Link>
        ),
      },
      {
        key: "status",
        header: copy.status,
        width: 180,
        value: (row) => t.invitationStatuses[row.status],
        render: (row) => <InvitationStatus invitation={row} t={t} />,
      },
      {
        key: "delivery",
        header: copy.delivery,
        width: 280,
        value: (row) =>
          row.delivery ? t.deliveryStates[row.delivery] : copy.noDelivery,
      },
      {
        key: "access",
        header: copy.access,
        width: 280,
        value: (row) => `${t.roles[row.role]} · ${scopeText(t, row)}`,
        render: (row) => (
          <div className="invitation-access-cell">
            <strong>{t.roles[row.role]}</strong>
            <small>{scopeText(t, row)}</small>
          </div>
        ),
      },
      {
        key: "expiry",
        header: copy.linkExpiry,
        width: 205,
        value: (row) => formatInstant(locale, row.expiresAt),
      },
    ],
    [companyId, cursor, locale, t, copy],
  );
  return (
    <section
      className="invitations-workspace"
      aria-labelledby="company-invitations-title"
    >
      <header className="invitations-header">
        <div>
          <h2 id="company-invitations-title">{t.invitationsTitle}</h2>
          <p className="hint">{t.invitationsLead}</p>
        </div>
        {!invitationId && (
          <Button
            variant="primary"
            onClick={() => {
              setNotice(undefined);
              openInvitation("new");
            }}
          >
            <UiIcon name="add" />
            {t.inviteTitle}
          </Button>
        )}
      </header>
      {notice && (
        <p role="status" className="notice notice-success">
          {notice === "created" ? t.inviteSent : copy.resent}
        </p>
      )}
      {invitationId ? (
        <>
          <Link
            className="invitations-back"
            to="/companies/$companyId"
            params={{ companyId }}
            search={{ view: "invitations", cursor }}
          >
            <UiIcon name="previous" />
            {copy.back}
          </Link>
          {invitationId === "new" ? (
            <InviteForm
              {...{ companyId, administrator, viewerResponsible, returnTo, t }}
              onSaved={(invitation) => {
                setNotice("created");
                openInvitation(invitation.id);
              }}
              onCancel={() => openInvitation()}
              onReload={reload}
            />
          ) : (
            <>
              {invitations.isError && !detail && (
                <div role="alert" className="notice notice-error">
                  {describe(invitations.error, t, "read")}
                  <Button onClick={() => void reload()}>{t.reload}</Button>
                </div>
              )}
              {invitations.isPending ? (
                <p>{t.loading}</p>
              ) : detail ? (
                <InvitationDetail
                  key={detail.id}
                  invitation={detail}
                  {...{ companyId, returnTo, locale, t }}
                  blocked={invitations.isError}
                  readError={invitations.error}
                  onResent={(next) => {
                    setNotice("resent");
                    openInvitation(next.id, true);
                  }}
                  onReload={reload}
                />
              ) : (
                !invitations.isError && (
                  <p className="empty-state">{copy.noDetail}</p>
                )
              )}
            </>
          )}
        </>
      ) : invitations.isPending ? (
        <p>{t.loading}</p>
      ) : invitations.isError ? (
        <div role="alert" className="notice notice-error">
          {describe(invitations.error, t, "read")}
          <Button onClick={() => void reload()}>{t.reload}</Button>
        </div>
      ) : (
        <>
          <div className="invitations-controls">
            <TextField
              label={copy.search}
              placeholder={copy.searchPlaceholder}
              type="search"
              value={text}
              maxLength={254}
              onChange={(event) => setText(event.target.value)}
            />
            <div className="ui-field">
              <label htmlFor="invitations-status">{copy.status}</label>
              <select
                id="invitations-status"
                className="ui-field-control"
                value={status}
                onChange={(event) =>
                  setStatus(event.target.value as typeof status)
                }
              >
                <option value="all">{copy.allStatuses}</option>
                {(
                  Object.keys(t.invitationStatuses) as Invitation["status"][]
                ).map((value) => (
                  <option value={value} key={value}>
                    {t.invitationStatuses[value]}
                  </option>
                ))}
              </select>
            </div>
            {(text || status !== "all") && (
              <Button
                onClick={() => {
                  setText("");
                  setStatus("all");
                }}
              >
                {copy.clear}
              </Button>
            )}
          </div>
          <p className="hint invitations-results" role="status">
            {copy.pageResults(rows.length, items.length)}
          </p>
          <DataSet
            label={copy.listLabel}
            locale={locale}
            mode="grid"
            rows={rows}
            columns={columns}
            rowId={(row) => row.id}
            selectedId={
              rows.some((row) => row.id === selectedId) ? selectedId : undefined
            }
            onSelect={(id) => {
              selection.current = id;
              setSelectedId(id);
            }}
            onModeChange={
              rows.length
                ? () =>
                    openInvitation(
                      rows.find((row) => row.id === selection.current)?.id ??
                        rows[0].id,
                    )
                : undefined
            }
            onRefresh={() => void reload()}
            refreshing={invitations.isFetching}
            empty={
              <p className="empty-state">
                {items.length ? copy.noResults : t.invitationsEmpty}
              </p>
            }
          />
          <p className="hint">{copy.pageHint}</p>
          {(cursor || invitations.data.nextCursor) && (
            <nav className="pagination" aria-label={t.invitationsTitle}>
              {cursor && (
                <Link
                  to="/companies/$companyId"
                  params={{ companyId }}
                  search={{ view: "invitations" }}
                >
                  {t.firstPage}
                </Link>
              )}
              {invitations.data.nextCursor && (
                <Link
                  to="/companies/$companyId"
                  params={{ companyId }}
                  search={{
                    view: "invitations",
                    cursor: invitations.data.nextCursor,
                  }}
                >
                  {t.nextPage}
                </Link>
              )}
            </nav>
          )}
        </>
      )}
    </section>
  );
}

const credentialStorageKey = "teluni.invitation";
const credentialPattern = /^[A-Za-z0-9_-]{43}$/;

function readStorage(): string | null {
  try {
    return sessionStorage.getItem(credentialStorageKey);
  } catch {
    return null;
  }
}
function writeStorage(value: string | null): void {
  try {
    if (value === null) sessionStorage.removeItem(credentialStorageKey);
    else sessionStorage.setItem(credentialStorageKey, value);
  } catch {
    /* Without storage the credential lives only in this page. */
  }
}

/**
 * Moves the credential out of the address bar: the fragment is kept in the
 * tab's session storage across sign-in and removed from history.
 */
function useInvitationCredential(): [string | null, () => void] {
  const { hash } = useLocation();
  const router = useRouter();
  const [credential, setCredential] = useState<string | null>(() => {
    if (credentialPattern.test(hash)) {
      writeStorage(hash);
      return hash;
    }
    const stored = readStorage();
    return stored && credentialPattern.test(stored) ? stored : null;
  });
  useEffect(() => {
    if (hash) router.history.replace("/invitations/accept");
  }, [hash, router]);
  return [
    credential,
    () => {
      writeStorage(null);
      setCredential(null);
    },
  ];
}

const finalCodes = new Set([
  "RESOURCE_NOT_FOUND",
  "INVITATION_NO_LONGER_VALID",
]);

function PreviewDetails({
  preview,
  locale,
  t,
}: {
  preview: InvitationPreview;
  locale: Locale;
  t: OrganizationMessages;
}) {
  return (
    <dl className="company-settings">
      <dt>{t.acceptCompany}</dt>
      <dd>{preview.companyName}</dd>
      <dt>{t.acceptAccess}</dt>
      <dd>
        {t.roles[preview.role]} · {scopeText(t, preview)}
        {preview.grantExpiresAt &&
          ` · ${t.grantUntil} ${formatInstant(locale, preview.grantExpiresAt)}`}
      </dd>
      {preview.invitedByName && (
        <>
          <dt>{t.acceptInvitedBy}</dt>
          <dd>{preview.invitedByName}</dd>
        </>
      )}
      <dt>{t.acceptExpires}</dt>
      <dd>{formatInstant(locale, preview.expiresAt)}</dd>
    </dl>
  );
}

export function AcceptInvitationPage({
  locale,
  t,
}: {
  locale: Locale;
  t: OrganizationMessages;
}) {
  const [credential, forget] = useInvitationCredential();
  const session = useQuery(sessionQuery);
  const client = useQueryClient();
  const navigate = useNavigate();
  const preview = useQuery({
    queryKey: ["organizations", "invitation-preview", credential],
    queryFn: () => previewInvitation(credential!),
    enabled: Boolean(credential && session.data),
    retry: false,
  });
  const accept = useMutation({
    mutationFn: () => acceptInvitation(credential!),
    onSuccess: async ({ companyId }) => {
      forget();
      await client.invalidateQueries({ queryKey: companiesKey });
      await navigate({ to: "/companies/$companyId", params: { companyId } });
    },
  });
  const failure = preview.error ?? accept.error;
  const failureCode = failure instanceof ApiFailure ? failure.code : undefined;
  useEffect(() => {
    if (failureCode && finalCodes.has(failureCode)) writeStorage(null);
  }, [failureCode]);
  let body;
  if (!credential)
    body = (
      <p role="alert" className="notice notice-error">
        {t.acceptMissing}
      </p>
    );
  else if (session.isPending) body = <p>{t.loading}</p>;
  else if (session.isError)
    body = (
      <div role="alert" className="notice notice-error">
        {describe(session.error, t, "read")}
      </div>
    );
  else if (!session.data)
    body = (
      <>
        <p>{t.acceptSignIn}</p>
        <a
          className="button-link button-primary"
          href={loginHref("/invitations/accept")}
        >
          {t.signIn}
        </a>
        <p>{t.acceptSignUp}</p>
        <a className="button-link" href={signUpHref("/invitations/accept")}>
          {t.signUp}
        </a>
      </>
    );
  else if (preview.isPending) body = <p>{t.loading}</p>;
  else if (preview.error)
    body = (
      <div role="alert" className="notice notice-error">
        {failureCode === "RESOURCE_NOT_FOUND"
          ? t.acceptMissing
          : describe(preview.error, t, "read")}
      </div>
    );
  else if (preview.data.status === "ACCEPTED")
    body = (
      <>
        <p role="status" className="notice notice-success">
          {t.acceptAlready}
        </p>
        <Link
          to="/companies/$companyId"
          params={{ companyId: preview.data.companyId }}
          onClick={forget}
        >
          {t.openCompany}
        </Link>
      </>
    );
  else {
    // Acceptance is idempotent, so a retry after an unknown outcome is safe;
    // only a final answer removes the button.
    const final =
      failureCode !== undefined &&
      (finalCodes.has(failureCode) ||
        failureCode === "INVITATION_RECIPIENT_MISMATCH" ||
        failureCode === "MEMBERSHIP_SUSPENDED");
    body = (
      <>
        <p>{t.acceptLead}</p>
        <PreviewDetails preview={preview.data} locale={locale} t={t} />
        {accept.error && (
          <div role="alert" className="notice notice-error">
            {describe(accept.error, t, "write")}
          </div>
        )}
        {!final && (
          <button
            type="button"
            className="button-primary"
            disabled={accept.isPending}
            onClick={() => accept.mutate()}
          >
            {accept.isPending ? t.accepting : t.acceptButton}
          </button>
        )}
      </>
    );
  }
  return (
    <section
      className="panel organization-panel"
      aria-labelledby="accept-invitation-title"
      lang={locale}
    >
      <h1 id="accept-invitation-title">{t.acceptTitle}</h1>
      {body}
    </section>
  );
}
