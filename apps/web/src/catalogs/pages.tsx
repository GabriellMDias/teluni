import {
  Activity,
  useDeferredValue,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ApiFailure, type ApiIssue } from "../api-client.js";
import { Button, Checkbox, DataSet, TextField } from "../components.js";
import type { DataSetColumn } from "../dataset.js";
import { UiIcon, type UiIconName } from "../ui-icon.js";
import { loginHref, sessionQuery } from "../identity/api.js";
import { browserLocale, type Locale } from "../locale.js";
import { formatInstant } from "../organizations/members.js";
import {
  companyKey,
  describe,
  getCompany,
  listBranchChoices,
  type CompanyWithAccess,
} from "../organizations/api.js";
import {
  catalogKey,
  catalogsKey,
  createCatalog,
  createPromotion,
  createRecord,
  deleteCatalog,
  deletePromotion,
  deleteRecord,
  effectiveKey,
  getCatalog,
  getEffectivePrices,
  getRecord,
  listCatalogChoices,
  listCatalogs,
  listPricePublications,
  listPromotions,
  listRecords,
  listSelectableImages,
  moveRecord,
  pricePublicationsKey,
  promotionsKey,
  recordKey,
  recordsKey,
  replaceSchema,
  retryPricePublication,
  setBasePrice,
  setBranchPrice,
  updateCatalog,
  updateRecord,
  type Catalog,
  type CatalogRecord,
  type Field,
  type FieldInput,
  type FieldType,
  type PricePublication,
  type Value,
} from "./api.js";
import { catalogMessages, type CatalogMessages } from "./messages.js";
import {
  amountInput,
  decimalInput,
  decimalValue,
  formatAmount,
  parseAmount,
} from "./money.js";

export type CatalogsFilter = Readonly<{
  cursor?: string;
  text?: string;
  status?: "ARCHIVED";
  create?: true;
}>;

export type CatalogFilter = Readonly<{
  view?: "fields" | "settings";
  create?: true;
  cursor?: string;
  text?: string;
}>;

export type RecordFilter = Readonly<{
  view?: "prices" | "publications" | "settings";
  text?: string;
  cursor?: string;
}>;

function withSearch(path: string, filter: object) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) {
    if (typeof value === "string") search.set(key, value);
    else if (value === true) search.set(key, "true");
  }
  return search.size ? `${path}?${search}` : path;
}

export function useCatalogMessages() {
  const locale = useMemo(browserLocale, []);
  return { locale, t: catalogMessages[locale] };
}

type Messages = CatalogMessages;

/** Text of one issue, with the stored items that cause it. */
function issueText(issue: ApiIssue, t: Messages): string {
  const text = t.issues[issue.reason] ?? t.generic;
  return issue.count === undefined ? text : t.issueCount(text, issue.count);
}

function Failure({
  error,
  operation,
  onReload,
  label,
}: {
  error: unknown;
  operation: "read" | "write";
  onReload?: () => void;
  /** Names the field an issue points to, when the form knows it. */
  label?: (issue: ApiIssue) => string | null;
}) {
  const { t } = useCatalogMessages();
  const issues = error instanceof ApiFailure ? error.issues : [];
  return (
    <div role="alert" className="notice notice-error">
      {describe(error, t, operation)}
      {issues.length > 0 && (
        <ul className="catalog-issues">
          {issues.map((issue, index) => {
            const name = label?.(issue) ?? null;
            return (
              <li key={`${issue.path}-${issue.reason}-${index}`}>
                {name ? `${name}: ` : ""}
                {issueText(issue, t)}
              </li>
            );
          })}
        </ul>
      )}
      {onReload && (
        <button type="button" onClick={onReload}>
          {t.reload}
        </button>
      )}
    </div>
  );
}

/** Issues of one request path, such as `/values/<id>` or `/fields/2`. */
function issuesAt(error: unknown, path: string): ApiIssue[] {
  if (!(error instanceof ApiFailure)) return [];
  return error.issues.filter(
    (issue) => issue.path === path || issue.path.startsWith(`${path}/`),
  );
}

function FieldIssues({ error, path }: { error: unknown; path: string }) {
  const { t } = useCatalogMessages();
  const issues = issuesAt(error, path);
  if (issues.length === 0) return null;
  return (
    <p className="catalog-field-issue">
      {issues.map((issue) => issueText(issue, t)).join(" ")}
    </p>
  );
}

/** A write whose outcome is unknown or stale needs a reload, not a retry. */
function mustReload(error: unknown): boolean {
  return (
    Boolean(error) &&
    (!(error instanceof ApiFailure) ||
      error.status >= 500 ||
      error.code === "RESOURCE_VERSION_CONFLICT")
  );
}

const can = (company: CompanyWithAccess, capability: string) =>
  company.access.capabilities.some((granted) => granted === capability);

/**
 * Loads the session and the company access every catalog page needs, and
 * renders sign-in, step-up and denial states before the page itself.
 */
function CompanyGate({
  companyId,
  returnTo,
  children,
}: {
  companyId: string;
  returnTo: string;
  children: (company: CompanyWithAccess) => ReactNode;
}) {
  const { locale, t } = useCatalogMessages();
  const session = useQuery(sessionQuery);
  const company = useQuery({
    queryKey: companyKey(companyId),
    queryFn: () => getCompany(companyId),
    enabled: Boolean(session.data),
  });
  let body: ReactNode;
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
  else if (company.data && !can(company.data, "catalogs.view"))
    body = (
      <p role="alert" className="notice notice-error">
        {t.errors.PERMISSION_DENIED}
      </p>
    );
  else if (company.data) body = children(company.data);
  return (
    <section
      className="panel organization-panel catalogs-panel"
      aria-label={t.title}
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

function useBranchChoices(companyId: string) {
  return useQuery({
    queryKey: ["catalogs", "branches", companyId],
    queryFn: () => listBranchChoices(companyId),
  });
}

const scopeName = (branch: { name: string } | null, t: Messages) =>
  branch ? branch.name : t.companyScope;

function ConfirmedDelete({
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
      className="form-stack catalog-danger"
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

// Catalog list

type Preset = "empty" | "products" | "agenda";

/** Starting fields; presets create ordinary fields the person may change. */
export function presetFields(preset: Preset, t: Messages): FieldInput[] {
  const names = t.presetFields;
  switch (preset) {
    case "products":
      return [
        { label: names.name, type: "text", required: true },
        { label: names.description, type: "longText" },
        { label: names.photo, type: "media" },
        {
          label: names.category,
          type: "selection",
          choices: names.categoryChoices.map((label) => ({ label })),
        },
        { label: names.price, type: "money", currency: "BRL" },
      ];
    case "agenda":
      return [
        { label: names.title, type: "text", required: true },
        { label: names.days, type: "weekdays" },
        { label: names.start, type: "time" },
        { label: names.end, type: "time" },
        { label: names.details, type: "longText" },
      ];
    default:
      return [];
  }
}

function CreateCatalogForm({
  companyId,
  onCancel,
}: {
  companyId: string;
  onCancel: () => void;
}) {
  const { t } = useCatalogMessages();
  const navigate = useNavigate();
  const branchChoices = useBranchChoices(companyId);
  const branches = branchChoices.data?.items ?? [];
  const [name, setName] = useState("");
  const [scope, setScope] = useState("company");
  const [preset, setPreset] = useState<Preset>("products");
  const fields = presetFields(preset, t);
  const create = useMutation({
    mutationFn: () =>
      createCatalog(companyId, {
        name,
        branchId: scope === "company" ? null : scope,
        fields,
      }),
    onSuccess: (created) =>
      navigate({
        to: "/companies/$companyId/catalogs/$catalogId",
        params: { companyId, catalogId: created.id },
      }),
  });
  return (
    <form
      className="form-stack"
      aria-labelledby="create-catalog-title"
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate();
      }}
    >
      <h2 id="create-catalog-title">{t.createCatalogTitle}</h2>
      <p className="hint">{t.workspace.createLead}</p>
      <TextField
        id="catalog-name"
        label={t.fieldName}
        required
        maxLength={120}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <label htmlFor="catalog-scope">{t.fieldScope}</label>
      <select
        id="catalog-scope"
        disabled={branchChoices.isPending || branchChoices.isError}
        value={scope}
        onChange={(event) => setScope(event.target.value)}
      >
        <option value="company">{t.companyScope}</option>
        {branches.map((branch) => (
          <option key={branch.id} value={branch.id}>
            {branch.name}
          </option>
        ))}
      </select>
      {branchChoices.isPending && <p className="hint">{t.loading}</p>}
      {branchChoices.isError && (
        <Failure
          error={branchChoices.error}
          operation="read"
          onReload={() => void branchChoices.refetch()}
        />
      )}
      <label htmlFor="catalog-preset">{t.presetLabel}</label>
      <select
        id="catalog-preset"
        value={preset}
        onChange={(event) => setPreset(event.target.value as Preset)}
      >
        {(["products", "agenda", "empty"] as const).map((option) => (
          <option key={option} value={option}>
            {t.presets[option]}
          </option>
        ))}
      </select>
      <div className="catalog-template">
        <strong>{t.workspace.templateFields}</strong>
        {fields.length ? (
          <ul className="catalog-chips">
            {fields.map((field) => (
              <li key={field.label}>{field.label}</li>
            ))}
          </ul>
        ) : (
          <p className="hint">{t.workspace.emptyTemplate}</p>
        )}
      </div>
      {create.error && <Failure error={create.error} operation="write" />}
      <div className="catalog-actions">
        <Button
          type="submit"
          variant="primary"
          pending={create.isPending}
          disabled={
            !name.trim() ||
            mustReload(create.error) ||
            (scope !== "company" && !branchChoices.isSuccess)
          }
        >
          {create.isPending ? t.creating : t.create}
        </Button>
        <Button onClick={onCancel} disabled={create.isPending}>
          {t.workspace.cancel}
        </Button>
      </div>
    </form>
  );
}

type PageFilter = Readonly<{ cursor?: string; text?: string }>;

function CollectionFilter({
  text,
  status,
  onApply,
}: {
  text?: string;
  status?: "ACTIVE" | "ARCHIVED";
  onApply: (text?: string, status?: "ARCHIVED") => void;
}) {
  const { t } = useCatalogMessages();
  const [term, setTerm] = useState(text ?? "");
  const [archived, setArchived] = useState(status === "ARCHIVED");
  return (
    <form
      className="form-stack"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        onApply(term.trim() || undefined, archived ? "ARCHIVED" : undefined);
      }}
    >
      <TextField
        label={t.filterText}
        type="search"
        maxLength={120}
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        data-autofocus
      />
      {status && (
        <div className="catalog-setting">
          <label htmlFor="catalog-list-status">{t.statusFilter}</label>
          <select
            id="catalog-list-status"
            value={archived ? "ARCHIVED" : "ACTIVE"}
            onChange={(event) => setArchived(event.target.value === "ARCHIVED")}
          >
            <option value="ACTIVE">{t.statusActive}</option>
            <option value="ARCHIVED">{t.statusArchived}</option>
          </select>
        </div>
      )}
      <div className="catalog-actions">
        <Button type="submit" variant="primary">
          {t.search}
        </Button>
        <Button onClick={() => onApply()}>{t.workspace.clearFilters}</Button>
      </div>
    </form>
  );
}

function CatalogHeading({
  title,
  lead,
  icon,
  action,
}: {
  title: string;
  lead?: string;
  icon: UiIconName;
  action?: ReactNode;
}) {
  return (
    <header className="catalog-heading">
      <span className="catalog-heading-icon">
        <UiIcon name={icon} />
      </span>
      <div className="catalog-heading-copy">
        <h1>{title}</h1>
        {lead && <p className="hint">{lead}</p>}
      </div>
      {action}
    </header>
  );
}

function CatalogBadge({ label, live }: { label: string; live: boolean }) {
  return (
    <span className="catalog-badge" data-live={live}>
      {label}
    </span>
  );
}

/** A page of server-filtered catalog rows or items, with creation on demand. */
function CatalogCollection<Row extends { id: string }>({
  label,
  rows,
  columns,
  filter,
  status,
  creating,
  onCreate,
  onFilter,
  onRefresh,
  refreshing,
  empty,
  pagination,
  children,
}: {
  label: string;
  rows: readonly Row[];
  columns: readonly DataSetColumn<Row>[];
  filter: PageFilter;
  status?: "ACTIVE" | "ARCHIVED";
  creating: boolean;
  onCreate?: () => void;
  onFilter: (text?: string, status?: "ARCHIVED") => void;
  onRefresh: () => void;
  refreshing: boolean;
  empty: string;
  pagination?: ReactNode;
  children?: ReactNode;
}) {
  const { locale, t } = useCatalogMessages();
  const active = Number(Boolean(filter.text)) + Number(status === "ARCHIVED");
  return (
    <div className="dataset-region catalog-collection">
      {!creating && active > 0 && (
        <div className="catalog-filter-summary">
          {filter.text && <span>{t.workspace.searchFor(filter.text)}</span>}
          {status === "ARCHIVED" && <span>{t.statusArchived}</span>}
          <Button onClick={() => onFilter()}>{t.workspace.clearFilters}</Button>
        </div>
      )}
      <DataSet
        label={label}
        locale={locale}
        mode={creating ? "form" : "grid"}
        rows={rows}
        columns={columns}
        rowId={(row) => row.id}
        onAdd={creating ? undefined : onCreate}
        onRefresh={creating ? undefined : onRefresh}
        refreshing={!creating && refreshing}
        filters={
          creating
            ? undefined
            : {
                active,
                render: (close) => (
                  <CollectionFilter
                    text={filter.text}
                    status={status}
                    onApply={(text, status) => {
                      onFilter(text, status);
                      close();
                    }}
                  />
                ),
              }
        }
        empty={
          <p className="empty-state">
            {filter.cursor
              ? t.pageEmpty
              : active
                ? t.workspace.noResults
                : empty}
          </p>
        }
      >
        {children}
      </DataSet>
      {!creating && pagination}
    </div>
  );
}

function CatalogList({
  companyId,
  filter,
  editable,
}: {
  companyId: string;
  filter: CatalogsFilter;
  editable: boolean;
}) {
  const { t } = useCatalogMessages();
  const navigate = useNavigate();
  const { create, ...query } = filter;
  const creating = editable && create === true;
  const catalogs = useQuery({
    queryKey: [...catalogsKey(companyId), query],
    queryFn: () =>
      listCatalogs(companyId, { ...query, status: query.status ?? "ACTIVE" }),
    enabled: !creating,
  });
  const columns = useMemo<readonly DataSetColumn<Catalog>[]>(
    () => [
      {
        key: "name",
        header: t.fieldName,
        width: 290,
        value: (row) => row.name,
        render: (row) => (
          <Link
            className="catalog-row-link"
            to="/companies/$companyId/catalogs/$catalogId"
            params={{ companyId, catalogId: row.id }}
          >
            {row.name}
          </Link>
        ),
      },
      {
        key: "scope",
        header: t.fieldScope,
        width: 225,
        value: (row) => scopeName(row.branch, t),
      },
      {
        key: "records",
        header: t.itemsTitle,
        width: 105,
        value: (row) => row.recordCount,
        align: "end",
      },
      {
        key: "fields",
        header: t.fieldsTitle,
        width: 130,
        value: (row) => row.fields.filter((field) => !field.archived).length,
        align: "end",
      },
      {
        key: "status",
        header: t.statusFilter,
        width: 130,
        value: (row) =>
          row.status === "ACTIVE" ? t.workspace.active : t.archivedBadge,
        render: (row) => (
          <CatalogBadge
            label={
              row.status === "ACTIVE" ? t.workspace.active : t.archivedBadge
            }
            live={row.status === "ACTIVE"}
          />
        ),
      },
    ],
    [companyId, t],
  );
  const go = (search: CatalogsFilter) => {
    void navigate({
      to: "/companies/$companyId/catalogs",
      params: { companyId },
      search,
    });
  };
  const onCreate = () => go({ ...query, create: true });
  return (
    <>
      <CatalogHeading
        title={t.title}
        lead={t.lead}
        icon="grid"
        action={
          editable &&
          !creating && (
            <Link
              className="button-link button-primary catalog-create-action"
              to="/companies/$companyId/catalogs"
              params={{ companyId }}
              search={{ ...query, create: true }}
            >
              <UiIcon name="add" />
              {t.createCatalogTitle}
            </Link>
          )
        }
      />
      {!creating && catalogs.isPending ? (
        <p role="status">{t.loading}</p>
      ) : !creating && catalogs.isError ? (
        <Failure
          error={catalogs.error}
          operation="read"
          onReload={() => void catalogs.refetch()}
        />
      ) : (
        <CatalogCollection
          label={t.listTitle}
          rows={catalogs.data?.items ?? []}
          columns={columns}
          filter={query}
          status={query.status ?? "ACTIVE"}
          creating={creating}
          onCreate={editable ? onCreate : undefined}
          onFilter={(text, status) => go({ text, status })}
          onRefresh={() => void catalogs.refetch()}
          refreshing={catalogs.isFetching}
          empty={t.catalogsEmpty}
          pagination={
            (query.cursor || catalogs.data?.nextCursor) && (
              <nav className="pagination" aria-label={t.title}>
                {query.cursor && (
                  <Link
                    to="/companies/$companyId/catalogs"
                    params={{ companyId }}
                    search={{ ...query, cursor: undefined }}
                  >
                    {t.firstPage}
                  </Link>
                )}
                {catalogs.data?.nextCursor && (
                  <Link
                    to="/companies/$companyId/catalogs"
                    params={{ companyId }}
                    search={{ ...query, cursor: catalogs.data.nextCursor }}
                  >
                    {t.nextPage}
                  </Link>
                )}
              </nav>
            )
          }
        >
          {creating && (
            <CreateCatalogForm
              companyId={companyId}
              onCancel={() => go(query)}
            />
          )}
        </CatalogCollection>
      )}
    </>
  );
}

export function CatalogsPage({
  companyId,
  filter,
}: {
  companyId: string;
  filter: CatalogsFilter;
}) {
  return (
    <CompanyGate
      companyId={companyId}
      returnTo={withSearch(`/companies/${companyId}/catalogs`, filter)}
    >
      {(company) => (
        <CatalogList
          companyId={companyId}
          filter={filter}
          editable={can(company, "catalogs.manage")}
        />
      )}
    </CompanyGate>
  );
}

// Fields

type DraftChoice = { key: string; id?: string; label: string };
type DraftField = {
  key: string;
  id?: string;
  label: string;
  type: FieldType;
  required: boolean;
  archived: boolean;
  maxLength: string;
  decimals: string;
  minimum: string;
  maximum: string;
  choices: DraftChoice[];
  currency: string;
  promotions: boolean;
  targetCatalogId: string;
};

let draftKeys = 0;
const nextKey = () => `draft-${++draftKeys}`;

const fieldTypes: readonly FieldType[] = [
  "text",
  "longText",
  "number",
  "boolean",
  "date",
  "time",
  "weekdays",
  "selection",
  "money",
  "media",
  "reference",
];

/** Currencies the panel offers first; the API accepts the ADR-0032 table. */
const currencies = [
  "BRL",
  "USD",
  "EUR",
  "ARS",
  "CLP",
  "COP",
  "MXN",
  "PEN",
  "PYG",
  "UYU",
  "GBP",
  "CAD",
  "JPY",
];

function blankField(type: FieldType): DraftField {
  return {
    key: nextKey(),
    label: "",
    type,
    required: false,
    archived: false,
    maxLength: type === "longText" ? "500" : "120",
    decimals: "0",
    minimum: "",
    maximum: "",
    choices: [{ key: nextKey(), label: "" }],
    currency: "BRL",
    promotions: true,
    targetCatalogId: "",
  };
}

function toDraftFields(fields: readonly Field[], locale: Locale): DraftField[] {
  return fields.map((field) => ({
    ...blankField(field.type),
    id: field.id,
    label: field.label,
    required: field.required,
    archived: field.archived,
    maxLength: String(field.maxLength ?? 120),
    decimals: String(field.decimals ?? 0),
    minimum: field.minimum ? decimalInput(field.minimum, locale) : "",
    maximum: field.maximum ? decimalInput(field.maximum, locale) : "",
    choices: (field.choices ?? []).map((choice) => ({
      key: nextKey(),
      id: choice.id,
      label: choice.label,
    })),
    currency: field.currency ?? "BRL",
    promotions: field.promotions ?? true,
    targetCatalogId: field.targetCatalogId ?? "",
  }));
}

function toFieldInput(draft: DraftField, locale: Locale): FieldInput {
  const base = {
    ...(draft.id ? { id: draft.id } : {}),
    label: draft.label,
    type: draft.type,
    required: draft.type === "money" ? false : draft.required,
    archived: draft.archived,
  };
  switch (draft.type) {
    case "text":
    case "longText":
      return { ...base, maxLength: Number(draft.maxLength) };
    case "number":
      return {
        ...base,
        decimals: Number(draft.decimals),
        minimum: draft.minimum.trim()
          ? decimalValue(draft.minimum, locale)
          : null,
        maximum: draft.maximum.trim()
          ? decimalValue(draft.maximum, locale)
          : null,
      };
    case "selection":
      return {
        ...base,
        choices: draft.choices.map((choice) => ({
          ...(choice.id ? { id: choice.id } : {}),
          label: choice.label,
        })),
      };
    case "money":
      return {
        ...base,
        currency: draft.currency,
        promotions: draft.promotions,
      };
    case "reference":
      return draft.targetCatalogId
        ? { ...base, targetCatalogId: draft.targetCatalogId }
        : base;
    default:
      return base;
  }
}

function FieldSettings({
  draft,
  index,
  catalog,
  companyId,
  onChange,
}: {
  draft: DraftField;
  index: number;
  catalog: Catalog;
  companyId: string;
  onChange: (changed: DraftField) => void;
}) {
  const { t } = useCatalogMessages();
  const id = `field-${index}`;
  const targets = useQuery({
    queryKey: [...catalogsKey(companyId), "choices"],
    queryFn: () => listCatalogChoices(companyId),
    enabled: draft.type === "reference" && !draft.id,
  });
  switch (draft.type) {
    case "text":
    case "longText":
      return (
        <label className="catalog-setting">
          {t.maxLength}
          <input
            type="number"
            min={1}
            max={draft.type === "text" ? 500 : 2000}
            value={draft.maxLength}
            onChange={(event) =>
              onChange({ ...draft, maxLength: event.target.value })
            }
          />
        </label>
      );
    case "number":
      return (
        <>
          <label className="catalog-setting">
            {t.decimals}
            <input
              type="number"
              min={0}
              max={4}
              disabled={Boolean(draft.id)}
              value={draft.decimals}
              onChange={(event) =>
                onChange({ ...draft, decimals: event.target.value })
              }
            />
          </label>
          <label className="catalog-setting">
            {t.minimum}
            <input
              inputMode="decimal"
              value={draft.minimum}
              onChange={(event) =>
                onChange({ ...draft, minimum: event.target.value })
              }
            />
          </label>
          <label className="catalog-setting">
            {t.maximum}
            <input
              inputMode="decimal"
              value={draft.maximum}
              onChange={(event) =>
                onChange({ ...draft, maximum: event.target.value })
              }
            />
          </label>
        </>
      );
    case "selection":
      return (
        <fieldset className="catalog-choices">
          <legend>{t.choices}</legend>
          {draft.choices.map((choice, position) => (
            <div key={choice.key} className="catalog-choice">
              <input
                aria-label={t.choiceLabel(position + 1)}
                maxLength={80}
                value={choice.label}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    choices: draft.choices.map((entry) =>
                      entry.key === choice.key
                        ? { ...entry, label: event.target.value }
                        : entry,
                    ),
                  })
                }
              />
              <button
                type="button"
                onClick={() =>
                  onChange({
                    ...draft,
                    choices: draft.choices.filter(
                      (entry) => entry.key !== choice.key,
                    ),
                  })
                }
              >
                {t.remove}
              </button>
            </div>
          ))}
          <button
            type="button"
            disabled={draft.choices.length >= 100}
            onClick={() =>
              onChange({
                ...draft,
                choices: [...draft.choices, { key: nextKey(), label: "" }],
              })
            }
          >
            {t.addChoice}
          </button>
        </fieldset>
      );
    case "money":
      return (
        <>
          <label className="catalog-setting">
            {t.currency}
            <select
              id={`${id}-currency`}
              disabled={Boolean(draft.id)}
              value={draft.currency}
              onChange={(event) =>
                onChange({ ...draft, currency: event.target.value })
              }
            >
              {[...new Set([draft.currency, ...currencies])].map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>
          {!draft.id && <span className="hint">{t.currencyFixed}</span>}
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={draft.promotions}
              onChange={(event) =>
                onChange({ ...draft, promotions: event.target.checked })
              }
            />
            {t.allowPromotions}
          </label>
        </>
      );
    case "reference": {
      const choices = (targets.data ?? []).filter(
        (target) =>
          target.branch === null || target.branch.id === catalog.branch?.id,
      );
      return (
        <label className="catalog-setting">
          {t.targetCatalog}
          <select
            disabled={Boolean(draft.id)}
            value={draft.targetCatalogId}
            onChange={(event) =>
              onChange({ ...draft, targetCatalogId: event.target.value })
            }
          >
            <option value="">{t.chooseTarget}</option>
            {draft.id && (
              <option value={draft.targetCatalogId}>
                {targets.data?.find(
                  (target) => target.id === draft.targetCatalogId,
                )?.name ?? draft.targetCatalogId}
              </option>
            )}
            {!draft.id &&
              choices.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.id === catalog.id
                    ? `${target.name} (${t.views.items.toLowerCase()})`
                    : target.name}
                </option>
              ))}
          </select>
        </label>
      );
    }
    default:
      return null;
  }
}

/** Edits the whole ordered field list and saves it with the catalog version. */
export function SchemaEditor({
  companyId,
  catalog,
  onChanged,
}: {
  companyId: string;
  catalog: Catalog;
  onChanged: (changed: Catalog, notice: string) => void;
}) {
  const { locale, t } = useCatalogMessages();
  const [drafts, setDrafts] = useState(() =>
    toDraftFields(catalog.fields, locale),
  );
  const [newType, setNewType] = useState<FieldType>("text");
  const save = useMutation({
    mutationFn: () =>
      replaceSchema(
        companyId,
        catalog,
        drafts.map((draft) => toFieldInput(draft, locale)),
      ),
    onSuccess: (changed) => onChanged(changed, t.saved),
  });
  const update = (key: string, changed: DraftField) =>
    setDrafts(drafts.map((draft) => (draft.key === key ? changed : draft)));
  const move = (index: number, offset: number) => {
    const next = [...drafts];
    const [entry] = next.splice(index, 1);
    next.splice(index + offset, 0, entry);
    setDrafts(next);
  };
  const label = (issue: ApiIssue) => {
    const match = /^\/fields\/(\d+)/.exec(issue.path);
    if (match) return drafts[Number(match[1])]?.label || null;
    if (issue.fieldId)
      return (
        catalog.fields.find((field) => field.id === issue.fieldId)?.label ??
        null
      );
    return null;
  };
  return (
    <form
      className="form-stack"
      aria-labelledby="catalog-fields-title"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <h2 id="catalog-fields-title">{t.fieldsTitle}</h2>
      <p className="hint">{t.fieldsLead}</p>
      <p className="hint">{t.personalDataHint}</p>
      {drafts.length === 0 && <p className="empty-state">{t.fieldsEmpty}</p>}
      <ol className="catalog-fields">
        {drafts.map((draft, index) => (
          <li key={draft.key} className={draft.archived ? "archived" : ""}>
            <div className="catalog-field-row">
              <label className="catalog-setting">
                {t.fieldLabel}
                <input
                  required
                  maxLength={80}
                  value={draft.label}
                  onChange={(event) =>
                    update(draft.key, { ...draft, label: event.target.value })
                  }
                />
              </label>
              <label className="catalog-setting">
                {t.fieldType}
                <select
                  disabled={Boolean(draft.id)}
                  value={draft.type}
                  onChange={(event) =>
                    update(draft.key, {
                      ...blankField(event.target.value as FieldType),
                      key: draft.key,
                      label: draft.label,
                    })
                  }
                >
                  {fieldTypes.map((type) => (
                    <option key={type} value={type}>
                      {t.types[type]}
                    </option>
                  ))}
                </select>
              </label>
              {draft.type !== "money" && (
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={draft.required}
                    onChange={(event) =>
                      update(draft.key, {
                        ...draft,
                        required: event.target.checked,
                      })
                    }
                  />
                  {t.required}
                </label>
              )}
              {draft.id && (
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={draft.archived}
                    onChange={(event) =>
                      update(draft.key, {
                        ...draft,
                        archived: event.target.checked,
                      })
                    }
                  />
                  {t.archivedField}
                </label>
              )}
            </div>
            <div className="catalog-field-row">
              <FieldSettings
                draft={draft}
                index={index}
                catalog={catalog}
                companyId={companyId}
                onChange={(changed) => update(draft.key, changed)}
              />
            </div>
            <FieldIssues error={save.error} path={`/fields/${index}`} />
            <div className="catalog-field-actions">
              <button
                type="button"
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                {t.moveUp}
              </button>
              <button
                type="button"
                disabled={index === drafts.length - 1}
                onClick={() => move(index, 1)}
              >
                {t.moveDown}
              </button>
              <button
                type="button"
                onClick={() =>
                  setDrafts(drafts.filter((entry) => entry.key !== draft.key))
                }
              >
                {t.remove}
              </button>
            </div>
          </li>
        ))}
      </ol>
      <div className="catalog-field-actions">
        <label htmlFor="catalog-new-field-type">{t.fieldType}</label>
        <select
          id="catalog-new-field-type"
          value={newType}
          onChange={(event) => setNewType(event.target.value as FieldType)}
        >
          {fieldTypes.map((type) => (
            <option key={type} value={type}>
              {t.types[type]}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={drafts.length >= 60}
          onClick={() => setDrafts([...drafts, blankField(newType)])}
        >
          {t.addField}
        </button>
      </div>
      {save.error && (
        <Failure
          error={save.error}
          operation="write"
          label={label}
          onReload={
            mustReload(save.error)
              ? () => {
                  save.reset();
                  onChanged(catalog, "");
                }
              : undefined
          }
        />
      )}
      <button
        type="submit"
        className="button-primary"
        disabled={save.isPending || mustReload(save.error)}
      >
        {save.isPending ? t.saving : t.saveFields}
      </button>
    </form>
  );
}

function FieldList({ catalog }: { catalog: Catalog }) {
  const { t } = useCatalogMessages();
  return (
    <section aria-labelledby="catalog-fields-title">
      <h2 id="catalog-fields-title">{t.fieldsTitle}</h2>
      {catalog.fields.length === 0 ? (
        <p className="empty-state">{t.fieldsEmpty}</p>
      ) : (
        <ul className="catalog-list">
          {catalog.fields.map((field) => (
            <li key={field.id}>
              {field.label}
              <span className="hint">
                {t.types[field.type]}
                {field.currency ? ` · ${field.currency}` : ""}
                {field.required ? ` · ${t.required}` : ""}
                {field.archived ? ` · ${t.archivedField}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// Values

type Draft = string | number[];

function toDraftValue(field: Field, value: Value | undefined, locale: Locale) {
  if (value === undefined || value === null)
    return field.type === "weekdays" ? [] : "";
  if (field.type === "weekdays" && Array.isArray(value)) return [...value];
  if (field.type === "number" && typeof value === "string")
    return decimalInput(value, locale);
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function fromDraftValue(field: Field, draft: Draft, locale: Locale): Value {
  if (Array.isArray(draft))
    return draft.length === 0 ? null : [...draft].sort((a, b) => a - b);
  if (draft === "") return null;
  switch (field.type) {
    case "boolean":
      return draft === "true";
    case "number":
      return decimalValue(draft, locale);
    default:
      return draft;
  }
}

/** Fields an item form edits: active, and not prices. */
const editable = (catalog: Catalog) =>
  catalog.fields.filter((field) => !field.archived && field.type !== "money");

/** A search box that narrows a picker's choices on the server. */
function PickerSearch({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <input
      type="search"
      aria-label={label}
      maxLength={120}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        // Searching never submits the surrounding form.
        if (event.key === "Enter") event.preventDefault();
      }}
    />
  );
}

/** Up to 100 items of a catalog, narrowed by text, for item pickers. */
function useRecordChoices(companyId: string, catalogId: string, text: string) {
  const query = useDeferredValue(text.trim());
  return useQuery({
    queryKey: [...recordsKey(companyId, catalogId), "choices", query],
    queryFn: () =>
      listRecords(companyId, catalogId, {
        limit: 100,
        ...(query ? { text: query } : {}),
      }),
    enabled: Boolean(catalogId),
  });
}

function MediaChoice({
  companyId,
  scope,
  field,
  record,
  value,
  onChange,
}: {
  companyId: string;
  /** The catalog's branch; null for a company catalog. */
  scope: string | null;
  field: Field;
  record: CatalogRecord | null;
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useCatalogMessages();
  const [text, setText] = useState("");
  const query = useDeferredValue(text.trim());
  const images = useQuery({
    queryKey: ["catalogs", "images", companyId, scope, query],
    queryFn: () =>
      listSelectableImages(
        companyId,
        query || undefined,
        scope === null ? "company" : undefined,
      ),
  });
  const current = record?.media.find((entry) => entry.fieldId === field.id);
  // Only company images and images of the catalog's own branch fit it.
  const items = (images.data?.items ?? []).filter(
    (item) => item.branch === null || item.branch.id === scope,
  );
  return (
    <span className="catalog-picker">
      <PickerSearch
        label={`${t.searchImages}: ${field.label}`}
        value={text}
        onChange={setText}
      />
      <select
        id={`value-${field.id}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{t.chooseMedia}</option>
        {current && !items.some((item) => item.id === current.mediaAssetId) && (
          <option value={current.mediaAssetId}>
            {t.currentValue(current.name ?? current.mediaAssetId)}
          </option>
        )}
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
    </span>
  );
}

function ReferenceChoice({
  companyId,
  field,
  record,
  value,
  onChange,
}: {
  companyId: string;
  field: Field;
  record: CatalogRecord | null;
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useCatalogMessages();
  const [text, setText] = useState("");
  const records = useRecordChoices(
    companyId,
    field.targetCatalogId ?? "",
    text,
  );
  const current = record?.references.find(
    (entry) => entry.fieldId === field.id,
  );
  const items = records.data?.items ?? [];
  return (
    <span className="catalog-picker">
      <PickerSearch
        label={`${t.searchRecords}: ${field.label}`}
        value={text}
        onChange={setText}
      />
      <select
        id={`value-${field.id}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{t.chooseRecord}</option>
        {current && !items.some((item) => item.id === current.recordId) && (
          <option value={current.recordId}>
            {t.currentValue(current.title ?? t.untitled)}
          </option>
        )}
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {item.title ?? t.untitled}
          </option>
        ))}
      </select>
    </span>
  );
}

function ValueInput({
  companyId,
  scope,
  field,
  record,
  value,
  onChange,
}: {
  companyId: string;
  scope: string | null;
  field: Field;
  record: CatalogRecord | null;
  value: Draft;
  onChange: (value: Draft) => void;
}) {
  const { t } = useCatalogMessages();
  const id = `value-${field.id}`;
  const text = typeof value === "string" ? value : "";
  switch (field.type) {
    case "longText":
      return (
        <textarea
          id={id}
          rows={3}
          maxLength={field.maxLength}
          value={text}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    case "number":
      return (
        <input
          id={id}
          inputMode="decimal"
          value={text}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    case "boolean":
      return (
        <select
          id={id}
          value={text}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">{t.empty}</option>
          <option value="true">{t.yes}</option>
          <option value="false">{t.no}</option>
        </select>
      );
    case "date":
    case "time":
      return (
        <input
          id={id}
          type={field.type}
          value={text}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    case "weekdays": {
      const days = Array.isArray(value) ? value : [];
      return (
        <span className="catalog-weekdays" id={id}>
          {t.weekdays.map((name, index) => (
            <label key={name} className="checkbox-row">
              <input
                type="checkbox"
                checked={days.includes(index + 1)}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...days, index + 1]
                      : days.filter((day) => day !== index + 1),
                  )
                }
              />
              {name}
            </label>
          ))}
        </span>
      );
    }
    case "selection":
      return (
        <select
          id={id}
          value={text}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">{t.chooseOption}</option>
          {(field.choices ?? []).map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.label}
            </option>
          ))}
        </select>
      );
    case "media":
      return (
        <MediaChoice
          companyId={companyId}
          scope={scope}
          field={field}
          record={record}
          value={text}
          onChange={onChange}
        />
      );
    case "reference":
      return (
        <ReferenceChoice
          companyId={companyId}
          field={field}
          record={record}
          value={text}
          onChange={onChange}
        />
      );
    default:
      return (
        <input
          id={id}
          maxLength={field.maxLength}
          value={text}
          onChange={(event) => onChange(event.target.value)}
        />
      );
  }
}

/** An item's editable values and availability, saved as one change. */
export function ValuesForm({
  companyId,
  catalog,
  record,
  title,
  submitLabel,
  run,
  onDone,
  onCancel,
}: {
  companyId: string;
  catalog: Catalog;
  record: CatalogRecord | null;
  title: string;
  submitLabel: string;
  run: (values: Record<string, Value>, available: boolean) => Promise<unknown>;
  onDone: (result: unknown) => void;
  onCancel?: () => void;
}) {
  const { locale, t } = useCatalogMessages();
  const fields = editable(catalog);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(
      fields.map((field) => [
        field.id,
        toDraftValue(field, record?.values[field.id], locale),
      ]),
    ),
  );
  const [available, setAvailable] = useState(record?.available ?? true);
  const save = useMutation({
    mutationFn: () =>
      run(
        Object.fromEntries(
          fields.map((field) => [
            field.id,
            fromDraftValue(field, drafts[field.id] ?? "", locale),
          ]),
        ),
        available,
      ),
    onSuccess: onDone,
  });
  const titleId = record
    ? "catalog-item-values-title"
    : "catalog-new-item-title";
  const label = (issue: ApiIssue) => {
    const match = /^\/values\/([^/]+)/.exec(issue.path);
    return match
      ? (catalog.fields.find((field) => field.id === match[1])?.label ?? null)
      : null;
  };
  return (
    <form
      className="form-stack"
      aria-labelledby={titleId}
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <h2 id={titleId}>{title}</h2>
      {fields.map((field) => (
        <div key={field.id} className="catalog-value">
          <label htmlFor={`value-${field.id}`}>
            {field.required ? `${field.label} *` : field.label}
          </label>
          <ValueInput
            companyId={companyId}
            scope={catalog.branch?.id ?? null}
            field={field}
            record={record}
            value={drafts[field.id] ?? ""}
            onChange={(value) => setDrafts({ ...drafts, [field.id]: value })}
          />
          <FieldIssues error={save.error} path={`/values/${field.id}`} />
        </div>
      ))}
      <Checkbox
        label={t.availableLabel}
        checked={available}
        onChange={(event) => setAvailable(event.target.checked)}
      />
      {save.error && (
        <Failure error={save.error} operation="write" label={label} />
      )}
      <div className="catalog-actions">
        <Button
          type="submit"
          variant="primary"
          pending={save.isPending}
          disabled={mustReload(save.error)}
        >
          {save.isPending ? t.saving : submitLabel}
        </Button>
        {onCancel && (
          <Button onClick={onCancel} disabled={save.isPending}>
            {t.workspace.cancel}
          </Button>
        )}
      </div>
    </form>
  );
}

/** An item's values as text, for members who may only view them. */
function ValueList({
  catalog,
  record,
}: {
  catalog: Catalog;
  record: CatalogRecord;
}) {
  const { locale, t } = useCatalogMessages();
  const text = (field: Field): string => {
    const value = record.values[field.id];
    if (value === undefined || value === null) return t.empty;
    switch (field.type) {
      case "boolean":
        return value ? t.yes : t.no;
      case "number":
        return decimalInput(String(value), locale);
      case "weekdays":
        return Array.isArray(value)
          ? value.map((day) => t.weekdays[day - 1]).join(", ")
          : t.empty;
      case "selection":
        return (
          field.choices?.find((choice) => choice.id === value)?.label ?? t.empty
        );
      case "media":
        return (
          record.media.find((entry) => entry.fieldId === field.id)?.name ??
          t.empty
        );
      case "reference":
        return (
          record.references.find((entry) => entry.fieldId === field.id)
            ?.title ?? t.untitled
        );
      default:
        return String(value);
    }
  };
  return (
    <section aria-labelledby="catalog-item-values-title">
      <h2 id="catalog-item-values-title">{t.editItemTitle}</h2>
      <dl className="catalog-values">
        {editable(catalog).map((field) => (
          <div key={field.id}>
            <dt>{field.label}</dt>
            <dd>{text(field)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

// Items

function RecordList({
  companyId,
  catalog,
  filter,
  editable,
}: {
  companyId: string;
  catalog: Catalog;
  filter: CatalogFilter;
  editable: boolean;
}) {
  const { locale, t } = useCatalogMessages();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const query = { cursor: filter.cursor, text: filter.text };
  const creating = editable && filter.create === true;
  const records = useQuery({
    queryKey: [...recordsKey(companyId, catalog.id), query],
    queryFn: () => listRecords(companyId, catalog.id, query),
    enabled: !creating,
  });
  const columns = useMemo<readonly DataSetColumn<CatalogRecord>[]>(
    () => [
      {
        key: "title",
        header: t.workspace.itemName,
        width: 280,
        value: (row) => row.title ?? t.untitled,
        render: (row) => (
          <Link
            className="catalog-row-link"
            to="/companies/$companyId/catalogs/$catalogId/items/$recordId"
            params={{ companyId, catalogId: catalog.id, recordId: row.id }}
            search={{ text: filter.text, cursor: filter.cursor }}
          >
            {row.title ?? t.untitled}
          </Link>
        ),
      },
      {
        key: "available",
        header: t.statusFilter,
        width: 175,
        value: (row) => (row.available ? t.workspace.available : t.unavailable),
        render: (row) => (
          <CatalogBadge
            label={row.available ? t.workspace.available : t.unavailable}
            live={row.available}
          />
        ),
      },
      ...catalog.fields
        .filter((field) => field.type === "money" && !field.archived)
        .slice(0, 1)
        .map((field): DataSetColumn<CatalogRecord> => ({
          key: field.id,
          header: t.workspace.basePriceColumn(field.label),
          width: 175,
          align: "end",
          value: (row) => {
            const amount = row.values[field.id];
            return typeof amount === "number" ? amount : null;
          },
          render: (row) => {
            const amount = row.values[field.id];
            return typeof amount === "number"
              ? formatAmount(amount, field.currency ?? "BRL", locale)
              : t.noPrice;
          },
        })),
    ],
    [
      catalog.fields,
      catalog.id,
      companyId,
      filter.cursor,
      filter.text,
      locale,
      t,
    ],
  );
  const go = (search: CatalogFilter) => {
    void navigate({
      to: "/companies/$companyId/catalogs/$catalogId",
      params: { companyId, catalogId: catalog.id },
      search,
    });
  };
  const onCreate = () => go({ ...query, create: true });
  return (
    <section className="catalog-section">
      <div className="catalog-section-heading">
        <div>
          <h2 id="catalog-items-title">{t.itemsTitle}</h2>
          <p className="hint">{t.workspace.itemsLead}</p>
        </div>
        {editable && !creating && (
          <Link
            className="button-link button-primary catalog-create-action"
            to="/companies/$companyId/catalogs/$catalogId"
            params={{ companyId, catalogId: catalog.id }}
            search={{ ...query, create: true }}
          >
            <UiIcon name="add" />
            {t.newItemTitle}
          </Link>
        )}
      </div>
      {!creating && records.isPending ? (
        <p role="status">{t.loading}</p>
      ) : !creating && records.isError ? (
        <Failure
          error={records.error}
          operation="read"
          onReload={() => void records.refetch()}
        />
      ) : (
        <CatalogCollection
          label={t.itemsTitle}
          rows={records.data?.items ?? []}
          columns={columns}
          filter={query}
          creating={creating}
          onCreate={editable ? onCreate : undefined}
          onFilter={(text) => go({ text })}
          onRefresh={() => void records.refetch()}
          refreshing={records.isFetching}
          empty={t.itemsEmpty}
          pagination={
            (query.cursor || records.data?.nextCursor) && (
              <nav className="pagination" aria-label={t.itemsTitle}>
                {query.cursor && (
                  <Link
                    to="/companies/$companyId/catalogs/$catalogId"
                    params={{ companyId, catalogId: catalog.id }}
                    search={{ text: query.text }}
                  >
                    {t.firstPage}
                  </Link>
                )}
                {records.data?.nextCursor && (
                  <Link
                    to="/companies/$companyId/catalogs/$catalogId"
                    params={{ companyId, catalogId: catalog.id }}
                    search={{ ...query, cursor: records.data.nextCursor }}
                  >
                    {t.nextPage}
                  </Link>
                )}
              </nav>
            )
          }
        >
          {creating && (
            <ValuesForm
              key={catalog.version}
              companyId={companyId}
              catalog={catalog}
              record={null}
              title={t.newItemTitle}
              submitLabel={t.addItem}
              onCancel={() => go(query)}
              run={(values, available) =>
                createRecord(companyId, catalog.id, values, available)
              }
              onDone={(created) => {
                void queryClient.invalidateQueries({
                  queryKey: catalogKey(companyId, catalog.id),
                });
                void queryClient.invalidateQueries({
                  queryKey: catalogsKey(companyId),
                });
                void queryClient.invalidateQueries({
                  queryKey: recordsKey(companyId, catalog.id),
                });
                void navigate({
                  to: "/companies/$companyId/catalogs/$catalogId/items/$recordId",
                  params: {
                    companyId,
                    catalogId: catalog.id,
                    recordId: (created as CatalogRecord).id,
                  },
                  search: query,
                });
              }}
            />
          )}
        </CatalogCollection>
      )}
    </section>
  );
}

function CatalogSettings({
  companyId,
  catalog,
  onChanged,
}: {
  companyId: string;
  catalog: Catalog;
  onChanged: (changed: Catalog, notice: string) => void;
}) {
  const { t } = useCatalogMessages();
  const [name, setName] = useState(catalog.name);
  const rename = useMutation({
    mutationFn: () => updateCatalog(companyId, catalog, { name }),
    onSuccess: (changed) => onChanged(changed, t.saved),
  });
  const status = useMutation({
    mutationFn: () =>
      updateCatalog(companyId, catalog, {
        archived: catalog.status !== "ARCHIVED",
      }),
    onSuccess: (changed) => onChanged(changed, t.saved),
  });
  const error = rename.error ?? status.error;
  const blocked = rename.isPending || status.isPending || mustReload(error);
  const canRename =
    catalog.status === "ACTIVE" &&
    !!name.trim() &&
    name.trim() !== catalog.name &&
    !blocked;
  return (
    <form
      className="form-stack"
      aria-labelledby="catalog-settings-title"
      onSubmit={(event) => {
        event.preventDefault();
        if (canRename) rename.mutate();
      }}
    >
      <h2 id="catalog-settings-title">{t.settingsTitle}</h2>
      <TextField
        label={t.fieldName}
        id="catalog-rename"
        required
        maxLength={120}
        disabled={catalog.status === "ARCHIVED" || blocked}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      {error && <Failure error={error} operation="write" />}
      <div className="catalog-actions">
        <Button
          type="submit"
          variant="primary"
          pending={rename.isPending}
          disabled={!canRename}
        >
          {rename.isPending ? t.saving : t.save}
        </Button>
        <Button
          pending={status.isPending}
          disabled={blocked}
          onClick={() => status.mutate()}
        >
          {catalog.status === "ARCHIVED" ? t.restoreCatalog : t.archiveCatalog}
        </Button>
      </div>
    </form>
  );
}

function CatalogDetail({
  companyId,
  catalogId,
  filter,
  company,
}: {
  companyId: string;
  catalogId: string;
  filter: CatalogFilter;
  company: CompanyWithAccess;
}) {
  const { t } = useCatalogMessages();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [notice, setNotice] = useState<string | null>(null);
  const catalog = useQuery({
    queryKey: catalogKey(companyId, catalogId),
    queryFn: () => getCatalog(companyId, catalogId),
  });
  const onChanged = (changed: Catalog, done: string) => {
    setNotice(done || null);
    queryClient.setQueryData(catalogKey(companyId, catalogId), changed);
    void queryClient.invalidateQueries({ queryKey: catalogsKey(companyId) });
    void queryClient.invalidateQueries({
      queryKey: catalogKey(companyId, catalogId),
    });
  };
  if (catalog.isPending) return <p>{t.loading}</p>;
  if (catalog.isError)
    return (
      <>
        <Failure
          error={catalog.error}
          operation="read"
          onReload={() => void catalog.refetch()}
        />
        <BackToCatalogs companyId={companyId} />
      </>
    );
  const item = catalog.data;
  const active = item.status === "ACTIVE";
  const manage = can(company, "catalogs.manage");
  const view =
    filter.view === "settings" && !manage ? "items" : (filter.view ?? "items");
  const views = [
    { view: "items", icon: "grid" },
    { view: "fields", icon: "form" },
    ...(manage ? [{ view: "settings", icon: "more" } as const] : []),
  ] as const;
  return (
    <>
      <BackToCatalogs companyId={companyId} />
      <CatalogHeading title={item.name} icon="grid" />
      <div className="catalog-detail-meta">
        <span>{scopeName(item.branch, t)}</span>
        <span>
          {t.catalogSummary(
            item.recordCount,
            item.fields.filter((field) => !field.archived).length,
          )}
        </span>
        <CatalogBadge
          label={active ? t.workspace.active : t.archivedBadge}
          live={active}
        />
      </div>
      {!active && (
        <p role="status" className="notice">
          {t.archivedNotice}
        </p>
      )}
      {notice && (
        <p role="status" className="notice notice-success">
          {notice}
        </p>
      )}
      <nav className="catalog-tabs" aria-label={t.viewsLabel}>
        {views.map((entry) => (
          <Link
            key={entry.view}
            to="/companies/$companyId/catalogs/$catalogId"
            params={{ companyId, catalogId }}
            search={{
              view: entry.view === "items" ? undefined : entry.view,
              text: filter.text,
              cursor: filter.cursor,
            }}
            activeOptions={{ exact: true }}
            aria-current={view === entry.view ? "page" : false}
          >
            <UiIcon name={entry.icon} />
            {t.views[entry.view]}
          </Link>
        ))}
      </nav>
      {view === "items" && (
        <RecordList
          companyId={companyId}
          catalog={item}
          filter={filter}
          editable={can(company, "catalogs.edit") && active}
        />
      )}
      {view === "fields" &&
        (manage && active ? (
          <SchemaEditor
            key={item.version}
            companyId={companyId}
            catalog={item}
            onChanged={onChanged}
          />
        ) : (
          <FieldList catalog={item} />
        ))}
      {view === "settings" && manage && (
        <div className="catalog-settings-stack">
          <CatalogSettings
            key={`settings-${item.version}`}
            companyId={companyId}
            catalog={item}
            onChanged={onChanged}
          />
          <details className="catalog-disclosure catalog-destructive">
            <summary>{t.deleteCatalogTitle}</summary>
            <ConfirmedDelete
              key={`delete-${item.version}`}
              title={t.deleteCatalogTitle}
              lead={t.deleteCatalogLead}
              confirm={t.deleteCatalogConfirm(item.name)}
              label={t.deleteCatalog}
              run={() => deleteCatalog(companyId, item)}
              onDone={() => {
                void queryClient.invalidateQueries({
                  queryKey: catalogsKey(companyId),
                });
                void navigate({
                  to: "/companies/$companyId/catalogs",
                  params: { companyId },
                });
              }}
            />
          </details>
        </div>
      )}
    </>
  );
}

function BackToCatalogs({ companyId }: { companyId: string }) {
  const { t } = useCatalogMessages();
  return (
    <p className="catalog-breadcrumb">
      <Link to="/companies/$companyId/catalogs" params={{ companyId }}>
        <UiIcon name="previous" />
        {t.backToCatalogs}
      </Link>
    </p>
  );
}

export function CatalogPage({
  companyId,
  catalogId,
  filter,
}: {
  companyId: string;
  catalogId: string;
  filter: CatalogFilter;
}) {
  return (
    <CompanyGate
      companyId={companyId}
      returnTo={withSearch(
        `/companies/${companyId}/catalogs/${catalogId}`,
        filter,
      )}
    >
      {(company) => (
        <CatalogDetail
          companyId={companyId}
          catalogId={catalogId}
          filter={filter}
          company={company}
        />
      )}
    </CompanyGate>
  );
}

// Prices

/** An amount input that parses the person's locale into minor units. */
function AmountForm({
  id,
  label,
  currency,
  amount,
  disabled,
  run,
  onDone,
}: {
  id: string;
  label: string;
  currency: string;
  amount: number | null;
  disabled: boolean;
  run: (amount: number | null) => Promise<CatalogRecord>;
  onDone: (changed: CatalogRecord) => void;
}) {
  const { locale, t } = useCatalogMessages();
  const [text, setText] = useState(
    amount === null ? "" : amountInput(amount, currency, locale),
  );
  const parsed = parseAmount(text, currency, locale);
  const save = useMutation({ mutationFn: run, onSuccess: onDone });
  const formatted =
    amount === null ? t.noPrice : formatAmount(amount, currency, locale);
  const blocked = save.isPending || mustReload(save.error);
  const valid = parsed !== undefined && parsed !== amount && !blocked;
  return disabled ? (
    <dl className="catalog-values">
      <div>
        <dt>{label}</dt>
        <dd>{formatted}</dd>
      </div>
    </dl>
  ) : (
    <form
      className="catalog-amount"
      aria-label={label}
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) save.mutate(parsed);
      }}
    >
      <TextField
        id={id}
        label={label}
        inputMode="decimal"
        hint={formatted}
        error={parsed === undefined ? t.amountInvalid : undefined}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="catalog-actions">
        <Button
          type="submit"
          variant="primary"
          pending={save.isPending}
          disabled={!valid}
        >
          {save.isPending ? t.saving : t.save}
        </Button>
        {amount !== null && (
          <Button disabled={blocked} onClick={() => save.mutate(null)}>
            {t.clear}
          </Button>
        )}
      </div>
      {save.error && <Failure error={save.error} operation="write" />}
    </form>
  );
}

const nowMinute = () => {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
};

function Promotions({
  companyId,
  catalog,
  record,
  field,
  branches,
  editable: canEdit,
  onChanged,
}: {
  companyId: string;
  catalog: Catalog;
  record: CatalogRecord;
  field: Field;
  branches: { id: string; name: string }[];
  editable: boolean;
  onChanged: () => void;
}) {
  const { locale, t } = useCatalogMessages();
  const queryClient = useQueryClient();
  const currency = field.currency ?? "BRL";
  const key = promotionsKey(companyId, catalog.id, record.id, field.id);
  const promotions = useQuery({
    queryKey: key,
    queryFn: () => listPromotions(companyId, record, field.id),
  });
  const [scope, setScope] = useState("scope");
  const [text, setText] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const amount = parseAmount(text, currency, locale);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: key });
    onChanged();
  };
  const create = useMutation({
    mutationFn: () =>
      createPromotion(companyId, record, field.id, {
        branchId: scope === "scope" ? null : scope,
        amount: amount ?? 0,
        startsAt,
        endsAt,
      }),
    onSuccess: () => {
      setText("");
      setStartsAt("");
      setEndsAt("");
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (promotionId: string) =>
      deletePromotion(companyId, record, field.id, promotionId),
    onSuccess: refresh,
  });
  const canCreate =
    canEdit &&
    field.promotions &&
    !create.isPending &&
    !remove.isPending &&
    !mustReload(create.error) &&
    !mustReload(remove.error) &&
    amount !== undefined &&
    amount !== null &&
    !!startsAt &&
    !!endsAt;
  const prefix = `promotion-${field.id}`;
  return (
    <section aria-labelledby={`${prefix}-title`}>
      <h4 id={`${prefix}-title`}>{t.promotionsTitle}</h4>
      {!field.promotions ? (
        <p className="hint">{t.promotionsDisabled}</p>
      ) : promotions.isPending ? (
        <p>{t.loading}</p>
      ) : promotions.isError ? (
        <Failure error={promotions.error} operation="read" />
      ) : promotions.data.length === 0 ? (
        <p className="empty-state">{t.promotionsEmpty}</p>
      ) : (
        <ul className="catalog-list">
          {promotions.data.map((promotion) => (
            <li key={promotion.id}>
              {formatAmount(promotion.amount, currency, locale)}
              <span className="hint">
                {scopeName(promotion.branch, t)} ·{" "}
                {t.promotionWindow(
                  promotion.startsAt.replace("T", " "),
                  promotion.endsAt.replace("T", " "),
                )}
              </span>
              {canEdit && (
                <button
                  type="button"
                  disabled={
                    remove.isPending ||
                    create.isPending ||
                    mustReload(remove.error) ||
                    mustReload(create.error)
                  }
                  onClick={() => remove.mutate(promotion.id)}
                >
                  {t.removePromotion}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {remove.error && <Failure error={remove.error} operation="write" />}
      {canEdit && field.promotions && (
        <form
          className="catalog-promotion-form"
          aria-label={t.addPromotion}
          onSubmit={(event) => {
            event.preventDefault();
            if (canCreate) create.mutate();
          }}
        >
          {catalog.branch === null && (
            <label className="catalog-setting">
              {t.promotionScope}
              <select
                value={scope}
                onChange={(event) => setScope(event.target.value)}
              >
                <option value="scope">{t.companyScope}</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <TextField
            label={t.amountLabel(currency)}
            inputMode="decimal"
            required
            error={amount === undefined ? t.amountInvalid : undefined}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <TextField
            label={t.promotionStart}
            type="datetime-local"
            required
            value={startsAt}
            onChange={(event) => setStartsAt(event.target.value)}
          />
          <TextField
            label={t.promotionEnd}
            type="datetime-local"
            required
            value={endsAt}
            onChange={(event) => setEndsAt(event.target.value)}
          />
          <div className="catalog-actions">
            <Button
              type="submit"
              pending={create.isPending}
              disabled={!canCreate}
            >
              {t.addPromotion}
            </Button>
          </div>
          {create.error && <Failure error={create.error} operation="write" />}
        </form>
      )}
    </section>
  );
}

function EffectivePrices({
  companyId,
  catalog,
  record,
}: {
  companyId: string;
  catalog: Catalog;
  record: CatalogRecord;
}) {
  const { locale, t } = useCatalogMessages();
  const [at, setAt] = useState(nowMinute);
  const valid = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(at);
  const prices = useQuery({
    queryKey: [
      ...effectiveKey(companyId, catalog.id, record.id, at),
      record.version,
    ],
    queryFn: () => getEffectivePrices(companyId, record, at),
    enabled: valid,
  });
  const fields = new Map(catalog.fields.map((field) => [field.id, field]));
  const price = (amount: number | null, currency: string) =>
    amount === null ? t.noPrice : formatAmount(amount, currency, locale);
  return (
    <section
      className="catalog-price"
      aria-labelledby="catalog-effective-title"
    >
      <h3 id="catalog-effective-title">{t.effectiveTitle}</h3>
      <TextField
        id="catalog-effective-at"
        label={t.effectiveAt}
        type="datetime-local"
        value={at}
        onChange={(event) => setAt(event.target.value)}
      />
      {prices.isError && <Failure error={prices.error} operation="read" />}
      {prices.data && (
        <ul className="catalog-list">
          {prices.data.fields.map((entry) => (
            <li key={entry.fieldId}>
              <strong>{fields.get(entry.fieldId)?.label}</strong>
              <span>
                {catalog.branch ? t.effectiveThisBranch : t.effectiveScope}:{" "}
                {price(entry.scope.amount, entry.currency)} (
                {t.sources[entry.scope.source]})
              </span>
              {entry.branches.map((branch) => (
                <span key={branch.branch.id}>
                  {branch.branch.name}: {price(branch.amount, entry.currency)} (
                  {t.sources[branch.source]})
                </span>
              ))}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PriceSection({
  companyId,
  catalog,
  record,
  field,
  branches,
  editable: canEdit,
  onChanged,
  onPromotions,
}: {
  companyId: string;
  catalog: Catalog;
  record: CatalogRecord;
  field: Field;
  branches: { id: string; name: string }[];
  editable: boolean;
  onChanged: (changed: CatalogRecord) => void;
  onPromotions: () => void;
}) {
  const { t } = useCatalogMessages();
  const currency = field.currency ?? "BRL";
  const base = record.values[field.id];
  return (
    <section
      className="catalog-price"
      aria-labelledby={`price-${field.id}-title`}
    >
      <h3 id={`price-${field.id}-title`}>{field.label}</h3>
      <AmountForm
        key={`base-${record.version}`}
        id={`price-${field.id}-base`}
        label={t.basePrice}
        currency={currency}
        amount={typeof base === "number" ? base : null}
        disabled={!canEdit}
        run={(amount) => setBasePrice(companyId, record, field.id, amount)}
        onDone={onChanged}
      />
      {catalog.branch === null && branches.length > 0 && (
        <>
          <h4>{t.branchPricesTitle}</h4>
          {branches.map((branch) => {
            const override = record.overrides.find(
              (entry) =>
                entry.fieldId === field.id && entry.branch.id === branch.id,
            );
            return (
              <AmountForm
                key={`${branch.id}-${record.version}`}
                id={`price-${field.id}-${branch.id}`}
                label={t.branchPrice(branch.name)}
                currency={currency}
                amount={override?.amount ?? null}
                disabled={!canEdit}
                run={(amount) =>
                  setBranchPrice(companyId, record, field.id, branch.id, amount)
                }
                onDone={onChanged}
              />
            );
          })}
        </>
      )}
      <Promotions
        companyId={companyId}
        catalog={catalog}
        record={record}
        field={field}
        branches={branches}
        editable={canEdit}
        onChanged={onPromotions}
      />
    </section>
  );
}

/**
 * What each price change did on screens: one line per program whose
 * publication shows the catalog, refreshed while some are queued, with a
 * new authorization for blocked or failed ones.
 */
function PricePublications({
  companyId,
  catalogId,
  canRetry,
}: {
  companyId: string;
  catalogId: string;
  canRetry: boolean;
}) {
  const { locale, t } = useCatalogMessages();
  const p = t.pricePublications;
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const list = useQuery({
    queryKey: pricePublicationsKey(companyId, catalogId),
    queryFn: () => listPricePublications(companyId, catalogId),
    refetchInterval: (query) =>
      query.state.data?.items.some((item) => item.state === "pending")
        ? 2_000
        : false,
  });
  const retry = useMutation({
    mutationFn: (intentId: string) =>
      retryPricePublication(companyId, intentId),
    onSuccess: async () => {
      setNotice(p.retried);
      await queryClient.invalidateQueries({
        queryKey: pricePublicationsKey(companyId, catalogId),
      });
    },
  });
  const target = (item: PricePublication) =>
    item.target === null
      ? p.hidden
      : item.target.kind === "group"
        ? p.group(item.target.name)
        : p.device(item.target.name);
  return (
    <section aria-labelledby="catalog-price-publications-title">
      <h2 id="catalog-price-publications-title">{p.title}</h2>
      <p className="hint">{p.lead}</p>
      {notice && <p role="status">{notice}</p>}
      {list.isPending && <p>{t.loading}</p>}
      {list.isError && (
        <Failure
          error={list.error}
          operation="read"
          onReload={() => void list.refetch()}
        />
      )}
      {list.data && list.data.items.length === 0 && <p>{p.empty}</p>}
      {list.data && list.data.items.length > 0 && (
        <ul aria-label={p.title} className="catalog-price-publications">
          {list.data.items.map((item) => (
            <li key={item.id}>
              <strong>{target(item)}</strong>{" "}
              <span>{p.states[item.state](item.generation)}</span>
              <span className="hint">
                {" "}
                · {formatInstant(locale, item.updatedAt)}
                {item.authorIsCaller ? ` · ${p.byYou}` : ""}
              </span>
              {item.reason && item.state !== "published" && (
                <span className="hint">
                  {" "}
                  · {p.reasons[item.reason] ?? t.generic}
                </span>
              )}
              {canRetry &&
                (item.state === "blocked" || item.state === "failed") && (
                  <button
                    type="button"
                    disabled={retry.isPending}
                    onClick={() => retry.mutate(item.id)}
                  >
                    {retry.isPending && retry.variables === item.id
                      ? p.retrying
                      : p.retry}
                  </button>
                )}
            </li>
          ))}
        </ul>
      )}
      {retry.error && <Failure error={retry.error} operation="write" />}
    </section>
  );
}

function MoveForm({
  companyId,
  record,
  onChanged,
}: {
  companyId: string;
  record: CatalogRecord;
  onChanged: (changed: CatalogRecord) => void;
}) {
  const { t } = useCatalogMessages();
  const [after, setAfter] = useState("");
  const [text, setText] = useState("");
  const records = useRecordChoices(companyId, record.catalogId, text);
  const move = useMutation({
    mutationFn: (target: string | null) =>
      moveRecord(companyId, record, target),
    onSuccess: onChanged,
  });
  return (
    <form
      className="catalog-field-row"
      aria-labelledby="catalog-move-title"
      onSubmit={(event) => {
        event.preventDefault();
        if (after) move.mutate(after);
      }}
    >
      <h2 id="catalog-move-title">{t.moveTitle}</h2>
      <button
        type="button"
        disabled={move.isPending || mustReload(move.error)}
        onClick={() => move.mutate(null)}
      >
        {t.moveTop}
      </button>
      <label htmlFor="catalog-move-after">{t.moveAfter}</label>
      <PickerSearch
        label={`${t.searchRecords}: ${t.moveAfter}`}
        value={text}
        onChange={setText}
      />
      <select
        id="catalog-move-after"
        value={after}
        onChange={(event) => setAfter(event.target.value)}
      >
        <option value="">{t.chooseRecord}</option>
        {(records.data?.items ?? [])
          .filter((item) => item.id !== record.id)
          .map((item) => (
            <option key={item.id} value={item.id}>
              {item.title ?? t.untitled}
            </option>
          ))}
      </select>
      <button
        type="submit"
        disabled={!after || move.isPending || mustReload(move.error)}
      >
        {t.move}
      </button>
      {move.error && <Failure error={move.error} operation="write" />}
    </form>
  );
}

function RecordDetail({
  companyId,
  catalogId,
  recordId,
  filter,
  company,
}: {
  companyId: string;
  catalogId: string;
  recordId: string;
  filter: RecordFilter;
  company: CompanyWithAccess;
}) {
  const { t } = useCatalogMessages();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [notice, setNotice] = useState<string | null>(null);
  const catalog = useQuery({
    queryKey: catalogKey(companyId, catalogId),
    queryFn: () => getCatalog(companyId, catalogId),
  });
  const record = useQuery({
    queryKey: recordKey(companyId, catalogId, recordId),
    queryFn: () => getRecord(companyId, catalogId, recordId),
  });
  const branches = useBranchChoices(companyId);
  // Only the record: mutations would pass their variables as a second argument.
  const onChanged = (changed: CatalogRecord) => {
    setNotice(t.saved);
    queryClient.setQueryData(
      recordKey(companyId, catalogId, recordId),
      changed,
    );
    void queryClient.invalidateQueries({
      queryKey: recordsKey(companyId, catalogId),
    });
    // A price change may have queued publications.
    void queryClient.invalidateQueries({
      queryKey: pricePublicationsKey(companyId, catalogId),
    });
  };
  const onPromotions = () => {
    void queryClient.invalidateQueries({
      queryKey: ["catalogs", "effective", companyId, catalogId, recordId],
    });
    void queryClient.invalidateQueries({
      queryKey: pricePublicationsKey(companyId, catalogId),
    });
  };
  if (catalog.isPending || record.isPending) return <p>{t.loading}</p>;
  if (catalog.isError || record.isError)
    return (
      <>
        <Failure
          error={catalog.error ?? record.error}
          operation="read"
          onReload={() => {
            void catalog.refetch();
            void record.refetch();
          }}
        />
        <BackToCatalogs companyId={companyId} />
      </>
    );
  const item = record.data;
  const active = catalog.data.status === "ACTIVE";
  const edit = can(company, "catalogs.edit") && active;
  const prices = can(company, "prices.edit") && active;
  const money = catalog.data.fields.filter(
    (field) => field.type === "money" && !field.archived,
  );
  const view =
    ((filter.view === "prices" || filter.view === "publications") &&
      !money.length) ||
    (filter.view === "settings" && !edit)
      ? undefined
      : filter.view;
  const itemSearch = { text: filter.text, cursor: filter.cursor };
  const views = [
    { view: undefined, label: t.workspace.recordDetails, icon: "form" },
    ...(money.length
      ? ([
          { view: "prices", label: t.pricesTitle, icon: "grid" },
          {
            view: "publications",
            label: t.pricePublications.title,
            icon: "refresh",
          },
        ] as const)
      : []),
    ...(edit
      ? [{ view: "settings", label: t.views.settings, icon: "more" } as const]
      : []),
  ] as const;
  return (
    <>
      <p className="catalog-breadcrumb">
        <Link
          to="/companies/$companyId/catalogs/$catalogId"
          params={{ companyId, catalogId }}
          search={itemSearch}
        >
          <UiIcon name="previous" />
          {catalog.data.name}
        </Link>
      </p>
      <CatalogHeading title={item.title ?? t.untitled} icon="form" />
      <div className="catalog-detail-meta">
        <span>{scopeName(catalog.data.branch, t)}</span>
        <CatalogBadge
          label={item.available ? t.workspace.available : t.unavailable}
          live={item.available}
        />
      </div>
      <nav className="catalog-tabs" aria-label={t.workspace.recordViews}>
        {views.map((entry) => (
          <Link
            key={entry.view ?? "details"}
            to="/companies/$companyId/catalogs/$catalogId/items/$recordId"
            params={{ companyId, catalogId, recordId }}
            search={{ ...itemSearch, view: entry.view }}
            activeOptions={{ exact: true }}
            aria-current={view === entry.view ? "page" : false}
          >
            <UiIcon name={entry.icon} />
            {entry.label}
          </Link>
        ))}
      </nav>
      {!active && (
        <p role="status" className="notice">
          {t.archivedNotice}
        </p>
      )}
      {notice && (
        <p role="status" className="notice notice-success">
          {notice}
        </p>
      )}
      <Activity mode={view === undefined ? "visible" : "hidden"}>
        {edit ? (
          <ValuesForm
            key={`values-${item.version}`}
            companyId={companyId}
            catalog={catalog.data}
            record={item}
            title={t.editItemTitle}
            submitLabel={t.save}
            run={(values, available) =>
              updateRecord(companyId, item, { values, available })
            }
            onDone={(changed) => onChanged(changed as CatalogRecord)}
          />
        ) : (
          <ValueList catalog={catalog.data} record={item} />
        )}
      </Activity>
      {money.length > 0 && (
        <Activity mode={view === "prices" ? "visible" : "hidden"}>
          <section aria-labelledby="catalog-prices-title">
            <h2 id="catalog-prices-title">{t.pricesTitle}</h2>
            <p className="hint">{t.pricesLead}</p>
            {money.map((field) => (
              <PriceSection
                key={field.id}
                companyId={companyId}
                catalog={catalog.data}
                record={item}
                field={field}
                branches={branches.data?.items ?? []}
                editable={prices}
                onChanged={onChanged}
                onPromotions={onPromotions}
              />
            ))}
            <EffectivePrices
              companyId={companyId}
              catalog={catalog.data}
              record={item}
            />
          </section>
        </Activity>
      )}
      {view === "publications" && (
        <PricePublications
          companyId={companyId}
          catalogId={catalogId}
          canRetry={can(company, "publications.publish")}
        />
      )}
      {view === "settings" && edit && (
        <div className="catalog-settings-stack">
          <MoveForm
            key={`move-${item.version}`}
            companyId={companyId}
            record={item}
            onChanged={onChanged}
          />
          <details className="catalog-disclosure catalog-destructive">
            <summary>{t.deleteItemTitle}</summary>
            <ConfirmedDelete
              key={`delete-${item.version}`}
              title={t.deleteItemTitle}
              lead={t.deleteItemLead}
              confirm={t.deleteItemConfirm(item.title ?? t.untitled)}
              label={t.deleteItem}
              run={() => deleteRecord(companyId, item)}
              onDone={() => {
                void queryClient.invalidateQueries({
                  queryKey: recordsKey(companyId, catalogId),
                });
                void queryClient.invalidateQueries({
                  queryKey: catalogKey(companyId, catalogId),
                });
                void queryClient.invalidateQueries({
                  queryKey: catalogsKey(companyId),
                });
                void navigate({
                  to: "/companies/$companyId/catalogs/$catalogId",
                  params: { companyId, catalogId },
                  search: itemSearch,
                });
              }}
            />
          </details>
        </div>
      )}
    </>
  );
}

export function RecordPage({
  companyId,
  catalogId,
  recordId,
  filter,
}: {
  companyId: string;
  catalogId: string;
  recordId: string;
  filter: RecordFilter;
}) {
  return (
    <CompanyGate
      companyId={companyId}
      returnTo={withSearch(
        `/companies/${companyId}/catalogs/${catalogId}/items/${recordId}`,
        filter,
      )}
    >
      {(company) => (
        <RecordDetail
          companyId={companyId}
          catalogId={catalogId}
          recordId={recordId}
          filter={filter}
          company={company}
        />
      )}
    </CompanyGate>
  );
}
