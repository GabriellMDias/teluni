import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ApiFailure } from "../api-client.js";
import { loginHref } from "../identity/api.js";
import {
  auditKey,
  companiesKey,
  companyKey,
  describe,
  listMembers,
  membersKey,
  updateMemberStatus,
  type Member,
} from "./api.js";
import type { OrganizationMessages } from "./messages.js";

function MemberRow({
  companyId,
  member,
  principalId,
  returnTo,
  t,
}: {
  companyId: string;
  member: Member;
  principalId: string;
  returnTo: string;
  t: OrganizationMessages;
}) {
  const client = useQueryClient();
  // The confirmation keeps its observed version, even across list refetches.
  const [intent, setIntent] = useState<{
    status: Member["status"];
    expectedVersion: number;
  } | null>(null);
  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: membersKey(companyId) }),
      client.invalidateQueries({ queryKey: companyKey(companyId) }),
      client.invalidateQueries({ queryKey: companiesKey }),
      client.invalidateQueries({ queryKey: auditKey(companyId) }),
    ]);
  const change = useMutation({
    mutationFn: (input: NonNullable<typeof intent>) =>
      updateMemberStatus(companyId, member.id, input),
    onSuccess: async () => {
      setIntent(null);
      await refresh();
    },
  });
  const mustReload =
    Boolean(change.error) &&
    (!(change.error instanceof ApiFailure) ||
      change.error.status >= 500 ||
      change.error.code === "RESOURCE_VERSION_CONFLICT");
  const label = member.displayName ?? member.email ?? t.memberUnknown;
  const begin = (status: Member["status"]) => {
    change.reset();
    setIntent({ status, expectedVersion: member.version });
  };
  async function reload() {
    await refresh();
    setIntent(null);
    change.reset();
  }
  return (
    <li className="branch-item">
      <div>
        <strong>{label}</strong>
        {member.principalId === principalId && (
          <span className="hint"> · {t.memberYou}</span>
        )}
      </div>
      {member.email && member.email !== label && <span>{member.email}</span>}
      {!member.displayName && !member.email && (
        <span className="hint">
          {t.memberReference}: {member.id}
        </span>
      )}
      <span>
        {t.memberStatuses[member.status]} ·{" "}
        {member.roles.map((role) => t.roles[role]).join(", ") ||
          t.memberNoRoles}
      </span>
      {member.responsible ? (
        <p className="hint">{t.memberResponsibleProtected}</p>
      ) : intent ? (
        <form
          className="form-stack"
          aria-label={`${t.memberConfirm}: ${label}`}
          onSubmit={(event) => {
            event.preventDefault();
            if (!mustReload) change.mutate(intent);
          }}
        >
          <p>{t.memberConfirmations[intent.status]}</p>
          <div className="action-group">
            <button type="submit" disabled={change.isPending || mustReload}>
              {change.isPending ? t.saving : t.memberConfirm}
            </button>
            <button
              type="button"
              disabled={change.isPending}
              onClick={() => {
                if (mustReload) void reload();
                else {
                  setIntent(null);
                  change.reset();
                }
              }}
            >
              {t.cancel}
            </button>
          </div>
        </form>
      ) : (
        member.status !== "REMOVED" && (
          <div className="action-group">
            <button
              type="button"
              onClick={() =>
                begin(member.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE")
              }
            >
              {member.status === "ACTIVE"
                ? t.memberSuspend
                : t.memberReactivate}
              : {label}
            </button>
            <button type="button" onClick={() => begin("REMOVED")}>
              {t.memberRemove}: {label}
            </button>
          </div>
        )
      )}
      {change.error && (
        <div role="alert" className="notice notice-error">
          {describe(change.error, t, "write")}
          {change.error instanceof ApiFailure &&
            change.error.code === "RECENT_AUTHENTICATION_REQUIRED" && (
              <a
                className="button-link button-primary"
                href={loginHref(returnTo, "recent")}
              >
                {t.memberReauthenticate}
              </a>
            )}
          <button
            type="button"
            disabled={change.isPending}
            onClick={() => void reload()}
          >
            {t.reload}
          </button>
        </div>
      )}
    </li>
  );
}

export function CompanyMembers({
  companyId,
  principalId,
  cursor,
  returnTo,
  t,
}: {
  companyId: string;
  principalId: string;
  cursor?: string;
  returnTo: string;
  t: OrganizationMessages;
}) {
  const members = useQuery({
    queryKey: [...membersKey(companyId), cursor ?? null],
    queryFn: () => listMembers(companyId, cursor),
  });
  return (
    <section aria-labelledby="company-members-title">
      <h2 id="company-members-title">{t.membersTitle}</h2>
      <p>{t.membersLead}</p>
      {members.isPending ? (
        <p>{t.loading}</p>
      ) : members.isError ? (
        <div role="alert" className="notice notice-error">
          {describe(members.error, t, "read")}
          <button type="button" onClick={() => void members.refetch()}>
            {t.reload}
          </button>
        </div>
      ) : members.data.items.length === 0 ? (
        <p className="empty-state">{t.membersEmpty}</p>
      ) : (
        <ul className="branch-list">
          {members.data.items.map((member) => (
            <MemberRow
              key={member.id}
              {...{ companyId, principalId, member, returnTo, t }}
            />
          ))}
        </ul>
      )}
      <nav className="pagination" aria-label={t.membersTitle}>
        {cursor && (
          <Link
            to="/companies/$companyId"
            params={{ companyId }}
            search={{ view: "members" }}
          >
            {t.firstPage}
          </Link>
        )}
        {members.data?.nextCursor && (
          <Link
            to="/companies/$companyId"
            params={{ companyId }}
            search={{ view: "members", cursor: members.data.nextCursor }}
          >
            {t.nextPage}
          </Link>
        )}
      </nav>
    </section>
  );
}
