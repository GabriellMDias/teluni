import {
  useDeferredValue,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ApiFailure, type ApiIssue } from "../api-client.js";
import { loginHref, sessionQuery } from "../identity/api.js";
import { browserLocale, type Locale } from "../locale.js";
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
  listPromotions,
  listRecords,
  listSelectableImages,
  moveRecord,
  promotionsKey,
  recordKey,
  recordsKey,
  replaceSchema,
  setBasePrice,
  setBranchPrice,
  updateCatalog,
  updateRecord,
  type Catalog,
  type CatalogRecord,
  type Field,
  type FieldInput,
  type FieldType,
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
}>;

export type CatalogFilter = Readonly<{
  view?: "fields";
  cursor?: string;
  text?: string;
}>;

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

function StepUpPrompt({ returnTo }: { returnTo: string }) {
  const { t } = useCatalogMessages();
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
    body =
      company.error instanceof ApiFailure &&
      company.error.code === "STRONG_AUTHENTICATION_REQUIRED" ? (
        <StepUpPrompt returnTo={returnTo} />
      ) : (
        <Failure
          error={company.error}
          operation="read"
          onReload={() => void company.refetch()}
        />
      );
  else if (company.data && !can(company.data, "catalogs.view"))
    body = company.data.access.capabilitiesAfterStrongAuthentication.includes(
      "catalogs.view",
    ) ? (
      <StepUpPrompt returnTo={returnTo} />
    ) : (
      <p role="alert" className="notice notice-error">
        {t.errors.PERMISSION_DENIED}
      </p>
    );
  else if (company.data) body = children(company.data);
  return (
    <section
      className="panel organization-panel catalogs-panel"
      aria-labelledby="catalogs-title"
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
  branches,
}: {
  companyId: string;
  branches: { id: string; name: string }[];
}) {
  const { t } = useCatalogMessages();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [scope, setScope] = useState("company");
  const [preset, setPreset] = useState<Preset>("products");
  const create = useMutation({
    mutationFn: () =>
      createCatalog(companyId, {
        name,
        branchId: scope === "company" ? null : scope,
        fields: presetFields(preset, t),
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
      <label htmlFor="catalog-name">{t.fieldName}</label>
      <input
        id="catalog-name"
        required
        maxLength={120}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <label htmlFor="catalog-scope">{t.fieldScope}</label>
      <select
        id="catalog-scope"
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
      {create.error && <Failure error={create.error} operation="write" />}
      <button
        type="submit"
        className="button-primary"
        disabled={create.isPending || !name.trim()}
      >
        {create.isPending ? t.creating : t.create}
      </button>
    </form>
  );
}

function CatalogList({
  companyId,
  filter,
}: {
  companyId: string;
  filter: CatalogsFilter;
}) {
  const { t } = useCatalogMessages();
  const navigate = useNavigate();
  const [text, setText] = useState(filter.text ?? "");
  const [archived, setArchived] = useState(filter.status === "ARCHIVED");
  const catalogs = useQuery({
    queryKey: [...catalogsKey(companyId), filter],
    queryFn: () =>
      listCatalogs(companyId, {
        status: filter.status ?? "ACTIVE",
        ...(filter.cursor ? { cursor: filter.cursor } : {}),
        ...(filter.text ? { text: filter.text } : {}),
      }),
  });
  const base = {
    ...(filter.text ? { text: filter.text } : {}),
    ...(filter.status ? { status: filter.status } : {}),
  };
  return (
    <section aria-labelledby="catalog-list-title">
      <h2 id="catalog-list-title">{t.title}</h2>
      <form
        role="search"
        className="catalog-filters"
        onSubmit={(event) => {
          event.preventDefault();
          void navigate({
            to: "/companies/$companyId/catalogs",
            params: { companyId },
            search: {
              ...(text.trim() ? { text: text.trim() } : {}),
              ...(archived ? { status: "ARCHIVED" as const } : {}),
            },
          });
        }}
      >
        <label htmlFor="catalog-text">{t.filterText}</label>{" "}
        <input
          id="catalog-text"
          type="search"
          maxLength={120}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />{" "}
        <label htmlFor="catalog-status">{t.statusFilter}</label>{" "}
        <select
          id="catalog-status"
          value={archived ? "ARCHIVED" : "ACTIVE"}
          onChange={(event) => setArchived(event.target.value === "ARCHIVED")}
        >
          <option value="ACTIVE">{t.statusActive}</option>
          <option value="ARCHIVED">{t.statusArchived}</option>
        </select>{" "}
        <button type="submit">{t.search}</button>
      </form>
      {catalogs.isPending ? (
        <p>{t.loading}</p>
      ) : catalogs.isError ? (
        <Failure
          error={catalogs.error}
          operation="read"
          onReload={() => void catalogs.refetch()}
        />
      ) : catalogs.data.items.length === 0 ? (
        <p className="empty-state">
          {filter.cursor ? t.pageEmpty : t.catalogsEmpty}
        </p>
      ) : (
        <ul className="catalog-list">
          {catalogs.data.items.map((catalog) => (
            <li key={catalog.id}>
              <Link
                to="/companies/$companyId/catalogs/$catalogId"
                params={{ companyId, catalogId: catalog.id }}
              >
                {catalog.name}
              </Link>
              <span className="hint">
                {scopeName(catalog.branch, t)} ·{" "}
                {t.catalogSummary(
                  catalog.recordCount,
                  catalog.fields.filter((field) => !field.archived).length,
                )}
                {catalog.status === "ARCHIVED" ? ` · ${t.archivedBadge}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
      <nav className="pagination" aria-label={t.title}>
        {filter.cursor && (
          <Link
            to="/companies/$companyId/catalogs"
            params={{ companyId }}
            search={base}
          >
            {t.firstPage}
          </Link>
        )}
        {catalogs.data?.nextCursor && (
          <Link
            to="/companies/$companyId/catalogs"
            params={{ companyId }}
            search={{ ...base, cursor: catalogs.data.nextCursor }}
          >
            {t.nextPage}
          </Link>
        )}
      </nav>
    </section>
  );
}

export function CatalogsPage({
  companyId,
  filter,
}: {
  companyId: string;
  filter: CatalogsFilter;
}) {
  const { t } = useCatalogMessages();
  const branches = useBranchChoices(companyId);
  const search = new URLSearchParams(
    Object.entries(filter).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  const returnTo = `/companies/${companyId}/catalogs${search.size ? `?${search}` : ""}`;
  return (
    <CompanyGate companyId={companyId} returnTo={returnTo}>
      {(company) => (
        <>
          <h1 id="catalogs-title">{t.title}</h1>
          <p>{t.lead}</p>
          {can(company, "catalogs.manage") && (
            <CreateCatalogForm
              companyId={companyId}
              branches={branches.data?.items ?? []}
            />
          )}
          <CatalogList companyId={companyId} filter={filter} />
        </>
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
}: {
  companyId: string;
  catalog: Catalog;
  record: CatalogRecord | null;
  title: string;
  submitLabel: string;
  run: (values: Record<string, Value>, available: boolean) => Promise<unknown>;
  onDone: (result: unknown) => void;
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
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={available}
          onChange={(event) => setAvailable(event.target.checked)}
        />
        {t.availableLabel}
      </label>
      {save.error && (
        <Failure error={save.error} operation="write" label={label} />
      )}
      <button
        type="submit"
        className="button-primary"
        disabled={save.isPending || mustReload(save.error)}
      >
        {save.isPending ? t.saving : submitLabel}
      </button>
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
}: {
  companyId: string;
  catalog: Catalog;
  filter: CatalogFilter;
}) {
  const { t } = useCatalogMessages();
  const navigate = useNavigate();
  const [text, setText] = useState(filter.text ?? "");
  const records = useQuery({
    queryKey: [...recordsKey(companyId, catalog.id), filter],
    queryFn: () =>
      listRecords(companyId, catalog.id, {
        ...(filter.cursor ? { cursor: filter.cursor } : {}),
        ...(filter.text ? { text: filter.text } : {}),
      }),
  });
  return (
    <section aria-labelledby="catalog-items-title">
      <h2 id="catalog-items-title">{t.itemsTitle}</h2>
      <form
        role="search"
        className="catalog-filters"
        onSubmit={(event) => {
          event.preventDefault();
          void navigate({
            to: "/companies/$companyId/catalogs/$catalogId",
            params: { companyId, catalogId: catalog.id },
            search: text.trim() ? { text: text.trim() } : {},
          });
        }}
      >
        <label htmlFor="catalog-item-text">{t.filterText}</label>{" "}
        <input
          id="catalog-item-text"
          type="search"
          maxLength={120}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />{" "}
        <button type="submit">{t.search}</button>
      </form>
      {records.isPending ? (
        <p>{t.loading}</p>
      ) : records.isError ? (
        <Failure
          error={records.error}
          operation="read"
          onReload={() => void records.refetch()}
        />
      ) : records.data.items.length === 0 ? (
        <p className="empty-state">
          {filter.cursor ? t.pageEmpty : t.itemsEmpty}
        </p>
      ) : (
        <ol className="catalog-list">
          {records.data.items.map((record) => (
            <li key={record.id}>
              <Link
                to="/companies/$companyId/catalogs/$catalogId/items/$recordId"
                params={{
                  companyId,
                  catalogId: catalog.id,
                  recordId: record.id,
                }}
              >
                {record.title ?? t.untitled}
              </Link>
              {!record.available && (
                <span className="hint">{t.unavailable}</span>
              )}
            </li>
          ))}
        </ol>
      )}
      <nav className="pagination" aria-label={t.itemsTitle}>
        {filter.cursor && (
          <Link
            to="/companies/$companyId/catalogs/$catalogId"
            params={{ companyId, catalogId: catalog.id }}
            search={filter.text ? { text: filter.text } : {}}
          >
            {t.firstPage}
          </Link>
        )}
        {records.data?.nextCursor && (
          <Link
            to="/companies/$companyId/catalogs/$catalogId"
            params={{ companyId, catalogId: catalog.id }}
            search={{ ...filter, cursor: records.data.nextCursor }}
          >
            {t.nextPage}
          </Link>
        )}
      </nav>
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
  return (
    <form
      className="form-stack"
      aria-labelledby="catalog-settings-title"
      onSubmit={(event) => {
        event.preventDefault();
        rename.mutate();
      }}
    >
      <h2 id="catalog-settings-title">{t.settingsTitle}</h2>
      <label htmlFor="catalog-rename">{t.fieldName}</label>
      <input
        id="catalog-rename"
        required
        maxLength={120}
        disabled={catalog.status === "ARCHIVED"}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      {(rename.error ?? status.error) && (
        <Failure error={rename.error ?? status.error} operation="write" />
      )}
      <div className="catalog-field-actions">
        <button
          type="submit"
          className="button-primary"
          disabled={
            rename.isPending ||
            catalog.status === "ARCHIVED" ||
            name.trim() === catalog.name
          }
        >
          {rename.isPending ? t.saving : t.save}
        </button>
        <button
          type="button"
          disabled={status.isPending}
          onClick={() => status.mutate()}
        >
          {catalog.status === "ARCHIVED" ? t.restoreCatalog : t.archiveCatalog}
        </button>
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
  const view = filter.view ?? "items";
  return (
    <>
      <BackToCatalogs companyId={companyId} />
      <h1 id="catalogs-title">{item.name}</h1>
      <p className="hint">
        {scopeName(item.branch, t)} ·{" "}
        {t.catalogSummary(
          item.recordCount,
          item.fields.filter((field) => !field.archived).length,
        )}
      </p>
      {!active && (
        <p role="status" className="notice">
          {t.archivedNotice}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <nav className="company-navigation" aria-label={t.viewsLabel}>
        <Link
          to="/companies/$companyId/catalogs/$catalogId"
          params={{ companyId, catalogId }}
          search={{}}
          aria-current={view === "items" ? "page" : undefined}
        >
          {t.views.items}
        </Link>
        <Link
          to="/companies/$companyId/catalogs/$catalogId"
          params={{ companyId, catalogId }}
          search={{ view: "fields" }}
          aria-current={view === "fields" ? "page" : undefined}
        >
          {t.views.fields}
        </Link>
      </nav>
      {view === "fields" ? (
        can(company, "catalogs.manage") && active ? (
          <SchemaEditor
            key={`schema-${item.version}`}
            companyId={companyId}
            catalog={item}
            onChanged={onChanged}
          />
        ) : (
          <FieldList catalog={item} />
        )
      ) : (
        <>
          {can(company, "catalogs.edit") && active && (
            <ValuesForm
              key={`new-${item.version}`}
              companyId={companyId}
              catalog={item}
              record={null}
              title={t.newItemTitle}
              submitLabel={t.addItem}
              run={(values, available) =>
                createRecord(companyId, catalogId, values, available)
              }
              onDone={(created) => {
                void queryClient.invalidateQueries({
                  queryKey: catalogKey(companyId, catalogId),
                });
                void navigate({
                  to: "/companies/$companyId/catalogs/$catalogId/items/$recordId",
                  params: {
                    companyId,
                    catalogId,
                    recordId: (created as CatalogRecord).id,
                  },
                });
              }}
            />
          )}
          <RecordList companyId={companyId} catalog={item} filter={filter} />
        </>
      )}
      {can(company, "catalogs.manage") && (
        <>
          <CatalogSettings
            key={`settings-${item.version}`}
            companyId={companyId}
            catalog={item}
            onChanged={onChanged}
          />
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
        </>
      )}
    </>
  );
}

function BackToCatalogs({ companyId }: { companyId: string }) {
  const { t } = useCatalogMessages();
  return (
    <p className="hint">
      <Link to="/companies/$companyId/catalogs" params={{ companyId }}>
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
      returnTo={`/companies/${companyId}/catalogs/${catalogId}`}
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
  return (
    <form
      className="catalog-amount"
      aria-label={label}
      onSubmit={(event) => {
        event.preventDefault();
        if (parsed !== undefined) save.mutate(parsed);
      }}
    >
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        inputMode="decimal"
        aria-invalid={parsed === undefined}
        aria-describedby={parsed === undefined ? `${id}-invalid` : undefined}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <span className="hint">
        {amount === null ? t.noPrice : formatAmount(amount, currency, locale)}
      </span>
      {parsed === undefined && (
        <p id={`${id}-invalid`} className="catalog-field-issue">
          {t.amountInvalid}
        </p>
      )}
      <button
        type="submit"
        disabled={
          disabled ||
          save.isPending ||
          parsed === undefined ||
          parsed === amount ||
          mustReload(save.error)
        }
      >
        {save.isPending ? t.saving : t.save}
      </button>
      {amount !== null && (
        <button
          type="button"
          disabled={disabled || save.isPending || mustReload(save.error)}
          onClick={() => save.mutate(null)}
        >
          {t.clear}
        </button>
      )}
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
                  disabled={remove.isPending}
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
          className="catalog-field-row"
          aria-label={t.addPromotion}
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
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
          <label className="catalog-setting">
            {t.amountLabel(currency)}
            <input
              inputMode="decimal"
              required
              aria-invalid={amount === undefined}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <label className="catalog-setting">
            {t.promotionStart}
            <input
              type="datetime-local"
              required
              value={startsAt}
              onChange={(event) => setStartsAt(event.target.value)}
            />
          </label>
          <label className="catalog-setting">
            {t.promotionEnd}
            <input
              type="datetime-local"
              required
              value={endsAt}
              onChange={(event) => setEndsAt(event.target.value)}
            />
          </label>
          <button
            type="submit"
            disabled={
              create.isPending ||
              amount === undefined ||
              amount === null ||
              !startsAt ||
              !endsAt
            }
          >
            {t.addPromotion}
          </button>
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
    <section aria-labelledby="catalog-effective-title">
      <h3 id="catalog-effective-title">{t.effectiveTitle}</h3>
      <label htmlFor="catalog-effective-at">{t.effectiveAt}</label>{" "}
      <input
        id="catalog-effective-at"
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
  company,
}: {
  companyId: string;
  catalogId: string;
  recordId: string;
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
  };
  const onPromotions = () => {
    void queryClient.invalidateQueries({
      queryKey: ["catalogs", "effective", companyId, catalogId, recordId],
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
  return (
    <>
      <p className="hint">
        <Link
          to="/companies/$companyId/catalogs/$catalogId"
          params={{ companyId, catalogId }}
        >
          {t.backToCatalog}
        </Link>
      </p>
      <h1 id="catalogs-title">{item.title ?? t.untitled}</h1>
      <p className="hint">
        {catalog.data.name}
        {item.available ? "" : ` · ${t.unavailable}`}
      </p>
      {!active && (
        <p role="status" className="notice">
          {t.archivedNotice}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!edit && <ValueList catalog={catalog.data} record={item} />}
      {edit && (
        <>
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
          <MoveForm
            key={`move-${item.version}`}
            companyId={companyId}
            record={item}
            onChanged={onChanged}
          />
        </>
      )}
      {money.length > 0 && (
        <section aria-labelledby="catalog-prices-title">
          <h2 id="catalog-prices-title">{t.pricesTitle}</h2>
          <p className="hint">{t.pricesLead}</p>
          {prices && <p className="hint">{t.pricesStrongHint}</p>}
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
      )}
      {edit && (
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
            void navigate({
              to: "/companies/$companyId/catalogs/$catalogId",
              params: { companyId, catalogId },
            });
          }}
        />
      )}
    </>
  );
}

export function RecordPage({
  companyId,
  catalogId,
  recordId,
}: {
  companyId: string;
  catalogId: string;
  recordId: string;
}) {
  return (
    <CompanyGate
      companyId={companyId}
      returnTo={`/companies/${companyId}/catalogs/${catalogId}/items/${recordId}`}
    >
      {(company) => (
        <RecordDetail
          companyId={companyId}
          catalogId={catalogId}
          recordId={recordId}
          company={company}
        />
      )}
    </CompanyGate>
  );
}
