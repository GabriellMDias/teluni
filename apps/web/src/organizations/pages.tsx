import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  useIsFetching,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ApiFailure } from "../api-client.js";
import { Button, DataSet, TextField } from "../components.js";
import { NavigationIcon } from "../navigation-icon.js";
import { UiIcon } from "../ui-icon.js";
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
import { CompanyLogoField, CompanyLogoPreview } from "./company-logo.js";
import { BranchLocationField, locationLabel } from "./branch-location.js";
import { organizationMessages } from "./messages.js";
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

type CompanyValues = Pick<
  Company,
  "displayName" | "defaultLocale" | "logoDataUrl"
>;

/** Account identification controls keep the same labels and behavior on both forms. */
function CompanyProfileFields({
  idPrefix,
  values,
  disabled,
  nameRef,
  onChange,
}: {
  idPrefix: string;
  values: CompanyValues;
  disabled: boolean;
  nameRef?: React.Ref<HTMLInputElement>;
  onChange: (change: Partial<CompanyValues>) => void;
}) {
  const { t } = useOrganizationMessages();
  return (
    <>
      <TextField
        id={`${idPrefix}-name`}
        ref={nameRef}
        label={t.fieldCompanyName}
        required
        maxLength={120}
        value={values.displayName}
        disabled={disabled}
        onChange={(event) => onChange({ displayName: event.target.value })}
      />
      <div className="ui-field">
        <label htmlFor={`${idPrefix}-locale`}>{t.fieldLocale}</label>
        <select
          id={`${idPrefix}-locale`}
          className="ui-field-control"
          value={values.defaultLocale}
          disabled={disabled}
          onChange={(event) =>
            onChange({ defaultLocale: event.target.value as Locale })
          }
        >
          {(["pt-BR", "en-US"] as const).map((value) => (
            <option key={value} value={value}>
              {t.localeNames[value]}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}

function CompanyFields({
  idPrefix,
  values,
  disabled = false,
  onChange,
}: {
  idPrefix: string;
  values: CompanyValues;
  disabled?: boolean;
  onChange: (values: CompanyValues) => void;
}) {
  const current = useRef(values);
  current.current = values;
  const update = (change: Partial<CompanyValues>) =>
    onChange({ ...current.current, ...change });
  return (
    <>
      <CompanyProfileFields
        idPrefix={idPrefix}
        values={values}
        disabled={disabled}
        onChange={update}
      />
      <CompanyLogoField
        id={`${idPrefix}-logo`}
        value={values.logoDataUrl ?? null}
        disabled={disabled}
        onChange={(logoDataUrl) => update({ logoDataUrl })}
      />
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
  const [values, setValues] = useState(initial);
  // Kept until success so a retry after an unknown outcome replays safely.
  const [key, setKey] = useState(() => crypto.randomUUID());
  const dirty =
    values.displayName !== initial.displayName ||
    values.defaultLocale !== initial.defaultLocale ||
    values.logoDataUrl !== initial.logoDataUrl;
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
  children,
}: {
  companyId: string;
  children: (company: CompanyWithAccess) => ReactNode;
}) {
  const { t } = useOrganizationMessages();
  const company = useQuery({
    queryKey: companyKey(companyId),
    queryFn: () => getCompany(companyId),
  });
  if (company.isPending) return <p>{t.loading}</p>;
  if (company.isError)
    return (
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
  onDirtyChange,
}: {
  record: CompanyWithAccess;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { t } = useOrganizationMessages();
  const queryClient = useQueryClient();
  const { company, access } = record;
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
      {!canManage && <p className="hint">{t.settingsReadOnly}</p>}
      <CompanyFields
        idPrefix="company"
        values={{
          displayName: values.displayName,
          logoDataUrl: values.logoDataUrl ?? null,
          defaultLocale: values.defaultLocale,
        }}
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
      className="panel organization-panel dataset-panel"
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
                  >
                    {({ company }) => (
                      <CreateCompanyForm
                        initial={{
                          displayName: t
                            .copyName(company.displayName)
                            .slice(0, 120),
                          logoDataUrl: company.logoDataUrl ?? null,
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
                      logoDataUrl: null,
                      defaultLocale: locale,
                    }}
                    onDirtyChange={setDirty}
                  />
                )
              ) : (
                record && (
                  <CompanyRecord key={record} companyId={record}>
                    {(data) => (
                      <EditCompanyForm record={data} onDirtyChange={setDirty} />
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

/** Shared form rows of a branch: its name, and for an existing one its state. */
function BranchFields({
  id,
  name,
  disabled,
  onChange,
  branch,
  location,
  address,
  onLocationChange,
  onAddressChange,
}: {
  id: string;
  name: string;
  disabled: boolean;
  onChange: (name: string) => void;
  branch?: Branch;
  location: Branch["location"];
  address: string;
  onLocationChange: (value: NonNullable<Branch["location"]>) => void;
  onAddressChange: (value: string) => void;
}) {
  const { t } = useOrganizationMessages();
  return (
    <>
      <label htmlFor={id}>{t.fieldBranchName}</label>
      <input
        id={id}
        required
        maxLength={120}
        value={name}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      <label htmlFor={`${id}-address`}>{t.fieldAddress}</label>
      <input
        id={`${id}-address`}
        autoComplete="street-address"
        placeholder={t.addressPlaceholder}
        required={!branch || location !== null}
        maxLength={300}
        value={address}
        disabled={disabled}
        onChange={(event) => onAddressChange(event.target.value)}
      />
      <BranchLocationField
        value={location}
        required={!branch}
        disabled={disabled}
        onChange={onLocationChange}
      />
      {branch && (
        <dl className="company-settings">
          <dt>{t.branchStatus}</dt>
          <dd>
            {branch.status === "ACTIVE" ? t.statusActive : t.statusArchived}
          </dd>
        </dl>
      )}
    </>
  );
}

function CreateBranchForm({
  companyId,
  onDirtyChange,
  onCreated,
  onCancel,
}: {
  companyId: string;
  onDirtyChange: (dirty: boolean) => void;
  onCreated: (branch: Branch) => void;
  onCancel: () => void;
}) {
  const { t } = useOrganizationMessages();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [location, setLocation] = useState<Branch["location"]>(null);
  const [address, setAddress] = useState("");
  useEffect(
    () => onDirtyChange(name !== "" || location !== null || address !== ""),
    [name, location, address, onDirtyChange],
  );
  const add = useMutation({
    mutationFn: () => createBranch(companyId, name, location!, address),
    onSuccess: async (branch) => {
      onDirtyChange(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: branchesKey(companyId) }),
        queryClient.invalidateQueries({ queryKey: auditKey(companyId) }),
      ]);
      onCreated(branch);
    },
  });
  return (
    <form
      className="form-stack branch-create"
      onSubmit={(event) => {
        event.preventDefault();
        if (location) add.mutate();
      }}
    >
      <BranchFields
        id="new-branch-name"
        name={name}
        disabled={add.isPending}
        onChange={setName}
        location={location}
        address={address}
        onLocationChange={setLocation}
        onAddressChange={setAddress}
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
      <div className="action-group">
        <button
          type="submit"
          className="button-primary"
          disabled={add.isPending || !location}
        >
          {add.isPending ? t.adding : t.addBranch}
        </button>
        <button
          type="button"
          disabled={add.isPending}
          onClick={() => {
            setName("");
            setLocation(null);
            setAddress("");
            add.reset();
            onCancel();
          }}
        >
          {t.cancel}
        </button>
      </div>
    </form>
  );
}

function EditBranchForm({
  companyId,
  branch,
  manage,
  onDirtyChange,
}: {
  companyId: string;
  branch: Branch;
  manage: boolean;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { t } = useOrganizationMessages();
  const queryClient = useQueryClient();
  // Capture the version with the draft; background refetches cannot rebase it.
  const [draft, setDraft] = useState<{
    name: string;
    location: Branch["location"];
    address: string;
    version: number;
  } | null>(null);
  useEffect(() => onDirtyChange(draft !== null), [draft, onDirtyChange]);
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: branchesKey(companyId) }),
      queryClient.invalidateQueries({ queryKey: auditKey(companyId) }),
    ]);
  const rename = useMutation({
    mutationFn: (input: {
      name: string;
      location: Branch["location"];
      address: string;
      version: number;
    }) =>
      renameBranch(
        companyId,
        { ...branch, version: input.version },
        input.name,
        input.location ?? undefined,
        input.address,
      ),
    onSuccess: async () => {
      setDraft(null);
      await refresh();
    },
  });
  const archive = useMutation({
    mutationFn: () => archiveBranch(companyId, branch),
    onSuccess: refresh,
  });
  const error = rename.error ?? archive.error;
  const editable = manage && branch.status === "ACTIVE";
  async function reload() {
    setDraft(null);
    rename.reset();
    archive.reset();
    await refresh();
  }
  return (
    <form
      className="form-stack branch-record-form"
      tabIndex={0}
      aria-labelledby="branch-record-title"
      onSubmit={(event) => {
        event.preventDefault();
        if (draft) rename.mutate(draft);
      }}
    >
      <h3 id="branch-record-title">{branch.name}</h3>
      <BranchFields
        id={`branch-name-${branch.id}`}
        name={draft?.name ?? branch.name}
        disabled={!editable || rename.isPending}
        onChange={(name) =>
          setDraft({
            name,
            location: draft?.location ?? branch.location ?? null,
            address: draft?.address ?? branch.address ?? "",
            version: draft?.version ?? branch.version,
          })
        }
        location={draft?.location ?? branch.location ?? null}
        address={draft?.address ?? branch.address ?? ""}
        onLocationChange={(location) =>
          setDraft({
            name: draft?.name ?? branch.name,
            location,
            address: draft?.address ?? branch.address ?? "",
            version: draft?.version ?? branch.version,
          })
        }
        onAddressChange={(address) =>
          setDraft({
            name: draft?.name ?? branch.name,
            location: draft?.location ?? branch.location ?? null,
            address,
            version: draft?.version ?? branch.version,
          })
        }
        branch={branch}
      />
      {!manage && <p className="hint">{t.branchReadOnly}</p>}
      {error && (
        <Failure
          error={error}
          operation="write"
          onReload={() => void reload()}
        />
      )}
      {editable && (
        <div className="action-group">
          <button
            type="submit"
            className="button-primary"
            disabled={!draft || rename.isPending}
          >
            {rename.isPending ? t.saving : t.save}
          </button>
          <button
            type="button"
            disabled={!draft || rename.isPending}
            onClick={() => {
              setDraft(null);
              rename.reset();
            }}
          >
            {t.cancel}
          </button>
          <button
            type="button"
            aria-label={`${t.archive}: ${branch.name}`}
            disabled={archive.isPending || draft !== null}
            onClick={() => archive.mutate()}
          >
            {t.archive}
          </button>
        </div>
      )}
    </form>
  );
}

export type BranchesSearch = {
  cursor?: string;
  mode?: DataSetMode;
  record?: string;
};

function Branches({
  companyId,
  manage,
  search,
}: {
  companyId: string;
  manage: boolean;
  search: BranchesSearch;
}) {
  const { cursor } = search;
  const { locale, t } = useOrganizationMessages();
  const navigate = useNavigate({ from: "/companies/$companyId" });
  const queryClient = useQueryClient();
  const branches = useQuery({
    queryKey: [...branchesKey(companyId), { cursor }],
    queryFn: () => listBranches(companyId, cursor),
  });
  const refreshing = useIsFetching({ queryKey: branchesKey(companyId) }) > 0;
  const [dirty, setDirty] = useState(false);
  const rows = branches.data?.items ?? [];
  // A manager with no branch yet starts on a new record.
  const firstBranch =
    manage && !cursor && branches.isSuccess && rows.length === 0;
  const mode: DataSetMode = search.mode ?? (firstBranch ? "form" : "grid");
  const index = rows.findIndex((row) => row.id === search.record);
  const record =
    search.record === "new" && manage
      ? "new"
      : index >= 0
        ? rows[index].id
        : mode === "form"
          ? (rows[0]?.id ?? (manage ? "new" : undefined))
          : undefined;
  const go = (next: Omit<BranchesSearch, "cursor">, replace = false) => {
    setDirty(false);
    void navigate({
      search: { ...(cursor ? { cursor } : {}), ...next },
      replace,
    });
  };
  // Pin the first branch's form in the URL, so it survives the branch it adds.
  useEffect(() => {
    if (firstBranch && !search.mode)
      void navigate({ search: { mode: "form", record: "new" }, replace: true });
  }, [firstBranch, search.mode, navigate]);
  const idle = !dirty;
  const selected = rows.find((row) => row.id === record);
  return (
    <section className="dataset-region" aria-labelledby="branches-title">
      <h2 id="branches-title">{t.branchesTitle}</h2>
      {dirty && <p className="hint">{t.unsavedChanges}</p>}
      {branches.isPending ? (
        <p>{t.loading}</p>
      ) : branches.isError ? (
        <Failure
          error={branches.error}
          operation="read"
          onReload={() => void branches.refetch()}
        />
      ) : (
        <DataSet
          label={t.branchesRecords}
          locale={locale}
          mode={mode}
          rows={rows}
          rowId={(row) => row.id}
          columns={[
            {
              key: "name",
              header: t.fieldBranchName,
              value: (row) => row.name,
              width: 320,
            },
            {
              key: "status",
              header: t.branchStatus,
              value: (row) =>
                row.status === "ACTIVE" ? t.statusActive : t.statusArchived,
              width: 160,
            },
            {
              key: "location",
              header: t.fieldLocation,
              value: (row) =>
                row.address ??
                (row.location
                  ? locationLabel(row.location, locale)
                  : t.locationMissing),
              width: 240,
            },
          ]}
          selectedId={record}
          onSelect={
            idle
              ? (id) => go({ mode: search.mode, record: id }, true)
              : undefined
          }
          onModeChange={
            idle
              ? (next) => go({ mode: next, ...(record ? { record } : {}) })
              : undefined
          }
          onAdd={
            idle && manage
              ? () => go({ mode: "form", record: "new" })
              : undefined
          }
          onRefresh={
            idle
              ? () =>
                  void queryClient.invalidateQueries({
                    queryKey: branchesKey(companyId),
                  })
              : undefined
          }
          refreshing={refreshing}
          exportName={t.branchesExport}
          empty={
            <p className="empty-state">
              {cursor ? t.pageEmpty : t.branchesEmpty}
            </p>
          }
        >
          {record === "new" ? (
            <CreateBranchForm
              companyId={companyId}
              onDirtyChange={setDirty}
              onCreated={(branch) => go({ record: branch.id })}
              onCancel={() => go({ mode: "grid" })}
            />
          ) : (
            selected && (
              <EditBranchForm
                key={selected.id}
                companyId={companyId}
                branch={selected}
                manage={manage}
                onDirtyChange={setDirty}
              />
            )
          )}
        </DataSet>
      )}
      {mode === "grid" && (
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
      )}
    </section>
  );
}

function CompanySettings({
  company,
  capabilities,
}: {
  company: Company;
  capabilities: CompanyWithAccess["access"]["capabilities"];
}) {
  const { locale, t } = useOrganizationMessages();
  const copy = t.settingsWorkspace;
  const queryClient = useQueryClient();
  const refreshing = useIsFetching({ queryKey: companyKey(company.id) }) > 0;
  type Draft = {
    values: CompanyValues;
    baseline: CompanyValues;
    expectedVersion: number;
  };
  // Capture both the initial values and version; a background read cannot rebase a draft.
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const focusAfterChange = useRef<"name" | "edit" | null>(null);
  const editing = draft !== null;
  useEffect(() => {
    if (focusAfterChange.current === "name" && editing) {
      focusAfterChange.current = null;
      nameInput.current?.focus();
    }
    if (focusAfterChange.current === "edit" && !editing && !refreshing) {
      focusAfterChange.current = null;
      editButton.current?.focus();
    }
  }, [editing, refreshing]);
  const refreshRelated = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: companiesKey }),
      queryClient.invalidateQueries({ queryKey: auditKey(company.id) }),
    ]);
  const closeDraft = () => {
    focusAfterChange.current = "edit";
    setDraft(null);
  };
  const save = useMutation({
    mutationFn: ({ values, expectedVersion }: Draft) =>
      updateCompany(company.id, { ...values, expectedVersion }),
    onSuccess: async () => {
      closeDraft();
      setSaved(true);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: companyKey(company.id) }),
        refreshRelated(),
      ]);
    },
  });
  const reload = useMutation({
    mutationFn: () => getCompany(company.id),
    onSuccess: async (latest) => {
      queryClient.setQueryData<CompanyWithAccess>(
        companyKey(company.id),
        (current) =>
          current && current.company.version > latest.company.version
            ? current
            : latest,
      );
      closeDraft();
      save.reset();
      await refreshRelated();
    },
    onError: (error) => {
      if (error instanceof ApiFailure && [401, 403, 404].includes(error.status))
        void queryClient.invalidateQueries({
          queryKey: companyKey(company.id),
        });
    },
  });
  const mustReload =
    Boolean(save.error) &&
    (!(save.error instanceof ApiFailure) ||
      save.error.status >= 500 ||
      save.error.code === "RESOURCE_VERSION_CONFLICT");
  const blocked = save.isPending || mustReload || reload.isPending;
  const dirty =
    draft &&
    (draft.values.displayName !== draft.baseline.displayName ||
      draft.values.defaultLocale !== draft.baseline.defaultLocale ||
      draft.values.logoDataUrl !== draft.baseline.logoDataUrl);
  const canSave = !!(dirty && draft?.values.displayName.trim()) && !blocked;
  const update = (change: Partial<CompanyValues>) =>
    setDraft(
      (current) =>
        current && { ...current, values: { ...current.values, ...change } },
    );
  const links = (
    [
      {
        allowed: capabilities.includes("branches.view"),
        view: undefined,
        icon: "branches",
        title: t.branchesTitle,
        detail: copy.branches,
      },
      {
        allowed: capabilities.includes("members.manage"),
        view: "members",
        icon: "members",
        title: t.membersTitle,
        detail: copy.members,
      },
      {
        allowed: capabilities.includes("audit.view"),
        view: "history",
        icon: "history",
        title: t.historyTitle,
        detail: copy.history,
      },
    ] as const
  ).filter((link) => link.allowed);

  return (
    <section
      className="company-settings-workspace"
      aria-labelledby="company-settings-title"
    >
      <header className="company-settings-toolbar">
        <div>
          <h2 id="company-settings-title">{t.settingsTitle}</h2>
          <p className="hint">{copy.lead}</p>
        </div>
        {!draft && (
          <Button
            ref={editButton}
            variant="primary"
            disabled={refreshing}
            onClick={() => {
              const values: CompanyValues = {
                displayName: company.displayName,
                logoDataUrl: company.logoDataUrl ?? null,
                defaultLocale: company.defaultLocale,
              };
              setSaved(false);
              save.reset();
              reload.reset();
              focusAfterChange.current = "name";
              setDraft({
                values,
                baseline: values,
                expectedVersion: company.version,
              });
            }}
          >
            <NavigationIcon name="settings" /> {t.editSettings}
          </Button>
        )}
      </header>
      {saved && (
        <p className="notice notice-success" role="status">
          {t.settingsSaved}
        </p>
      )}
      <form
        id="company-settings-form"
        aria-label={t.settingsTitle}
        onSubmit={(event) => {
          event.preventDefault();
          if (canSave && draft) save.mutate(draft);
        }}
      >
        <div className="company-settings-grid">
          <section
            className="company-settings-card"
            aria-labelledby="company-profile-title"
          >
            <div className="company-settings-card-heading">
              <span className="company-settings-icon">
                <NavigationIcon name="companies" />
              </span>
              <div>
                <h3 id="company-profile-title">{copy.profileTitle}</h3>
                <p className="hint">{copy.profileLead}</p>
              </div>
            </div>
            {draft ? (
              <div className="company-settings-fields">
                <CompanyProfileFields
                  idPrefix="settings"
                  nameRef={nameInput}
                  values={draft.values}
                  disabled={blocked}
                  onChange={update}
                />
              </div>
            ) : (
              <dl className="company-settings-facts">
                <div>
                  <dt>{t.fieldCompanyName}</dt>
                  <dd>{company.displayName}</dd>
                </div>
                <div>
                  <dt>{t.fieldLocale}</dt>
                  <dd>{t.localeNames[company.defaultLocale]}</dd>
                </div>
              </dl>
            )}
          </section>
          <section
            className="company-settings-card"
            aria-labelledby="company-brand-title"
          >
            <div className="company-settings-card-heading">
              <span className="company-settings-icon">
                <NavigationIcon name="media" />
              </span>
              <div>
                <h3 id="company-brand-title">{copy.brandTitle}</h3>
                <p className="hint">{copy.brandLead}</p>
              </div>
            </div>
            {draft ? (
              <CompanyLogoField
                id="settings-logo"
                value={draft.values.logoDataUrl ?? null}
                disabled={blocked}
                onChange={(logoDataUrl) => update({ logoDataUrl })}
              />
            ) : (
              <div className="company-settings-logo">
                <CompanyLogoPreview value={company.logoDataUrl ?? null} />
                <div>
                  <strong>
                    {company.logoDataUrl ? t.fieldLogo : copy.noLogo}
                  </strong>
                  <p className="hint">
                    {company.logoDataUrl ? copy.savedLogo : copy.noLogoLead}
                  </p>
                </div>
              </div>
            )}
          </section>
        </div>
        {draft && (
          <>
            {save.error && (
              <Failure
                error={save.error}
                operation="write"
                onReload={
                  mustReload && !reload.isPending
                    ? () => reload.mutate()
                    : undefined
                }
              />
            )}
            {reload.error && <Failure error={reload.error} operation="read" />}
            <footer className="company-settings-footer">
              <p className="hint" role="status">
                {reload.isPending
                  ? copy.reloading
                  : save.isPending
                    ? t.saving
                    : mustReload
                      ? copy.reviewRequired
                      : dirty
                        ? copy.unsaved
                        : copy.noChanges}
              </p>
              <div className="action-group">
                <Button
                  disabled={blocked}
                  onClick={() => {
                    closeDraft();
                    save.reset();
                  }}
                >
                  {t.cancel}
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  pending={save.isPending}
                  disabled={!canSave}
                >
                  {t.save}
                </Button>
              </div>
            </footer>
          </>
        )}
      </form>
      {!editing && links.length > 0 && (
        <nav
          className="company-settings-shortcuts"
          aria-labelledby="company-settings-shortcuts-title"
        >
          <h3 id="company-settings-shortcuts-title">{copy.shortcuts}</h3>
          <ul>
            {links.map((link) => (
              <li key={link.icon}>
                <Link
                  to="/companies/$companyId"
                  params={{ companyId: company.id }}
                  search={link.view ? { view: link.view } : {}}
                >
                  <span className="company-settings-icon">
                    <NavigationIcon name={link.icon} />
                  </span>
                  <span>
                    <strong>{link.title}</strong>
                    <small>{link.detail}</small>
                  </span>
                  <UiIcon name="next" />
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
      {!editing && company.updatedAt && (
        <p className="hint company-settings-updated">
          {copy.updated}{" "}
          <time dateTime={company.updatedAt}>
            {formatInstant(locale, company.updatedAt)}
          </time>
        </p>
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
  mode,
  record,
  memberId,
  profileId,
  profileQuery,
  profileStatus,
}: {
  companyId: string;
  cursor?: string;
  view?: "settings" | "history" | "members" | "invitations" | "profiles";
  /** The branches dataset's mode and record, on the company's default view. */
  mode?: DataSetMode;
  record?: string;
  memberId?: string;
  profileId?: string;
  profileQuery?: string;
  profileStatus?: "ACTIVE" | "ARCHIVED";
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
    ...(!view && mode ? { mode } : {}),
    ...(!view && record ? { record } : {}),
    ...(view === "members" && memberId ? { member: memberId } : {}),
    ...(view === "profiles" && profileId ? { profile: profileId } : {}),
    ...(view === "profiles" && profileQuery ? { profileQuery } : {}),
    ...(view === "profiles" && profileStatus ? { profileStatus } : {}),
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
        <Failure
          error={company.error}
          operation="read"
          onReload={() => void company.refetch()}
        />
        <Link to="/companies">{t.backToCompanies}</Link>
      </section>
    );
  const { access, responsibilityTransfer: transfer } = company.data;
  const canView = access.capabilities.includes("branches.view");
  // The default view is the branches dataset, which uses the whole workspace.
  const datasetView = !view && canView;
  return (
    <section
      className={`panel organization-panel${datasetView ? " dataset-panel" : ""}${view === "settings" ? " company-settings-panel" : ""}${view === "members" ? " company-members-panel" : ""}${view === "profiles" ? " company-profiles-panel" : ""}`}
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
            key={cursor ?? "first"}
            memberId={memberId}
            canInvite={access.capabilities.includes("invitations.manage")}
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
          <CompanyProfiles
            companyId={companyId}
            profileId={profileId}
            profileQuery={profileQuery}
            profileStatus={profileStatus}
            returnTo={returnTo}
            locale={locale}
            t={t}
          />
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
          <CompanySettings
            company={company.data.company}
            capabilities={access.capabilities}
          />
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
            search={{
              ...(cursor ? { cursor } : {}),
              ...(mode ? { mode } : {}),
              ...(record ? { record } : {}),
            }}
            manage={access.capabilities.includes("branches.manage")}
          />
        )
      )}
    </section>
  );
}
