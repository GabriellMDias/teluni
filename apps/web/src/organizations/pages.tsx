import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  useIsFetching,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ApiFailure } from "../api-client.js";
import { DataSet } from "../components.js";
import type { DataSetMode } from "../dataset.js";
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
  type CompanyWithAccess,
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

type CompanyValues = Pick<
  Company,
  "displayName" | "defaultLocale" | "timeZone"
>;

/** The company settings fields shared by creation and administration forms. */
function CompanyFields({
  idPrefix,
  values,
  zones,
  disabled = false,
  onChange,
}: {
  idPrefix: string;
  values: CompanyValues;
  zones: readonly string[];
  disabled?: boolean;
  onChange: (values: CompanyValues) => void;
}) {
  const { t } = useOrganizationMessages();
  return (
    <>
      <label htmlFor={`${idPrefix}-name`}>{t.fieldCompanyName}</label>
      <input
        id={`${idPrefix}-name`}
        required
        maxLength={120}
        value={values.displayName}
        disabled={disabled}
        onChange={(event) =>
          onChange({ ...values, displayName: event.target.value })
        }
      />
      <label htmlFor={`${idPrefix}-time-zone`}>{t.fieldTimeZone}</label>
      <select
        id={`${idPrefix}-time-zone`}
        value={values.timeZone}
        disabled={disabled}
        onChange={(event) =>
          onChange({ ...values, timeZone: event.target.value })
        }
      >
        {[...new Set([values.timeZone, ...zones])].map((zone) => (
          <option key={zone} value={zone}>
            {zone}
          </option>
        ))}
      </select>
      <label htmlFor={`${idPrefix}-locale`}>{t.fieldLocale}</label>
      <select
        id={`${idPrefix}-locale`}
        value={values.defaultLocale}
        disabled={disabled}
        onChange={(event) =>
          onChange({ ...values, defaultLocale: event.target.value as Locale })
        }
      >
        {(["pt-BR", "en-US"] as const).map((value) => (
          <option key={value} value={value}>
            {t.localeNames[value]}
          </option>
        ))}
      </select>
    </>
  );
}

function CreateCompanyForm({
  initial,
  onDirtyChange,
}: {
  initial: CompanyValues;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { t } = useOrganizationMessages();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const zones = useMemo(zoneChoices, []);
  const [values, setValues] = useState(initial);
  // Kept until success so a retry after an unknown outcome replays safely.
  const [key, setKey] = useState(() => crypto.randomUUID());
  const dirty = values.displayName !== initial.displayName;
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  const create = useMutation({
    mutationFn: () => createCompany(values, key),
    onSuccess: async ({ company }) => {
      setKey(crypto.randomUUID());
      onDirtyChange(false);
      await queryClient.invalidateQueries({ queryKey: companiesKey });
      await navigate({
        to: "/companies/$companyId",
        params: { companyId: company.id },
      });
    },
  });
  const unknown =
    create.error &&
    (!(create.error instanceof ApiFailure) || create.error.status >= 500);
  return (
    <form
      className="form-stack"
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate();
      }}
      aria-labelledby="company-record-title"
    >
      <h2 id="company-record-title">{t.createTitle}</h2>
      <CompanyFields
        idPrefix="company"
        values={values}
        zones={zones}
        disabled={create.isPending}
        onChange={setValues}
      />
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

/** Loads a company before rendering its form, for editing or duplication. */
function CompanyRecord({
  companyId,
  returnTo,
  children,
}: {
  companyId: string;
  returnTo: string;
  children: (company: CompanyWithAccess) => ReactNode;
}) {
  const { t } = useOrganizationMessages();
  const company = useQuery({
    queryKey: companyKey(companyId),
    queryFn: () => getCompany(companyId),
  });
  if (company.isPending) return <p>{t.loading}</p>;
  if (company.isError)
    return company.error instanceof ApiFailure &&
      company.error.code === "STRONG_AUTHENTICATION_REQUIRED" ? (
      <StepUpPrompt returnTo={returnTo} />
    ) : (
      <Failure
        error={company.error}
        operation="read"
        onReload={() => void company.refetch()}
      />
    );
  return children(company.data);
}

function EditCompanyForm({
  record,
  returnTo,
  onDirtyChange,
}: {
  record: CompanyWithAccess;
  returnTo: string;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { t } = useOrganizationMessages();
  const queryClient = useQueryClient();
  const { company, access } = record;
  const zones = useMemo(zoneChoices, []);
  type Draft = CompanyValues & { expectedVersion: number };
  // Capture the version with the draft; background refetches cannot rebase it.
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => onDirtyChange(draft !== null), [draft, onDirtyChange]);
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
  const canManage = access.capabilities.includes("company.settings.manage");
  const needsStepUp = access.capabilitiesAfterStrongAuthentication.includes(
    "company.settings.manage",
  );
  const mustReload =
    Boolean(save.error) &&
    (!(save.error instanceof ApiFailure) ||
      save.error.status >= 500 ||
      save.error.code === "RESOURCE_VERSION_CONFLICT");
  const values = draft ?? company;
  return (
    <form
      className="form-stack"
      aria-labelledby="company-record-title"
      onSubmit={(event) => {
        event.preventDefault();
        if (draft && !mustReload) save.mutate(draft);
      }}
    >
      <h2 id="company-record-title">{company.displayName}</h2>
      <p className="hint">
        <Link to="/companies/$companyId" params={{ companyId: company.id }}>
          {t.openCompany}
        </Link>
      </p>
      {saved && <p role="status">{t.settingsSaved}</p>}
      {needsStepUp ? (
        <StepUpPrompt returnTo={returnTo} />
      ) : (
        !canManage && <p className="hint">{t.settingsReadOnly}</p>
      )}
      <CompanyFields
        idPrefix="company"
        values={{
          displayName: values.displayName,
          timeZone: values.timeZone,
          defaultLocale: values.defaultLocale,
        }}
        zones={zones}
        disabled={!canManage || save.isPending}
        onChange={(next) => {
          setSaved(false);
          setDraft({
            ...next,
            expectedVersion: draft?.expectedVersion ?? company.version,
          });
        }}
      />
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
      {canManage && (
        <div className="action-group">
          <button
            type="submit"
            className="button-primary"
            disabled={!draft || save.isPending || mustReload}
          >
            {save.isPending ? t.saving : t.save}
          </button>
          <button
            type="button"
            disabled={!draft || save.isPending}
            onClick={() => {
              setDraft(null);
              save.reset();
              if (mustReload) void refresh();
            }}
          >
            {t.cancel}
          </button>
        </div>
      )}
    </form>
  );
}

export type CompaniesSearch = {
  cursor?: string;
  mode?: DataSetMode;
  record?: string;
  copy?: string;
};

export function CompaniesPage({ search }: { search: CompaniesSearch }) {
  const { cursor } = search;
  const { locale, t } = useOrganizationMessages();
  const navigate = useNavigate({ from: "/companies" });
  const queryClient = useQueryClient();
  const session = useQuery(sessionQuery);
  const companies = useQuery({
    queryKey: [...companiesKey, cursor ?? null],
    queryFn: () => listCompanies(cursor),
    enabled: Boolean(session.data),
  });
  const refreshing = useIsFetching({ queryKey: companiesKey }) > 0;
  const [dirty, setDirty] = useState(false);
  const rows = companies.data?.items ?? [];
  // With no company yet, the dataset opens directly on a new record.
  const firstCompany = !cursor && companies.isSuccess && rows.length === 0;
  const mode: DataSetMode = search.mode ?? (firstCompany ? "form" : "grid");
  const index = rows.findIndex((row) => row.id === search.record);
  const record =
    search.record === "new"
      ? "new"
      : index >= 0
        ? rows[index].id
        : mode === "form"
          ? (rows[0]?.id ?? "new")
          : undefined;
  const returnTo = `/companies?${new URLSearchParams(
    Object.entries(search).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  )}`.replace(/\?$/, "");
  const go = (next: Omit<CompaniesSearch, "cursor">, replace = false) => {
    setDirty(false);
    void navigate({
      search: { ...(cursor ? { cursor } : {}), ...next },
      replace,
    });
  };
  const idle = !dirty;
  const select = (id: string) => go({ mode: search.mode, record: id }, true);
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
        <SignInPrompt returnTo={returnTo} />
      ) : (
        <>
          <p>{firstCompany ? t.companiesEmpty : t.companiesLead}</p>
          {companies.isError && (
            <Failure
              error={companies.error}
              operation="read"
              onReload={() => void companies.refetch()}
            />
          )}
          {dirty && <p className="hint">{t.unsavedChanges}</p>}
          {companies.isPending ? (
            <p>{t.loading}</p>
          ) : (
            <DataSet
              label={t.companiesRecords}
              locale={locale}
              mode={mode}
              rows={rows}
              rowId={(row) => row.id}
              columns={[
                {
                  key: "name",
                  header: t.fieldCompanyName,
                  value: (row) => row.displayName,
                  width: 360,
                  render: (row) => (
                    <Link
                      to="/companies/$companyId"
                      params={{ companyId: row.id }}
                    >
                      {row.displayName}
                    </Link>
                  ),
                },
                {
                  key: "roles",
                  header: t.yourAccess,
                  value: (row) =>
                    row.roles.map((role) => t.roles[role]).join(", "),
                  width: 280,
                },
              ]}
              selectedId={record}
              onSelect={idle ? select : undefined}
              onModeChange={
                idle
                  ? (next) =>
                      go({
                        mode: next,
                        ...(record ? { record } : {}),
                      })
                  : undefined
              }
              onAdd={
                idle ? () => go({ mode: "form", record: "new" }) : undefined
              }
              onDuplicate={
                idle && record && record !== "new"
                  ? () => go({ mode: "form", record: "new", copy: record })
                  : undefined
              }
              onRefresh={
                idle
                  ? () =>
                      void queryClient.invalidateQueries({
                        queryKey: ["organizations"],
                      })
                  : undefined
              }
              refreshing={refreshing}
              exportName={t.companiesExport}
              empty={
                <p className="empty-state">
                  {cursor ? t.pageEmpty : t.companiesEmpty}
                </p>
              }
            >
              {record === "new" ? (
                search.copy ? (
                  <CompanyRecord
                    key={`copy-${search.copy}`}
                    companyId={search.copy}
                    returnTo={returnTo}
                  >
                    {({ company }) => (
                      <CreateCompanyForm
                        initial={{
                          displayName: t
                            .copyName(company.displayName)
                            .slice(0, 120),
                          timeZone: company.timeZone,
                          defaultLocale: company.defaultLocale,
                        }}
                        onDirtyChange={setDirty}
                      />
                    )}
                  </CompanyRecord>
                ) : (
                  <CreateCompanyForm
                    key="new"
                    initial={{
                      displayName: "",
                      timeZone: zoneChoices()[0],
                      defaultLocale: locale,
                    }}
                    onDirtyChange={setDirty}
                  />
                )
              ) : (
                record && (
                  <CompanyRecord
                    key={record}
                    companyId={record}
                    returnTo={returnTo}
                  >
                    {(data) => (
                      <EditCompanyForm
                        record={data}
                        returnTo={returnTo}
                        onDirtyChange={setDirty}
                      />
                    )}
                  </CompanyRecord>
                )
              )}
            </DataSet>
          )}
          {mode === "grid" && (
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
          )}
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
  type Draft = CompanyValues & { expectedVersion: number };
  // Capture the version with the draft; background refetches cannot rebase it.
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState(false);
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
          <CompanyFields
            idPrefix="settings"
            values={draft}
            zones={zoneChoices()}
            disabled={save.isPending}
            onChange={(values) => setDraft({ ...draft, ...values })}
          />
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
  accessScope,
  cursor,
}: {
  companyId: string;
  principalId: string;
  /** Administrators read every event; branch managers only their branches'. */
  administrator: boolean;
  /** Identifies the viewer's current access, so pages never cross scopes. */
  accessScope: string;
  cursor?: string;
}) {
  const { locale, t } = useOrganizationMessages();
  // Pages are cached per access scope and dropped once the view closes, so a
  // narrowed access never renders events read under a wider one.
  const events = useQuery({
    queryKey: [...auditKey(companyId), accessScope, cursor ?? null],
    queryFn: () => listAuditEvents(companyId, cursor),
    gcTime: 0,
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
        <h1>{t.companyUnavailableTitle}</h1>
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
            accessScope={JSON.stringify([
              access.roles,
              access.profiles,
              access.capabilities,
            ])}
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
