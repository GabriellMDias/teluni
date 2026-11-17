import { useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ApiFailure } from "../api-client.js";
import { Button, DataSet, TextField } from "../components.js";
import type { DataSetColumn } from "../dataset.js";
import { NavigationIcon } from "../navigation-icon.js";
import { UiIcon } from "../ui-icon.js";
import { loginHref } from "../identity/api.js";
import type { Locale } from "../locale.js";
import {
  addMemberGrant,
  branchesKey,
  describe,
  invalidateCompany,
  listAccessProfiles,
  listBranchChoices,
  listMembers,
  membersKey,
  profilesKey,
  requestResponsibilityTransfer,
  revokeMemberGrant,
  updateMemberStatus,
  type AccessProfile,
  type Grant,
  type GrantInput,
  type Member,
  type Role,
} from "./api.js";
import type { OrganizationMessages } from "./messages.js";

/** Failure of a write, with the re-authentication its code asks for. */
export function WriteFailure({
  error,
  returnTo,
  t,
  busy,
  onReload,
}: {
  error: unknown;
  returnTo: string;
  t: OrganizationMessages;
  busy?: boolean;
  onReload?: () => void;
}) {
  const code = error instanceof ApiFailure ? error.code : undefined;
  return (
    <div role="alert" className="notice notice-error">
      {describe(error, t, "write")}
      {code === "RECENT_AUTHENTICATION_REQUIRED" && (
        <a
          className="button-link button-primary"
          href={loginHref(returnTo, { reauthenticate: true })}
        >
          {t.memberReauthenticate}
        </a>
      )}
      {onReload && (
        <button type="button" disabled={busy} onClick={onReload}>
          {t.reload}
        </button>
      )}
    </div>
  );
}

export function formatInstant(locale: Locale, value: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

/**
 * A grant being composed: role or access profile, scope, branches and
 * optional expiry.
 */
export type GrantDraft = Readonly<{
  role: Role;
  /** The chosen access profile; empty when the grant carries `role`. */
  profileId: string;
  scope: "COMPANY" | "BRANCHES";
  branchIds: readonly string[];
  /** `datetime-local` value in the browser's zone; empty for no expiry. */
  expiresAt: string;
}>;

export const emptyGrantDraft: GrantDraft = {
  role: "OPERATOR",
  profileId: "",
  scope: "COMPANY",
  branchIds: [],
  expiresAt: "",
};

/** Company administration is always company-wide. */
export function effectiveScope(draft: GrantDraft): "COMPANY" | "BRANCHES" {
  return !draft.profileId && draft.role === "COMPANY_ADMINISTRATOR"
    ? "COMPANY"
    : draft.scope;
}

/** The grant request a draft describes, without the expiry. */
export function grantRequestOf(draft: GrantDraft) {
  const scope = effectiveScope(draft);
  return {
    role: draft.role,
    scope,
    ...(scope === "BRANCHES" ? { branchIds: [...draft.branchIds] } : {}),
  };
}

/** The direct-grant request a draft describes, by role or profile. */
export function memberGrantRequestOf(
  draft: GrantDraft,
): Omit<GrantInput, "expiresAt"> {
  if (!draft.profileId) return grantRequestOf(draft);
  return {
    profileId: draft.profileId,
    scope: draft.scope,
    ...(draft.scope === "BRANCHES" ? { branchIds: [...draft.branchIds] } : {}),
  };
}

/** How a grant reads to people: its role, or its access profile's name. */
export function grantLabel(grant: Grant, t: OrganizationMessages): string {
  return grant.role
    ? t.roles[grant.role]
    : `${t.grantProfile}: ${grant.profile?.name ?? t.memberUnknown}`;
}

export function draftExpiry(draft: GrantDraft): string | undefined {
  return draft.expiresAt ? new Date(draft.expiresAt).toISOString() : undefined;
}

export function draftComplete(draft: GrantDraft): boolean {
  return effectiveScope(draft) === "COMPANY" || draft.branchIds.length > 0;
}

/**
 * Role, scope, branch and expiry fields shared by direct grants and
 * invitations. `roles` lists what the viewer may grant and `profiles` the
 * active access profiles offered beside them; without `companyScope` the
 * grant is always branch-scoped.
 */
export function GrantRequestFields({
  companyId,
  idPrefix,
  roles,
  profiles = [],
  companyScope,
  hints,
  draft,
  onChange,
  t,
}: {
  companyId: string;
  idPrefix: string;
  roles: readonly Role[];
  profiles?: readonly AccessProfile[];
  companyScope: boolean;
  hints?: readonly string[];
  draft: GrantDraft;
  onChange: (draft: GrantDraft) => void;
  t: OrganizationMessages;
}) {
  const scope = companyScope ? effectiveScope(draft) : "BRANCHES";
  const choices = useQuery({
    queryKey: [...branchesKey(companyId), "choices"],
    queryFn: () => listBranchChoices(companyId),
    enabled: scope === "BRANCHES",
  });
  const id = (name: string) => `${idPrefix}-${name}`;
  const profile = profiles.find((choice) => choice.id === draft.profileId);
  const roleChoices = roles.map((choice) => (
    <option key={choice} value={choice}>
      {t.roles[choice]}
    </option>
  ));
  return (
    <>
      <label htmlFor={id("role")}>
        {profiles.length > 0 ? t.grantRoleOrProfile : t.grantRole}
      </label>
      <select
        id={id("role")}
        value={draft.profileId ? `profile:${draft.profileId}` : draft.role}
        onChange={(event) => {
          const value = event.target.value;
          onChange(
            value.startsWith("profile:")
              ? { ...draft, profileId: value.slice("profile:".length) }
              : { ...draft, role: value as Role, profileId: "" },
          );
        }}
      >
        {profiles.length > 0 ? (
          <>
            <optgroup label={t.grantRolesGroup}>{roleChoices}</optgroup>
            <optgroup label={t.grantProfilesGroup}>
              {profiles.map((choice) => (
                <option key={choice.id} value={`profile:${choice.id}`}>
                  {choice.name}
                </option>
              ))}
            </optgroup>
          </>
        ) : (
          roleChoices
        )}
      </select>
      {profile && (
        <p className="hint">
          {t.grantProfileIncludes}:{" "}
          {profile.capabilities
            .map((capability) => t.capabilities[capability])
            .join(", ")}
        </p>
      )}
      {hints?.map((hint) => (
        <p key={hint} className="hint">
          {hint}
        </p>
      ))}
      {!profile && draft.role === "COMPANY_ADMINISTRATOR" ? (
        <p className="hint">{t.grantAdministratorCompanyWide}</p>
      ) : (
        companyScope && (
          <fieldset>
            <legend>{t.grantScope}</legend>
            {(["COMPANY", "BRANCHES"] as const).map((choice) => (
              <label key={choice} className="choice">
                <input
                  type="radio"
                  name={id("scope")}
                  value={choice}
                  checked={draft.scope === choice}
                  onChange={() => onChange({ ...draft, scope: choice })}
                />
                {choice === "COMPANY"
                  ? t.grantScopeCompany
                  : t.grantScopeBranches}
              </label>
            ))}
          </fieldset>
        )
      )}
      {scope === "BRANCHES" && (
        <fieldset>
          <legend>{t.grantBranches}</legend>
          {choices.isPending ? (
            <p>{t.loading}</p>
          ) : choices.isError ? (
            <div role="alert" className="notice notice-error">
              {describe(choices.error, t, "read")}
              <button type="button" onClick={() => void choices.refetch()}>
                {t.reload}
              </button>
            </div>
          ) : choices.data.items.length === 0 ? (
            <p className="hint">{t.grantNoBranches}</p>
          ) : (
            choices.data.items.map((branch) => (
              <label key={branch.id} className="choice">
                <input
                  type="checkbox"
                  checked={draft.branchIds.includes(branch.id)}
                  onChange={(event) =>
                    onChange({
                      ...draft,
                      branchIds: event.target.checked
                        ? [...draft.branchIds, branch.id]
                        : draft.branchIds.filter(
                            (value) => value !== branch.id,
                          ),
                    })
                  }
                />
                {branch.name}
              </label>
            ))
          )}
          {choices.data?.truncated && (
            <p className="hint">{t.grantBranchesTruncated}</p>
          )}
        </fieldset>
      )}
      <label htmlFor={id("expiry")}>{t.grantExpiry}</label>
      <input
        id={id("expiry")}
        type="datetime-local"
        aria-describedby={id("expiry-hint")}
        value={draft.expiresAt}
        onChange={(event) =>
          onChange({ ...draft, expiresAt: event.target.value })
        }
      />
      <p id={id("expiry-hint")} className="hint">
        {t.grantExpiryHint}
      </p>
    </>
  );
}

/** The roles an administrator may grant; administration only when responsible. */
export function administratorRoles(viewerResponsible: boolean): Role[] {
  return [
    "OPERATOR",
    "BRANCH_MANAGER",
    ...(viewerResponsible ? (["COMPANY_ADMINISTRATOR"] as const) : []),
  ];
}

function GrantForm({
  companyId,
  member,
  label,
  viewerResponsible,
  returnTo,
  t,
  onClose,
}: {
  companyId: string;
  member: Member;
  label: string;
  viewerResponsible: boolean;
  returnTo: string;
  t: OrganizationMessages;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [draft, setDraft] = useState<GrantDraft>(emptyGrantDraft);
  const profiles = useQuery({
    queryKey: profilesKey(companyId),
    queryFn: () => listAccessProfiles(companyId),
  });
  // Granting is idempotent for an identical grant, so a retry after an
  // unknown outcome cannot duplicate it.
  const grant = useMutation({
    mutationFn: () => {
      const expiresAt = draftExpiry(draft);
      return addMemberGrant(companyId, member.id, {
        ...memberGrantRequestOf(draft),
        ...(expiresAt ? { expiresAt } : {}),
      });
    },
    onSuccess: async () => {
      onClose();
      await invalidateCompany(client, companyId);
    },
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    grant.mutate();
  }
  return (
    <form
      className="form-stack grant-form"
      aria-label={`${t.grantAdd}: ${label}`}
      onSubmit={submit}
    >
      <GrantRequestFields
        companyId={companyId}
        idPrefix={`grant-${member.id}`}
        roles={administratorRoles(viewerResponsible)}
        profiles={profiles.data ?? []}
        companyScope
        hints={viewerResponsible ? [] : [t.grantResponsibleOnly]}
        draft={draft}
        onChange={setDraft}
        t={t}
      />
      {profiles.isError && <p className="hint">{t.grantProfilesUnavailable}</p>}
      {grant.error && (
        <WriteFailure error={grant.error} returnTo={returnTo} t={t} />
      )}
      <div className="action-group">
        <button
          type="submit"
          className="button-primary"
          disabled={grant.isPending || !draftComplete(draft)}
        >
          {grant.isPending ? t.saving : t.grantSubmit}
        </button>
        <button type="button" disabled={grant.isPending} onClick={onClose}>
          {t.cancel}
        </button>
      </div>
    </form>
  );
}

const memberName = (member: Member, t: OrganizationMessages) =>
  member.displayName ?? member.email ?? t.memberUnknown;

function accessNames(member: Member, t: OrganizationMessages) {
  return [
    ...member.roles.map((role) => t.roles[role]),
    ...new Set(
      member.grants.flatMap((grant) =>
        grant.profile ? [grant.profile.name] : [],
      ),
    ),
  ];
}

function MemberStatus({
  status,
  t,
}: {
  status: Member["status"];
  t: OrganizationMessages;
}) {
  return (
    <span className="member-status" data-state={status}>
      {t.memberStatuses[status]}
    </span>
  );
}

function MemberAvatar({ member }: { member: Member }) {
  const initials = (member.displayName ?? "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => [...part][0] ?? "")
    .join("")
    .toLocaleUpperCase();
  return (
    <span className="member-avatar" aria-hidden="true">
      {initials || <NavigationIcon name="members" />}
    </span>
  );
}

type Intent =
  | { kind: "status"; status: Member["status"]; expectedVersion: number }
  | { kind: "revoke"; grant: Grant }
  | { kind: "grant" }
  | { kind: "transfer" };

function MemberDetail({
  companyId,
  member,
  principalId,
  viewerResponsible,
  transferPending,
  returnTo,
  cursor,
  locale,
  t,
}: {
  companyId: string;
  member: Member;
  principalId: string;
  viewerResponsible: boolean;
  transferPending: boolean;
  returnTo: string;
  cursor?: string;
  locale: Locale;
  t: OrganizationMessages;
}) {
  const client = useQueryClient();
  // A status confirmation keeps its observed version, even across refetches.
  const [intent, setIntent] = useState<Intent | null>(null);
  const refresh = () => invalidateCompany(client, companyId);
  const write = useMutation({
    mutationFn: async (target: Intent) => {
      if (target.kind === "status")
        await updateMemberStatus(companyId, member.id, {
          status: target.status,
          expectedVersion: target.expectedVersion,
        });
      else if (target.kind === "revoke")
        await revokeMemberGrant(companyId, member.id, target.grant.id);
      else if (target.kind === "transfer")
        await requestResponsibilityTransfer(companyId, member.id);
    },
    onSuccess: async () => {
      setIntent(null);
      await refresh();
    },
  });
  // Only a versioned status change can be stale; revocation is idempotent and
  // a repeated proposal is answered as already pending.
  const mustReload =
    intent?.kind === "status" &&
    Boolean(write.error) &&
    (!(write.error instanceof ApiFailure) ||
      write.error.status >= 500 ||
      write.error.code === "RESOURCE_VERSION_CONFLICT");
  const label = memberName(member, t);
  const removed = member.status === "REMOVED";
  const administratorGrants = member.grants.filter(
    (grant) => grant.role === "COMPANY_ADMINISTRATOR",
  ).length;
  const begin = (next: Intent) => {
    write.reset();
    setIntent(next);
  };
  async function reload() {
    await refresh();
    setIntent(null);
    write.reset();
  }
  const canTransfer =
    viewerResponsible &&
    !transferPending &&
    member.status === "ACTIVE" &&
    member.principalId !== principalId &&
    member.roles.includes("COMPANY_ADMINISTRATOR");
  const confirmation =
    intent?.kind === "status"
      ? {
          text: t.memberConfirmations[intent.status],
          action: t.memberConfirm,
        }
      : intent?.kind === "revoke"
        ? { text: t.grantRevokeConfirmation, action: t.grantRevokeConfirm }
        : intent?.kind === "transfer"
          ? { text: t.transferConfirmation, action: t.transferConfirm }
          : null;
  const copy = t.memberWorkspace;
  const canChange = !removed && !member.responsible;
  const roles = accessNames(member, t);
  return (
    <article className="member-detail" aria-labelledby="member-detail-title">
      {intent ? (
        <Button disabled>
          <UiIcon name="previous" /> {copy.back}
        </Button>
      ) : (
        <Link
          className="member-back"
          to="/companies/$companyId"
          params={{ companyId }}
          search={{ view: "members", cursor }}
        >
          <UiIcon name="previous" /> {copy.back}
        </Link>
      )}
      <header className="member-detail-heading">
        <MemberAvatar member={member} />
        <div>
          <h3 id="member-detail-title">{label}</h3>
          {member.email && member.email !== label && (
            <p className="hint">{member.email}</p>
          )}
          {!member.displayName && !member.email && (
            <p className="hint">
              {t.memberReference}: {member.id}
            </p>
          )}
        </div>
        <div className="member-badges">
          <MemberStatus status={member.status} t={t} />
          {member.principalId === principalId && (
            <span className="member-badge">{t.memberYou}</span>
          )}
          {member.responsible && (
            <span className="member-badge">{t.responsible}</span>
          )}
        </div>
      </header>
      <div className="member-detail-grid">
        <section
          className="member-detail-card"
          aria-labelledby="member-access-title"
        >
          <div className="member-card-heading">
            <div>
              <h4 id="member-access-title">{copy.access}</h4>
              <p className="hint">{copy.accessLead}</p>
            </div>
            {canChange && !intent && (
              <Button
                variant="primary"
                onClick={() => begin({ kind: "grant" })}
                aria-label={`${t.grantAdd}: ${label}`}
              >
                <UiIcon name="add" /> {t.grantAdd}
              </Button>
            )}
          </div>
          {member.grants.length ? (
            <ul
              className="grant-list member-grants"
              aria-label={`${t.grantsOf} ${label}`}
            >
              {member.grants.map((grant) => (
                <li key={grant.id}>
                  <div>
                    <strong>{grantLabel(grant, t)}</strong>
                    <p className="hint">
                      {grant.scope === "COMPANY"
                        ? t.grantCompanyWide
                        : `${t.grantBranches}: ${grant.branches.map((branch) => branch.name).join(", ")}`}
                      {grant.expiresAt &&
                        ` · ${t.grantUntil} ${formatInstant(locale, grant.expiresAt)}`}
                    </p>
                  </div>
                  {!removed &&
                    !intent &&
                    !(
                      member.responsible &&
                      grant.role === "COMPANY_ADMINISTRATOR" &&
                      administratorGrants <= 1
                    ) && (
                      <Button
                        aria-label={`${t.grantRevoke}: ${grantLabel(grant, t)} · ${label}`}
                        onClick={() => begin({ kind: "revoke", grant })}
                      >
                        {t.grantRevoke}
                      </Button>
                    )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-state">{roles.join(", ") || t.memberNoRoles}</p>
          )}
          {intent?.kind === "grant" && (
            <GrantForm
              {...{ companyId, member, label, viewerResponsible, returnTo, t }}
              onClose={() => setIntent(null)}
            />
          )}
        </section>
        <section
          className="member-detail-card"
          aria-labelledby="member-management-title"
        >
          <h4 id="member-management-title">{copy.management}</h4>
          <p className="hint">{copy.managementLead}</p>
          {member.responsible && (
            <p className="notice notice-info">{t.memberResponsibleProtected}</p>
          )}
          {removed && <p className="hint">{copy.removed}</p>}
          {!intent && (canChange || canTransfer) && (
            <div className="member-management-actions">
              {canChange && (
                <>
                  <Button
                    aria-label={`${member.status === "ACTIVE" ? t.memberSuspend : t.memberReactivate}: ${label}`}
                    onClick={() =>
                      begin({
                        kind: "status",
                        status:
                          member.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE",
                        expectedVersion: member.version,
                      })
                    }
                  >
                    {member.status === "ACTIVE"
                      ? t.memberSuspend
                      : t.memberReactivate}
                  </Button>
                  <Button
                    className="member-danger-action"
                    aria-label={`${t.memberRemove}: ${label}`}
                    onClick={() =>
                      begin({
                        kind: "status",
                        status: "REMOVED",
                        expectedVersion: member.version,
                      })
                    }
                  >
                    {t.memberRemove}
                  </Button>
                </>
              )}
              {canTransfer && (
                <Button
                  aria-label={`${t.transferPropose}: ${label}`}
                  onClick={() => begin({ kind: "transfer" })}
                >
                  {t.transferPropose}
                </Button>
              )}
            </div>
          )}
        </section>
      </div>
      {intent && confirmation && (
        <form
          className="form-stack member-confirmation"
          aria-label={`${confirmation.action}: ${label}`}
          onSubmit={(event) => {
            event.preventDefault();
            if (!mustReload && !write.isPending) write.mutate(intent);
          }}
        >
          <p>{confirmation.text}</p>
          <div className="action-group">
            <Button
              type="submit"
              variant="primary"
              pending={write.isPending}
              disabled={mustReload}
            >
              {write.isPending ? t.saving : confirmation.action}
            </Button>
            <Button
              disabled={write.isPending}
              onClick={() => {
                if (mustReload) void reload();
                else {
                  setIntent(null);
                  write.reset();
                }
              }}
            >
              {t.cancel}
            </Button>
          </div>
        </form>
      )}
      {write.error && (
        <WriteFailure
          error={write.error}
          returnTo={returnTo}
          t={t}
          busy={write.isPending}
          onReload={() => void reload()}
        />
      )}
    </article>
  );
}

const lookupText = (value: string, locale: Locale) =>
  value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase(locale)
    .trim();

export function CompanyMembers({
  companyId,
  principalId,
  viewerResponsible,
  transferPending,
  canInvite,
  cursor,
  memberId,
  returnTo,
  locale,
  t,
}: {
  companyId: string;
  principalId: string;
  viewerResponsible: boolean;
  transferPending: boolean;
  canInvite: boolean;
  cursor?: string;
  memberId?: string;
  returnTo: string;
  locale: Locale;
  t: OrganizationMessages;
}) {
  const navigate = useNavigate();
  const copy = t.memberWorkspace;
  const [text, setText] = useState("");
  const [status, setStatus] = useState<Member["status"] | "all">("all");
  const [selectedId, setSelectedId] = useState<string>();
  const selection = useRef<string | undefined>(undefined);
  const members = useQuery({
    queryKey: [...membersKey(companyId), cursor ?? null],
    queryFn: () => listMembers(companyId, cursor),
  });
  const term = lookupText(text, locale);
  const items = members.data?.items ?? [];
  const rows = items.filter(
    (item) =>
      (status === "all" || item.status === status) &&
      (!term ||
        [item.displayName, item.email].some(
          (value) => value && lookupText(value, locale).includes(term),
        )),
  );
  const detail = memberId
    ? items.find((item) => item.id === memberId)
    : undefined;
  const openMember = (id: string) => {
    void navigate({
      to: "/companies/$companyId",
      params: { companyId },
      search: { view: "members", cursor, member: id },
    });
  };
  const columns = useMemo<readonly DataSetColumn<Member>[]>(
    () => [
      {
        key: "person",
        header: copy.person,
        width: 320,
        value: (row) => memberName(row, t),
        render: (row) => (
          <Link
            className="members-person"
            to="/companies/$companyId"
            params={{ companyId }}
            search={{ view: "members", cursor, member: row.id }}
          >
            <MemberAvatar member={row} />
            <span>
              <strong>
                {memberName(row, t)}
                {row.principalId === principalId && (
                  <small> · {t.memberYou}</small>
                )}
              </strong>
              {row.email && row.email !== memberName(row, t) && (
                <small>{row.email}</small>
              )}
            </span>
          </Link>
        ),
      },
      {
        key: "status",
        header: copy.status,
        width: 145,
        value: (row) => t.memberStatuses[row.status],
        render: (row) => <MemberStatus status={row.status} t={t} />,
      },
      {
        key: "access",
        header: copy.access,
        width: 285,
        value: (row) => accessNames(row, t).join(", ") || t.memberNoRoles,
      },
      {
        key: "responsible",
        header: copy.responsibility,
        width: 186,
        value: (row) => (row.responsible ? copy.responsible : "—"),
      },
    ],
    [copy, t, companyId, principalId, cursor],
  );
  return (
    <section
      className="members-workspace"
      aria-labelledby="company-members-title"
    >
      <header className="members-header">
        <div>
          <h2 id="company-members-title">{t.membersTitle}</h2>
          <p className="hint">{t.membersLead}</p>
        </div>
        {canInvite && !memberId && (
          <Link
            className="button-link button-primary members-invite"
            to="/companies/$companyId"
            params={{ companyId }}
            search={{ view: "invitations" }}
          >
            <NavigationIcon name="invitations" /> {t.inviteTitle}
          </Link>
        )}
      </header>
      {members.isPending ? (
        <p>{t.loading}</p>
      ) : members.isError ? (
        <div role="alert" className="notice notice-error">
          {describe(members.error, t, "read")}
          <Button onClick={() => void members.refetch()}>{t.reload}</Button>
        </div>
      ) : (
        <>
          {!memberId && (
            <>
              <div className="members-controls">
                <TextField
                  label={copy.search}
                  placeholder={copy.searchPlaceholder}
                  type="search"
                  maxLength={120}
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                />
                <div className="ui-field">
                  <label htmlFor="members-status">{copy.status}</label>
                  <select
                    id="members-status"
                    className="ui-field-control"
                    value={status}
                    onChange={(event) =>
                      setStatus(event.target.value as typeof status)
                    }
                  >
                    <option value="all">{copy.allStatuses}</option>
                    {(["ACTIVE", "SUSPENDED", "REMOVED"] as const).map(
                      (value) => (
                        <option value={value} key={value}>
                          {t.memberStatuses[value]}
                        </option>
                      ),
                    )}
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
              <p className="hint members-count" role="status">
                {copy.pageResults(rows.length, items.length)}
              </p>
            </>
          )}
          <div className="members-dataset">
            <DataSet
              label={copy.listLabel}
              locale={locale}
              mode={memberId ? "form" : "grid"}
              rows={rows}
              columns={columns}
              rowId={(row) => row.id}
              selectedId={
                rows.some((row) => row.id === selectedId)
                  ? selectedId
                  : undefined
              }
              onSelect={
                memberId
                  ? undefined
                  : (id) => {
                      selection.current = id;
                      setSelectedId(id);
                    }
              }
              onModeChange={
                memberId || rows.length === 0
                  ? undefined
                  : () => {
                      const row =
                        rows.find((item) => item.id === selection.current) ??
                        rows[0];
                      openMember(row.id);
                    }
              }
              onRefresh={memberId ? undefined : () => void members.refetch()}
              refreshing={members.isFetching}
              empty={
                <p className="empty-state">
                  {items.length ? copy.noResults : t.membersEmpty}
                </p>
              }
            >
              {detail ? (
                <MemberDetail
                  key={detail.id}
                  {...{
                    companyId,
                    principalId,
                    viewerResponsible,
                    transferPending,
                    returnTo,
                    cursor,
                    locale,
                    t,
                  }}
                  member={detail}
                />
              ) : (
                <>
                  <p className="empty-state">{copy.noDetail}</p>
                  <Link
                    to="/companies/$companyId"
                    params={{ companyId }}
                    search={{ view: "members", cursor }}
                  >
                    {copy.back}
                  </Link>
                </>
              )}
            </DataSet>
          </div>
        </>
      )}
      {!memberId && (cursor || members.data?.nextCursor) && (
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
      )}
    </section>
  );
}
