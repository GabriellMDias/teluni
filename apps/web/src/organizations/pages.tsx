import { useMemo, useState, type FormEvent } from "react";
import {
  useIsFetching,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ApiFailure } from "../api-client.js";
import { loginHref, sessionQuery } from "../identity/api.js";
import { browserLocale, type Locale } from "../locale.js";
import {
  archiveBranch,
  auditKey,
  branchesKey,
  companiesKey,
  companyKey,
  createBranch,
  createCompany,
  describe,
  getCompany,
  listBranches,
  listCompanies,
  listAuditEvents,
  renameBranch,
  updateCompany,
  type Branch,
  type Company,
} from "./api.js";
import { organizationMessages, timeZoneChoices } from "./messages.js";
import { CompanyMembers, formatInstant } from "./members.js";
import { CompanyInvitations } from "./invitations.js";
import { CompanyProfiles } from "./profiles.js";
import { ResponsibilityTransferNotice } from "./responsibility.js";

export function useOrganizationMessages() {
  const locale = useMemo(browserLocale, []);
  return { locale, t: organizationMessages[locale] };
}

function Failure({
  error,
  operation,
  onReload,
}: {
  error: unknown;
  operation: "read" | "write";
  onReload?: () => void;
}) {
  const { t } = useOrganizationMessages();
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

function SignInPrompt({ returnTo }: { returnTo: string }) {
  const { t } = useOrganizationMessages();
  return (
    <>
      <p>{t.signInRequired}</p>
      <a className="button-link button-primary" href={loginHref(returnTo)}>
        {t.signIn}
      </a>
    </>
  );
}

function StepUpPrompt({ returnTo }: { returnTo: string }) {
  const { t } = useOrganizationMessages();
  return (
    <div role="status" className="notice notice-error">
      {t.stepUpNotice}
      <a
        className="button-link button-primary"
        href={loginHref(returnTo, "strong")}
      >
        {t.stepUpButton}
      </a>
    </div>
  );
}

function zoneChoices(): string[] {
  const own = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return timeZoneChoices.includes(own)
    ? [...timeZoneChoices]
    : [own, ...timeZoneChoices];
}

function CreateCompanyForm() {
  const { locale, t } = useOrganizationMessages();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const zones = useMemo(zoneChoices, []);
  const [displayName, setDisplayName] = useState("");
  const [timeZone, setTimeZone] = useState(zones[0]);
  const [defaultLocale, setDefaultLocale] = useState<Locale>(locale);
  // Kept until success so a retry after an unknown outcome replays safely.
  const [key, setKey] = useState(() => crypto.randomUUID());
  const create = useMutation({
    mutationFn: () =>
      createCompany({ displayName, defaultLocale, timeZone }, key),
    onSuccess: async ({ company }) => {
      setKey(crypto.randomUUID());
      await queryClient.invalidateQueries({ queryKey: companiesKey });
      await navigate({
        to: "/companies/$companyId",
        params: { companyId: company.id },
      });
    },
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate();
  }
  const unknown =
    create.error &&
    (!(create.error instanceof ApiFailure) || create.error.status >= 500);
  return (
    <form
      className="form-stack"
      onSubmit={submit}
      aria-labelledby="create-company-title"
    >
      <h2 id="create-company-title">{t.createTitle}</h2>
      <label htmlFor="company-name">{t.fieldCompanyName}</label>
      <input
        id="company-name"
        required
        maxLength={120}
        value={displayName}
        onChange={(event) => setDisplayName(event.target.value)}
      />
      <label htmlFor="company-time-zone">{t.fieldTimeZone}</label>
      <select
        id="company-time-zone"
        value={timeZone}
        onChange={(event) => setTimeZone(event.target.value)}
      >
        {zones.map((zone) => (
          <option key={zone} value={zone}>
            {zone}
          </option>
        ))}
      </select>
      <label htmlFor="company-locale">{t.fieldLocale}</label>
      <select
        id="company-locale"
        value={defaultLocale}
        onChange={(event) => setDefaultLocale(event.target.value as Locale)}
      >
        {(["pt-BR", "en-US"] as const).map((value) => (
          <option key={value} value={value}>
            {t.localeNames[value]}
          </option>
        ))}
      </select>
      {create.error &&
        (unknown ? (
          <div role="alert" className="notice notice-error">
            {t.unknownCreate}
          </div>
        ) : (
          <Failure error={create.error} operation="write" />
        ))}
      <button
        type="submit"
        className="button-primary"
        disabled={create.isPending}
      >
        {create.isPending ? t.creating : t.createCompany}
      </button>
    </form>
  );
}

export function CompaniesPage({ cursor }: { cursor?: string }) {
  const { locale, t } = useOrganizationMessages();
  const session = useQuery(sessionQuery);
  const companies = useQuery({
    queryKey: [...companiesKey, cursor ?? null],
    queryFn: () => listCompanies(cursor),
    enabled: Boolean(session.data),
  });
  return (
    <section
      className="panel organization-panel"
      aria-labelledby="companies-title"
      lang={locale}
    >
      <p className="eyebrow">{t.companiesEyebrow}</p>
      <h1 id="companies-title">{t.companiesTitle}</h1>
      {session.isPending ? (
        <p>{t.loading}</p>
      ) : session.isError ? (
        <Failure
          error={session.error}
          operation="read"
          onReload={() => void session.refetch()}
        />
      ) : !session.data ? (
        <SignInPrompt
          returnTo={`/companies${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`}
        />
      ) : (
        <>
          <p>{t.companiesLead}</p>
          {companies.isPending ? (
            <p>{t.loading}</p>
          ) : companies.isError ? (
            <Failure
              error={companies.error}
              operation="read"
              onReload={() => void companies.refetch()}
            />
          ) : companies.data.items.length === 0 ? (
            <p className="empty-state">
              {cursor ? t.pageEmpty : t.companiesEmpty}
            </p>
          ) : (
            <ul className="organization-list">
              {companies.data.items.map((company) => (
                <li key={company.id}>
                  <Link
                    to="/companies/$companyId"
                    params={{ companyId: company.id }}
                  >
                    {company.displayName}
                  </Link>
                  <span className="hint">
                    {company.roles.map((role) => t.roles[role]).join(", ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <nav className="pagination" aria-label={t.companiesTitle}>
            {cursor && (
              <Link to="/companies" search={{}}>
                {t.firstPage}
              </Link>
            )}
            {companies.data?.nextCursor && (
              <Link
                to="/companies"
                search={{ cursor: companies.data.nextCursor }}
              >
                {t.nextPage}
              </Link>
            )}
          </nav>
          <CreateCompanyForm />
        </>
      )}
    </section>
  );
}

function BranchRow({
  companyId,
  branch,
  manage,
}: {
  companyId: string;
  branch: Branch;
  manage: boolean;
}) {
  const { t } = useOrganizationMessages();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(branch.name);
  const [editingVersion, setEditingVersion] = useState(branch.version);
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: branchesKey(companyId) }),
      queryClient.invalidateQueries({ queryKey: auditKey(companyId) }),
    ]);
  const rename = useMutation({
    mutationFn: () =>
      renameBranch(companyId, { ...branch, version: editingVersion }, name),
    onSuccess: async () => {
      setEditing(false);
      await refresh();
    },
  });
  const archive = useMutation({
    mutationFn: () => archiveBranch(companyId, branch),
    onSuccess: refresh,
  });
  const error = rename.error ?? archive.error;
  async function reload() {
    await refresh();
    setEditing(false);
    rename.reset();
    archive.reset();
  }
  return (
    <li className="branch-item">
      {editing ? (
        <form
          className="branch-edit"
          onSubmit={(event) => {
            event.preventDefault();
            rename.mutate();
          }}
        >
          <label htmlFor={`branch-name-${branch.id}`}>
            {t.fieldBranchName}
          </label>
          <input
            id={`branch-name-${branch.id}`}
            required
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <button
            type="submit"
            className="button-primary"
            disabled={rename.isPending}
          >
            {t.save}
          </button>
          <button type="button" onClick={() => setEditing(false)}>
            {t.cancel}
          </button>
        </form>
      ) : (
        <div>
          <strong>{branch.name}</strong>{" "}
          <span className="hint">
            {branch.status === "ACTIVE" ? t.statusActive : t.statusArchived} ·{" "}
            {branch.timeZone}
          </span>
        </div>
      )}
      {manage && branch.status === "ACTIVE" && !editing && (
        <div className="action-group">
          <button
            type="button"
            aria-label={`${t.rename}: ${branch.name}`}
            onClick={() => {
              setName(branch.name);
              setEditingVersion(branch.version);
              rename.reset();
              setEditing(true);
            }}
          >
            {t.rename}
          </button>
          <button
            type="button"
            aria-label={`${t.archive}: ${branch.name}`}
            onClick={() => archive.mutate()}
            disabled={archive.isPending}
          >
            {t.archive}
          </button>
        </div>
      )}
      {error && (
        <Failure
          error={error}
          operation="write"
          onReload={() => void reload()}
        />
      )}
    </li>
  );
}

function Branches({
  companyId,
  manage,
  cursor,
}: {
  companyId: string;
  manage: boolean;
  cursor?: string;
}) {
  const { t } = useOrganizationMessages();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const branches = useQuery({
    queryKey: [...branchesKey(companyId), { cursor }],
    queryFn: () => listBranches(companyId, cursor),
  });
  const add = useMutation({
    mutationFn: () => createBranch(companyId, name),
    onSuccess: async () => {
      setName("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: branchesKey(companyId) }),
        queryClient.invalidateQueries({ queryKey: auditKey(companyId) }),
      ]);
    },
  });
  const items = branches.data?.items ?? [];
  return (
    <section aria-labelledby="branches-title">
      <h2 id="branches-title">{t.branchesTitle}</h2>
      {branches.isPending ? (
        <p>{t.loading}</p>
      ) : branches.isError ? (
        <Failure
          error={branches.error}
          operation="read"
          onReload={() => void branches.refetch()}
        />
      ) : items.length === 0 ? (
        <p className="empty-state">{t.branchesEmpty}</p>
      ) : (
        <ul className="branch-list">
          {items.map((branch) => (
            <BranchRow
              key={branch.id}
              companyId={companyId}
              branch={branch}
              manage={manage}
            />
          ))}
        </ul>
      )}
      <nav className="pagination" aria-label={t.branchesTitle}>
        {cursor && (
          <Link to="/companies/$companyId" params={{ companyId }} search={{}}>
            {t.firstPage}
          </Link>
        )}
        {branches.data?.nextCursor && (
          <Link
            to="/companies/$companyId"
            params={{ companyId }}
            search={{ cursor: branches.data.nextCursor }}
          >
            {t.nextPage}
          </Link>
        )}
      </nav>
      {manage && (
        <form
          className="form-stack branch-create"
          onSubmit={(event) => {
            event.preventDefault();
            add.mutate();
          }}
        >
          <label htmlFor="new-branch-name">{t.fieldBranchName}</label>
          <input
            id="new-branch-name"
            required
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          {add.error && (
            <Failure
              error={add.error}
              operation="write"
              onReload={() =>
                void queryClient.invalidateQueries({
                  queryKey: branchesKey(companyId),
                })
              }
            />
          )}
          <button
            type="submit"
            className="button-primary"
            disabled={add.isPending}
          >
            {add.isPending ? t.adding : t.addBranch}
          </button>
        </form>
      )}
    </section>
  );
}

function CompanySettings({ company }: { company: Company }) {
  const { t } = useOrganizationMessages();
  const queryClient = useQueryClient();
  const refreshing = useIsFetching({ queryKey: companyKey(company.id) }) > 0;
  type Draft = Pick<Company, "displayName" | "defaultLocale" | "timeZone"> & {
    expectedVersion: number;
  };
  // Capture the version with the draft; background refetches cannot rebase it.
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState(false);
  const zones = [...new Set([company.timeZone, ...zoneChoices()])];
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: companyKey(company.id) }),
      queryClient.invalidateQueries({ queryKey: companiesKey }),
      queryClient.invalidateQueries({ queryKey: auditKey(company.id) }),
    ]);
  const save = useMutation({
    mutationFn: (input: Draft) => updateCompany(company.id, input),
    onSuccess: async () => {
      setDraft(null);
      setSaved(true);
      await refresh();
    },
  });
  const mustReload =
    Boolean(save.error) &&
    (!(save.error instanceof ApiFailure) ||
      save.error.status >= 500 ||
      save.error.code === "RESOURCE_VERSION_CONFLICT");
  return (
    <section aria-labelledby="company-settings-title">
      <h2 id="company-settings-title">{t.settingsTitle}</h2>
      {saved && <p role="status">{t.settingsSaved}</p>}
      {draft ? (
        <form
          className="form-stack"
          onSubmit={(event) => {
            event.preventDefault();
            if (!mustReload) save.mutate(draft);
          }}
        >
          <label htmlFor="settings-name">{t.fieldCompanyName}</label>
          <input
            id="settings-name"
            required
            maxLength={120}
            value={draft.displayName}
            disabled={save.isPending}
            onChange={(event) =>
              setDraft({ ...draft, displayName: event.target.value })
            }
          />
          <label htmlFor="settings-time-zone">{t.fieldTimeZone}</label>
          <select
            id="settings-time-zone"
            value={draft.timeZone}
            disabled={save.isPending}
            onChange={(event) =>
              setDraft({ ...draft, timeZone: event.target.value })
            }
          >
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
          <label htmlFor="settings-locale">{t.fieldLocale}</label>
          <select
            id="settings-locale"
            value={draft.defaultLocale}
            disabled={save.isPending}
            onChange={(event) =>
              setDraft({
                ...draft,
                defaultLocale: event.target.value as Locale,
              })
            }
          >
            {(["pt-BR", "en-US"] as const).map((value) => (
              <option key={value} value={value}>
                {t.localeNames[value]}
              </option>
            ))}
          </select>
          {save.error && (
            <Failure
              error={save.error}
              operation="write"
              onReload={() => {
                setDraft(null);
                save.reset();
                void refresh();
              }}
            />
          )}
          <div className="action-group">
            <button
              type="submit"
              className="button-primary"
              disabled={save.isPending || mustReload}
            >
              {save.isPending ? t.saving : t.save}
            </button>
            <button
              type="button"
              disabled={save.isPending}
              onClick={() => {
                setDraft(null);
                save.reset();
                if (mustReload) void refresh();
              }}
            >
              {t.cancel}
            </button>
          </div>
        </form>
      ) : (
        <>
          <dl className="company-settings">
            <dt>{t.fieldCompanyName}</dt>
            <dd>{company.displayName}</dd>
            <dt>{t.fieldTimeZone}</dt>
            <dd>{company.timeZone}</dd>
            <dt>{t.fieldLocale}</dt>
            <dd>{t.localeNames[company.defaultLocale]}</dd>
          </dl>
          <button
            type="button"
            disabled={refreshing}
            onClick={() => {
              setSaved(false);
              save.reset();
              setDraft({
                displayName: company.displayName,
                timeZone: company.timeZone,
                defaultLocale: company.defaultLocale,
                expectedVersion: company.version,
              });
            }}
          >
            {t.editSettings}
          </button>
        </>
      )}
    </section>
  );
}

function CompanyHistory({
  companyId,
  principalId,
  administrator,
  cursor,
}: {
  companyId: string;
  principalId: string;
  /** Administrators read every event; branch managers only their branches'. */
  administrator: boolean;
  cursor?: string;
}) {
  const { locale, t } = useOrganizationMessages();
  const events = useQuery({
    queryKey: [...auditKey(companyId), cursor ?? null],
    queryFn: () => listAuditEvents(companyId, cursor),
  });
  return (
    <section aria-labelledby="company-history-title">
      <h2 id="company-history-title">{t.historyTitle}</h2>
      <p>{administrator ? t.historyLead : t.historyLeadBranches}</p>
      {events.isPending ? (
        <p>{t.loading}</p>
      ) : events.isError ? (
        <Failure
          error={events.error}
          operation="read"
          onReload={() => void events.refetch()}
        />
      ) : events.data.items.length === 0 ? (
        <p className="empty-state">{t.historyEmpty}</p>
      ) : (
        <ol className="audit-list">
          {events.data.items.map((event) => {
            const fields = Array.isArray(event.details.fields)
              ? event.details.fields
                  .filter((field): field is string => typeof field === "string")
                  .map(
                    (field) =>
                      t.historyFields[
                        event.targetType === "access_profile" &&
                        field === "name"
                          ? "profileName"
                          : field
                      ],
                  )
                  .filter((field): field is string => typeof field === "string")
              : [];
            const action = t.historyActions[event.action];
            return (
              <li key={event.id}>
                <strong>
                  {typeof action === "string" ? action : t.historyUnknown}
                </strong>
                {typeof event.details.role === "string" &&
                  Object.hasOwn(t.roles, event.details.role) && (
                    <span>
                      {t.historyRole}:{" "}
                      {t.roles[event.details.role as keyof typeof t.roles]}
                    </span>
                  )}
                {typeof event.details.profileName === "string" && (
                  <span>
                    {t.historyProfile}: {event.details.profileName}
                  </span>
                )}
                {event.targetType === "branch" &&
                  typeof event.details.branchName === "string" && (
                    <span>
                      {t.fieldBranchName}: {event.details.branchName}
                    </span>
                  )}
                <span className="hint">
                  <time dateTime={event.occurredAt}>
                    {formatInstant(locale, event.occurredAt)}
                  </time>
                  {` · ${event.actorPrincipalId === principalId ? t.historyYou : t.historyMember}`}
                </span>
                {fields.length > 0 && <span>{fields.join(", ")}</span>}
              </li>
            );
          })}
        </ol>
      )}
      <nav className="pagination" aria-label={t.historyTitle}>
        {cursor && (
          <Link
            to="/companies/$companyId"
            params={{ companyId }}
            search={{ view: "history" }}
          >
            {t.firstPage}
          </Link>
        )}
        {events.data?.nextCursor && (
          <Link
            to="/companies/$companyId"
            params={{ companyId }}
            search={{ view: "history", cursor: events.data.nextCursor }}
          >
            {t.nextPage}
          </Link>
        )}
      </nav>
    </section>
  );
}

export function CompanyPage({
  companyId,
  cursor,
  view,
}: {
  companyId: string;
  cursor?: string;
  view?: "settings" | "history" | "members" | "invitations" | "profiles";
}) {
  const { locale, t } = useOrganizationMessages();
  const session = useQuery(sessionQuery);
  const company = useQuery({
    queryKey: companyKey(companyId),
    queryFn: () => getCompany(companyId),
    enabled: Boolean(session.data),
  });
  const search = new URLSearchParams({
    ...(view ? { view } : {}),
    ...(cursor ? { cursor } : {}),
  });
  const returnTo = `/companies/${companyId}${search.size ? `?${search}` : ""}`;
  if (session.isPending) return <p>{t.loading}</p>;
  if (session.isError)
    return (
      <section className="panel organization-panel" lang={locale}>
        <Failure
          error={session.error}
          operation="read"
          onReload={() => void session.refetch()}
        />
      </section>
    );
  if (!session.data)
    return (
      <section className="panel organization-panel" lang={locale}>
        <SignInPrompt returnTo={returnTo} />
      </section>
    );
  if (company.isPending) return <p>{t.loading}</p>;
  if (company.isError)
    return (
      <section className="panel organization-panel" lang={locale}>
        {company.error instanceof ApiFailure &&
        company.error.code === "STRONG_AUTHENTICATION_REQUIRED" ? (
          <StepUpPrompt returnTo={returnTo} />
        ) : (
          <Failure
            error={company.error}
            operation="read"
            onReload={() => void company.refetch()}
          />
        )}
        <Link to="/companies">{t.backToCompanies}</Link>
      </section>
    );
  const { access, responsibilityTransfer: transfer } = company.data;
  const needsStepUp = access.capabilitiesAfterStrongAuthentication.length > 0;
  const canView = access.capabilities.includes("branches.view");
  return (
    <section
      className="panel organization-panel"
      aria-labelledby="company-title"
      lang={locale}
    >
      <p className="eyebrow">
        <Link to="/companies">{t.companiesTitle}</Link>
      </p>
      <h1 id="company-title">{company.data.company.displayName}</h1>
      <p className="hint">
        {t.yourAccess}:{" "}
        {[
          ...access.roles.map((role) => t.roles[role]),
          ...access.profiles,
        ].join(", ")}
        {access.responsible ? ` · ${t.responsible}` : ""}
      </p>
      {needsStepUp && <StepUpPrompt returnTo={returnTo} />}
      {transfer && (
        <ResponsibilityTransferNotice
          key={transfer.id}
          companyId={companyId}
          transfer={transfer}
          returnTo={returnTo}
          locale={locale}
          t={t}
        />
      )}
      <nav
        className="company-navigation"
        aria-label={company.data.company.displayName}
      >
        {canView && (
          <Link
            to="/companies/$companyId"
            params={{ companyId }}
            search={{}}
            aria-current={!view ? "page" : undefined}
          >
            {t.branchesTitle}
          </Link>
        )}
        {access.capabilities.includes("company.settings.manage") && (
          <Link
            to="/companies/$companyId"
            params={{ companyId }}
            search={{ view: "settings" }}
            aria-current={view === "settings" ? "page" : undefined}
          >
            {t.settingsTitle}
          </Link>
        )}
        {access.capabilities.includes("members.manage") && (
          <Link
            to="/companies/$companyId"
            params={{ companyId }}
            search={{ view: "members" }}
            aria-current={view === "members" ? "page" : undefined}
          >
            {t.membersTitle}
          </Link>
        )}
        {access.capabilities.includes("members.manage") && (
          <Link
            to="/companies/$companyId"
            params={{ companyId }}
            search={{ view: "profiles" }}
            aria-current={view === "profiles" ? "page" : undefined}
          >
            {t.profilesTitle}
          </Link>
        )}
        {access.capabilities.includes("invitations.manage") && (
          <Link
            to="/companies/$companyId"
            params={{ companyId }}
            search={{ view: "invitations" }}
            aria-current={view === "invitations" ? "page" : undefined}
          >
            {t.invitationsTitle}
          </Link>
        )}
        {access.capabilities.includes("audit.view") && (
          <Link
            to="/companies/$companyId"
            params={{ companyId }}
            search={{ view: "history" }}
            aria-current={view === "history" ? "page" : undefined}
          >
            {t.historyTitle}
          </Link>
        )}
      </nav>
      {view === "members" ? (
        access.capabilities.includes("members.manage") ? (
          <CompanyMembers
            companyId={companyId}
            principalId={session.data.principalId}
            viewerResponsible={access.responsible}
            transferPending={Boolean(transfer)}
            cursor={cursor}
            returnTo={returnTo}
            locale={locale}
            t={t}
          />
        ) : (
          <p role="alert" className="notice notice-error">
            {t.errors.PERMISSION_DENIED}
          </p>
        )
      ) : view === "profiles" ? (
        access.capabilities.includes("members.manage") ? (
          <CompanyProfiles companyId={companyId} returnTo={returnTo} t={t} />
        ) : (
          <p role="alert" className="notice notice-error">
            {t.errors.PERMISSION_DENIED}
          </p>
        )
      ) : view === "invitations" ? (
        access.capabilities.includes("invitations.manage") ? (
          <CompanyInvitations
            companyId={companyId}
            administrator={access.capabilities.includes("members.manage")}
            viewerResponsible={access.responsible}
            cursor={cursor}
            returnTo={returnTo}
            locale={locale}
            t={t}
          />
        ) : (
          <p role="alert" className="notice notice-error">
            {t.errors.PERMISSION_DENIED}
          </p>
        )
      ) : view === "settings" ? (
        access.capabilities.includes("company.settings.manage") ? (
          <CompanySettings company={company.data.company} />
        ) : (
          <p role="alert" className="notice notice-error">
            {t.errors.PERMISSION_DENIED}
          </p>
        )
      ) : view === "history" ? (
        access.capabilities.includes("audit.view") ? (
          <CompanyHistory
            companyId={companyId}
            principalId={session.data.principalId}
            administrator={access.capabilities.includes("members.manage")}
            cursor={cursor}
          />
        ) : (
          <p role="alert" className="notice notice-error">
            {t.errors.PERMISSION_DENIED}
          </p>
        )
      ) : (
        canView && (
          <Branches
            companyId={companyId}
            cursor={cursor}
            manage={access.capabilities.includes("branches.manage")}
          />
        )
      )}
    </section>
  );
}
