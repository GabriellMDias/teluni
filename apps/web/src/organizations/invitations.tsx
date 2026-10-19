import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Link,
  useLocation,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { ApiFailure } from "../api-client.js";
import { loginHref, sessionQuery } from "../identity/api.js";
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

function InviteForm({
  companyId,
  administrator,
  viewerResponsible,
  returnTo,
  t,
}: {
  companyId: string;
  administrator: boolean;
  viewerResponsible: boolean;
  returnTo: string;
  t: OrganizationMessages;
}) {
  const client = useQueryClient();
  const [email, setEmail] = useState("");
  const [draft, setDraft] = useState<GrantDraft>(
    administrator ? emptyGrantDraft : { ...emptyGrantDraft, scope: "BRANCHES" },
  );
  const [done, setDone] = useState(false);
  const invite = useMutation({
    mutationFn: () => {
      const grantExpiresAt = draftExpiry(draft);
      return createInvitation(companyId, {
        email,
        ...grantRequestOf(draft),
        ...(grantExpiresAt ? { grantExpiresAt } : {}),
      });
    },
    onSuccess: async () => {
      setEmail("");
      setDraft(
        administrator
          ? emptyGrantDraft
          : { ...emptyGrantDraft, scope: "BRANCHES" },
      );
      setDone(true);
      await invalidateCompany(client, companyId);
    },
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    setDone(false);
    invite.mutate();
  }
  return (
    <form
      className="form-stack grant-form"
      aria-labelledby="invite-title"
      onSubmit={submit}
    >
      <h3 id="invite-title">{t.inviteTitle}</h3>
      <label htmlFor="invite-email">{t.inviteEmail}</label>
      <input
        id="invite-email"
        type="email"
        required
        maxLength={254}
        autoComplete="off"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <GrantRequestFields
        companyId={companyId}
        idPrefix="invite"
        roles={
          administrator ? administratorRoles(viewerResponsible) : ["OPERATOR"]
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
      {invite.error && (
        <WriteFailure error={invite.error} returnTo={returnTo} t={t} />
      )}
      {done && (
        <p role="status" className="notice notice-success">
          {t.inviteSent}
        </p>
      )}
      <button
        type="submit"
        className="button-primary"
        disabled={invite.isPending || !draftComplete(draft)}
      >
        {invite.isPending ? t.saving : t.inviteSubmit}
      </button>
    </form>
  );
}

function InvitationRow({
  companyId,
  invitation,
  returnTo,
  locale,
  t,
}: {
  companyId: string;
  invitation: Invitation;
  returnTo: string;
  locale: Locale;
  t: OrganizationMessages;
}) {
  const client = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const refresh = () => invalidateCompany(client, companyId);
  const resend = useMutation({
    mutationFn: () => resendInvitation(companyId, invitation.id),
    onSuccess: refresh,
  });
  // Revocation is idempotent, so a retry after an unknown outcome is safe.
  const revoke = useMutation({
    mutationFn: () => revokeInvitation(companyId, invitation.id),
    onSuccess: async () => {
      setConfirming(false);
      await refresh();
    },
  });
  const label = invitation.recipientEmail ?? t.invitationAddressErased;
  const pending = invitation.status === "PENDING";
  const error = resend.error ?? revoke.error;
  const busy = resend.isPending || revoke.isPending;
  return (
    <li className="branch-item">
      <div>
        <strong>{label}</strong>
      </div>
      <span>
        {t.invitationStatuses[invitation.status]} · {t.roles[invitation.role]} ·{" "}
        {scopeText(t, invitation)}
        {invitation.grantExpiresAt &&
          ` · ${t.grantUntil} ${formatInstant(locale, invitation.grantExpiresAt)}`}
      </span>
      <span className="hint">
        {pending &&
          `${t.invitationUntil} ${formatInstant(locale, invitation.expiresAt)} · `}
        {invitation.invitedByName &&
          `${t.invitationBy} ${invitation.invitedByName} · `}
        {pending &&
          invitation.delivery &&
          t.deliveryStates[invitation.delivery]}
      </span>
      {pending &&
        (confirming ? (
          <form
            className="form-stack"
            aria-label={`${t.invitationRevoke}: ${label}`}
            onSubmit={(event) => {
              event.preventDefault();
              revoke.mutate();
            }}
          >
            <p>{t.invitationRevokeConfirmation}</p>
            <div className="action-group">
              <button type="submit" disabled={busy}>
                {revoke.isPending ? t.saving : t.grantRevokeConfirm}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setConfirming(false);
                  revoke.reset();
                }}
              >
                {t.cancel}
              </button>
            </div>
          </form>
        ) : (
          <div className="action-group">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                revoke.reset();
                resend.mutate();
              }}
            >
              {resend.isPending ? t.saving : `${t.invitationResend}: ${label}`}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                resend.reset();
                setConfirming(true);
              }}
            >
              {t.invitationRevoke}: {label}
            </button>
          </div>
        ))}
      {error && (
        <WriteFailure
          error={error}
          returnTo={returnTo}
          t={t}
          busy={busy}
          onReload={() => {
            resend.reset();
            revoke.reset();
            void refresh();
          }}
        />
      )}
    </li>
  );
}

export function CompanyInvitations({
  companyId,
  administrator,
  viewerResponsible,
  cursor,
  returnTo,
  locale,
  t,
}: {
  companyId: string;
  administrator: boolean;
  viewerResponsible: boolean;
  cursor?: string;
  returnTo: string;
  locale: Locale;
  t: OrganizationMessages;
}) {
  const invitations = useQuery({
    queryKey: [...invitationsKey(companyId), cursor ?? null],
    queryFn: () => listInvitations(companyId, cursor),
  });
  return (
    <section aria-labelledby="company-invitations-title">
      <h2 id="company-invitations-title">{t.invitationsTitle}</h2>
      <p>{t.invitationsLead}</p>
      <InviteForm
        {...{ companyId, administrator, viewerResponsible, returnTo, t }}
      />
      {invitations.isPending ? (
        <p>{t.loading}</p>
      ) : invitations.isError ? (
        <div role="alert" className="notice notice-error">
          {describe(invitations.error, t, "read")}
          <button type="button" onClick={() => void invitations.refetch()}>
            {t.reload}
          </button>
        </div>
      ) : invitations.data.items.length === 0 ? (
        <p className="empty-state">{t.invitationsEmpty}</p>
      ) : (
        <ul className="branch-list" aria-label={t.invitationsTitle}>
          {invitations.data.items.map((invitation) => (
            <InvitationRow
              key={invitation.id}
              {...{ companyId, invitation, returnTo, locale, t }}
            />
          ))}
        </ul>
      )}
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
        {invitations.data?.nextCursor && (
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
