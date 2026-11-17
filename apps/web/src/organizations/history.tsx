import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Button, DataSet, TextField } from "../components.js";
import type { DataSetColumn } from "../dataset.js";
import type { Locale } from "../locale.js";
import { NavigationIcon } from "../navigation-icon.js";
import { UiIcon } from "../ui-icon.js";
import { auditKey, describe, listAuditEvents, type AuditEvent } from "./api.js";
import { formatInstant } from "./members.js";
import type { OrganizationMessages } from "./messages.js";

export const historyCategories = [
  "company",
  "branches",
  "members",
  "profiles",
  "invitations",
  "responsibility",
  "other",
] as const;
type HistoryCategory = (typeof historyCategories)[number];

/** Validated route-owned filters apply only to the current authorized API page. */
export type HistorySearch = {
  historyQuery?: string;
  historyCategory?: HistoryCategory;
  historyActor?: "me" | "others";
  historyMode?: "grid";
  historyEvent?: string;
};

const actionCategories: Readonly<Record<string, HistoryCategory>> = {
  "company.created": "company",
  "company.updated": "company",
  "branch.created": "branches",
  "branch.updated": "branches",
  "branch.archived": "branches",
  "membership.status_changed": "members",
  "grant.created": "members",
  "grant.revoked": "members",
  "profile.created": "profiles",
  "profile.updated": "profiles",
  "profile.archived": "profiles",
  "invitation.created": "invitations",
  "invitation.resent": "invitations",
  "invitation.revoked": "invitations",
  "invitation.accepted": "invitations",
  "responsibility.transfer_requested": "responsibility",
  "responsibility.transferred": "responsibility",
  "responsibility.transfer_declined": "responsibility",
  "responsibility.transfer_cancelled": "responsibility",
};
const categoryIcons = {
  company: "companies",
  branches: "branches",
  members: "members",
  profiles: "profiles",
  invitations: "invitations",
  responsibility: "members",
  other: "history",
} as const;

function message(
  labels: Readonly<Record<string, string>>,
  key: unknown,
): string | undefined {
  return typeof key === "string" &&
    Object.hasOwn(labels, key) &&
    typeof labels[key] === "string"
    ? labels[key]
    : undefined;
}
function categoryOf(event: AuditEvent): HistoryCategory {
  return Object.hasOwn(actionCategories, event.action)
    ? actionCategories[event.action]
    : "other";
}
function eventTitle(event: AuditEvent, t: OrganizationMessages): string {
  return message(t.historyActions, event.action) ?? t.historyUnknown;
}
function actorName(
  event: AuditEvent,
  principalId: string,
  t: OrganizationMessages,
): string {
  return event.actorPrincipalId === principalId
    ? t.historyYou
    : event.actorDisplayName?.trim() || t.historyMember;
}
function targetName(event: AuditEvent, t: OrganizationMessages): string {
  if (
    event.targetType === "branch" &&
    typeof event.details.branchName === "string"
  )
    return event.details.branchName;
  if (
    event.targetType === "access_profile" &&
    typeof event.details.profileName === "string"
  )
    return event.details.profileName;
  return (
    message(t.historyWorkspace.targets, event.targetType) ??
    t.historyWorkspace.targets.other
  );
}
function changedFields(event: AuditEvent, t: OrganizationMessages): string[] {
  if (!Array.isArray(event.details.fields)) return [];
  return [
    ...new Set(
      event.details.fields.flatMap((field) => {
        const label = message(
          t.historyFields,
          event.targetType === "access_profile" && field === "name"
            ? "profileName"
            : field,
        );
        return label ? [label] : [];
      }),
    ),
  ];
}
function permissionNames(value: unknown, t: OrganizationMessages): string[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value.flatMap((key) => {
            const label = message(t.capabilities, key);
            return label ? [label] : [];
          }),
        ),
      ]
    : [];
}
function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}
function summary(event: AuditEvent, t: OrganizationMessages): string[] {
  const parts: string[] = [];
  const role = message(t.roles, event.details.role);
  if (role) parts.push(`${t.historyRole}: ${role}`);
  if (typeof event.details.profileName === "string")
    parts.push(`${t.historyProfile}: ${event.details.profileName}`);
  if (
    event.targetType === "branch" &&
    typeof event.details.branchName === "string"
  )
    parts.push(`${t.fieldBranchName}: ${event.details.branchName}`);
  const status = message(t.memberStatuses, event.details.status);
  if (event.action === "membership.status_changed" && status)
    parts.push(`${t.historyWorkspace.newStatus}: ${status}`);
  const fields = changedFields(event, t);
  if (fields.length) parts.push(fields.join(", "));
  return parts;
}

function EventContext({
  event,
  locale,
  t,
}: {
  event: AuditEvent;
  locale: Locale;
  t: OrganizationMessages;
}) {
  const copy = t.historyWorkspace;
  const fields = changedFields(event, t);
  const role = message(t.roles, event.details.role);
  const previous = message(t.memberStatuses, event.details.previousStatus);
  const status = message(t.memberStatuses, event.details.status);
  const affected = count(event.details.affectedGrants);
  const branches = count(event.details.branchCount);
  const permissions = [
    {
      label: copy.permissions,
      values: permissionNames(event.details.capabilities, t),
      kind: "current",
    },
    {
      label: copy.permissionsAdded,
      values: permissionNames(event.details.addedCapabilities, t),
      kind: "added",
    },
    {
      label: copy.permissionsRemoved,
      values: permissionNames(event.details.removedCapabilities, t),
      kind: "removed",
    },
  ].filter((group) => group.values.length > 0);
  const expiry = (value: unknown) =>
    value === null
      ? copy.noExpiry
      : typeof value === "string" && Number.isFinite(Date.parse(value))
        ? formatInstant(locale, value)
        : undefined;
  const accessExpiry = expiry(
    event.action.startsWith("invitation.")
      ? event.details.grantExpiresAt
      : event.action.startsWith("grant.")
        ? event.details.expiresAt
        : undefined,
  );
  const linkExpiry = event.action.startsWith("invitation.")
    ? expiry(event.details.expiresAt)
    : undefined;
  const hasContext =
    role ||
    typeof event.details.profileName === "string" ||
    event.details.scope === "COMPANY" ||
    event.details.scope === "BRANCHES" ||
    affected !== undefined ||
    accessExpiry ||
    linkExpiry ||
    (event.action === "membership.status_changed" && status);
  return (
    <div className="history-context-grid">
      {fields.length > 0 && (
        <section className="history-context-card">
          <h4>{copy.changedFields}</h4>
          <ul className="history-field-tags">
            {fields.map((field) => (
              <li key={field}>{field}</li>
            ))}
          </ul>
          <p className="hint">{copy.fieldsHint}</p>
        </section>
      )}
      {hasContext && (
        <section className="history-context-card">
          <h4>{copy.context}</h4>
          <dl>
            {role && (
              <>
                <dt>{t.historyRole}</dt>
                <dd>{role}</dd>
              </>
            )}
            {typeof event.details.profileName === "string" && (
              <>
                <dt>{t.historyProfile}</dt>
                <dd>{event.details.profileName}</dd>
              </>
            )}
            {event.action === "membership.status_changed" && status && (
              <>
                <dt>{copy.membershipStatus}</dt>
                <dd>
                  {previous && (
                    <>
                      {previous} <UiIcon name="next" />{" "}
                    </>
                  )}
                  {status}
                </dd>
              </>
            )}
            {(event.details.scope === "COMPANY" ||
              event.details.scope === "BRANCHES") && (
              <>
                <dt>{t.grantScope}</dt>
                <dd>
                  {event.details.scope === "COMPANY"
                    ? t.grantCompanyWide
                    : branches !== undefined
                      ? copy.branchCount(branches)
                      : t.grantScopeBranches}
                </dd>
              </>
            )}
            {accessExpiry && (
              <>
                <dt>{copy.accessExpiry}</dt>
                <dd>{accessExpiry}</dd>
              </>
            )}
            {linkExpiry && (
              <>
                <dt>{copy.linkExpiry}</dt>
                <dd>{linkExpiry}</dd>
              </>
            )}
            {affected !== undefined && (
              <>
                <dt>{copy.affectedGrants}</dt>
                <dd>{affected}</dd>
              </>
            )}
          </dl>
        </section>
      )}
      {permissions.map((group) => (
        <section
          key={group.kind}
          className="history-context-card"
          data-change={group.kind}
        >
          <h4>{group.label}</h4>
          <ul className="history-permission-list">
            {group.values.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        </section>
      ))}
      {!fields.length && !hasContext && !permissions.length && (
        <p className="empty-state">{copy.noContext}</p>
      )}
    </div>
  );
}

function EventDetail({
  event,
  principalId,
  locale,
  t,
}: {
  event: AuditEvent;
  principalId: string;
  locale: Locale;
  t: OrganizationMessages;
}) {
  const copy = t.historyWorkspace;
  const category = categoryOf(event);
  return (
    <article className="history-detail" aria-labelledby="history-event-title">
      <header className="history-detail-header">
        <span className="history-event-icon">
          <NavigationIcon name={categoryIcons[category]} />
        </span>
        <div>
          <span className="history-category">{copy.categories[category]}</span>
          <h3 id="history-event-title">{eventTitle(event, t)}</h3>
        </div>
      </header>
      <dl className="history-event-overview">
        <div>
          <dt>{copy.when}</dt>
          <dd>
            <time dateTime={event.occurredAt}>
              {formatInstant(locale, event.occurredAt)}
            </time>
          </dd>
        </div>
        <div>
          <dt>{copy.who}</dt>
          <dd>{actorName(event, principalId, t)}</dd>
        </div>
        <div>
          <dt>{copy.target}</dt>
          <dd>{targetName(event, t)}</dd>
        </div>
      </dl>
      <EventContext {...{ event, locale, t }} />
      <details className="history-references">
        <summary>{copy.references}</summary>
        <dl>
          <dt>{copy.eventId}</dt>
          <dd>
            <code>{event.id}</code>
          </dd>
          <dt>{copy.targetId}</dt>
          <dd>
            <code>{event.targetId}</code>
          </dd>
          <dt>{copy.actorId}</dt>
          <dd>
            <code>{event.actorPrincipalId}</code>
          </dd>
          <dt>{copy.actionCode}</dt>
          <dd>
            <code>{event.action}</code>
          </dd>
        </dl>
      </details>
    </article>
  );
}

/** Read-only organization audit; every read remains scoped by the API and access revision. */
export function CompanyHistory({
  companyId,
  principalId,
  administrator,
  accessScope,
  cursor,
  search,
  locale,
  t,
}: {
  companyId: string;
  principalId: string;
  administrator: boolean;
  accessScope: string;
  cursor?: string;
  search: HistorySearch;
  locale: Locale;
  t: OrganizationMessages;
}) {
  const navigate = useNavigate();
  const copy = t.historyWorkspace;
  const events = useQuery({
    queryKey: [
      ...auditKey(companyId),
      principalId,
      accessScope,
      cursor ?? null,
    ],
    queryFn: () => listAuditEvents(companyId, cursor),
    gcTime: 0,
  });
  const [selectedId, setSelectedId] = useState<string>();
  const selection = useRef<string | undefined>(undefined);
  const { historyEvent, ...filters } = search;
  const text = search.historyQuery ?? "";
  const category = search.historyCategory ?? "all";
  const actor = search.historyActor ?? "all";
  const grid = search.historyMode === "grid";
  const changeSearch = (next: HistorySearch, replace = false) => {
    void navigate({
      to: "/companies/$companyId",
      params: { companyId },
      search: { view: "history", cursor, ...next },
      replace,
      resetScroll: false,
    });
  };
  const normalize = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase(locale)
      .trim();
  const term = normalize(text);
  const items = events.data?.items ?? [];
  const rows = items.filter(
    (event) =>
      (category === "all" || categoryOf(event) === category) &&
      (actor === "all" ||
        (event.actorPrincipalId === principalId) === (actor === "me")) &&
      (!term ||
        normalize(
          [
            eventTitle(event, t),
            targetName(event, t),
            actorName(event, principalId, t),
            ...summary(event, t),
          ].join(" "),
        ).includes(term)),
  );
  const detail = historyEvent
    ? items.find((event) => event.id === historyEvent)
    : undefined;
  const dateFormatter = new Intl.DateTimeFormat(locale, { dateStyle: "long" });
  const timeFormatter = new Intl.DateTimeFormat(locale, { timeStyle: "short" });
  const days = new Map<string, AuditEvent[]>();
  for (const event of rows) {
    const day = dateFormatter.format(new Date(event.occurredAt));
    const group = days.get(day) ?? [];
    group.push(event);
    days.set(day, group);
  }
  const columns = useMemo<readonly DataSetColumn<AuditEvent>[]>(
    () => [
      {
        key: "when",
        header: copy.when,
        width: 205,
        value: (event) => event.occurredAt,
        format: (value) => formatInstant(locale, String(value)),
      },
      {
        key: "action",
        header: copy.action,
        width: 315,
        value: (event) => eventTitle(event, t),
        render: (event) => (
          <Link
            to="/companies/$companyId"
            params={{ companyId }}
            search={{
              view: "history",
              cursor,
              ...filters,
              historyEvent: event.id,
            }}
          >
            {eventTitle(event, t)}
          </Link>
        ),
      },
      {
        key: "target",
        header: copy.target,
        width: 235,
        value: (event) => targetName(event, t),
      },
      {
        key: "actor",
        header: copy.who,
        width: 165,
        value: (event) => actorName(event, principalId, t),
      },
      {
        key: "category",
        header: copy.category,
        width: 165,
        value: (event) => copy.categories[categoryOf(event)],
      },
    ],
    [copy, locale, t, companyId, cursor, filters],
  );
  return (
    <section
      className="history-workspace"
      aria-labelledby="company-history-title"
    >
      <header className="history-header">
        <div>
          <h2 id="company-history-title">{t.historyTitle}</h2>
          <p className="hint">
            {administrator ? t.historyLead : t.historyLeadBranches}
          </p>
        </div>
        <Button
          pending={events.isFetching}
          onClick={() => void events.refetch()}
        >
          <UiIcon name="refresh" />
          {copy.refresh}
        </Button>
      </header>
      <p className="history-scope-note">
        <NavigationIcon name="profiles" />
        {administrator ? copy.companyScope : copy.branchScope}
      </p>
      {historyEvent && (
        <Link
          className="history-back"
          to="/companies/$companyId"
          params={{ companyId }}
          search={{ view: "history", cursor, ...filters }}
        >
          <UiIcon name="previous" />
          {copy.back}
        </Link>
      )}
      {events.isPending ? (
        <p>{t.loading}</p>
      ) : events.isError ? (
        <div role="alert" className="notice notice-error">
          {describe(events.error, t, "read")}
          <Button onClick={() => void events.refetch()}>{t.reload}</Button>
        </div>
      ) : historyEvent ? (
        <>
          {detail ? (
            <EventDetail {...{ principalId, locale, t }} event={detail} />
          ) : (
            <p className="empty-state">{copy.noDetail}</p>
          )}
        </>
      ) : (
        <>
          <div className="history-controls">
            <TextField
              label={copy.search}
              placeholder={copy.searchPlaceholder}
              type="search"
              maxLength={160}
              value={text}
              onChange={(event) =>
                changeSearch(
                  { ...filters, historyQuery: event.target.value || undefined },
                  true,
                )
              }
            />
            <div className="ui-field">
              <label htmlFor="history-category">{copy.category}</label>
              <select
                id="history-category"
                className="ui-field-control"
                value={category}
                onChange={(event) =>
                  changeSearch(
                    {
                      ...filters,
                      historyCategory:
                        event.target.value === "all"
                          ? undefined
                          : (event.target.value as HistoryCategory),
                    },
                    true,
                  )
                }
              >
                <option value="all">{copy.allCategories}</option>
                {historyCategories.map((key) => (
                  <option key={key} value={key}>
                    {copy.categories[key]}
                  </option>
                ))}
              </select>
            </div>
            <div className="ui-field">
              <label htmlFor="history-actor">{copy.who}</label>
              <select
                id="history-actor"
                className="ui-field-control"
                value={actor}
                onChange={(event) =>
                  changeSearch(
                    {
                      ...filters,
                      historyActor:
                        event.target.value === "all"
                          ? undefined
                          : (event.target.value as "me" | "others"),
                    },
                    true,
                  )
                }
              >
                <option value="all">{copy.allActors}</option>
                <option value="me">{t.historyYou}</option>
                <option value="others">{t.historyMember}</option>
              </select>
            </div>
            {(text || category !== "all" || actor !== "all") && (
              <Button
                onClick={() =>
                  changeSearch(
                    { ...(grid ? { historyMode: "grid" } : {}) },
                    true,
                  )
                }
              >
                {copy.clear}
              </Button>
            )}
          </div>
          <div className="history-view-bar">
            <p className="hint" role="status">
              {copy.results(rows.length, items.length)}
            </p>
            <div role="group" aria-label={copy.presentation}>
              <Button
                aria-pressed={!grid}
                onClick={() =>
                  changeSearch({ ...filters, historyMode: undefined })
                }
              >
                <NavigationIcon name="history" />
                {copy.timeline}
              </Button>
              <Button
                aria-pressed={grid}
                onClick={() =>
                  changeSearch({ ...filters, historyMode: "grid" })
                }
              >
                <UiIcon name="grid" />
                {copy.grid}
              </Button>
            </div>
          </div>
          {grid ? (
            <DataSet
              label={copy.gridLabel}
              locale={locale}
              mode="grid"
              rows={rows}
              columns={columns}
              rowId={(event) => event.id}
              selectedId={
                rows.some((event) => event.id === selectedId)
                  ? selectedId
                  : undefined
              }
              onSelect={(id) => {
                selection.current = id;
                setSelectedId(id);
              }}
              onModeChange={
                rows.length
                  ? () =>
                      changeSearch({
                        ...filters,
                        historyEvent:
                          rows.find((event) => event.id === selection.current)
                            ?.id ?? rows[0].id,
                      })
                  : undefined
              }
              empty={
                <p className="empty-state">
                  {items.length ? copy.noResults : t.historyEmpty}
                </p>
              }
            />
          ) : rows.length ? (
            <div className="history-timeline">
              {[...days].map(([day, entries]) => (
                <section className="history-day" key={day} aria-label={day}>
                  <h3>{day}</h3>
                  <ol className="history-event-list">
                    {entries.map((event) => {
                      const kind = categoryOf(event);
                      return (
                        <li key={event.id}>
                          <article className="history-event-card">
                            <span
                              className="history-event-icon"
                              aria-hidden="true"
                            >
                              <NavigationIcon name={categoryIcons[kind]} />
                            </span>
                            <div className="history-event-content">
                              <div className="history-event-meta">
                                <span className="history-category">
                                  {copy.categories[kind]}
                                </span>
                                <time dateTime={event.occurredAt}>
                                  {timeFormatter.format(
                                    new Date(event.occurredAt),
                                  )}
                                </time>
                              </div>
                              <h4>
                                <Link
                                  to="/companies/$companyId"
                                  params={{ companyId }}
                                  search={{
                                    view: "history",
                                    cursor,
                                    ...filters,
                                    historyEvent: event.id,
                                  }}
                                >
                                  {eventTitle(event, t)}
                                </Link>
                              </h4>
                              {summary(event, t).map((line) => (
                                <p key={line}>{line}</p>
                              ))}
                              <p className="hint history-actor">
                                <NavigationIcon name="members" />
                                {actorName(event, principalId, t)}
                              </p>
                            </div>
                            <UiIcon name="next" />
                          </article>
                        </li>
                      );
                    })}
                  </ol>
                </section>
              ))}
            </div>
          ) : (
            <p className="empty-state">
              {items.length ? copy.noResults : t.historyEmpty}
            </p>
          )}
          <p className="hint history-page-hint">{copy.pageHint}</p>
        </>
      )}
      <p className="hint history-time-zone">
        {copy.timeZone(
          new Intl.DateTimeFormat(locale).resolvedOptions().timeZone,
        )}
      </p>
      {!historyEvent && (cursor || events.data?.nextCursor) && (
        <nav className="pagination" aria-label={t.historyTitle}>
          {cursor && (
            <Link
              to="/companies/$companyId"
              params={{ companyId }}
              search={{ view: "history", ...filters }}
            >
              {t.firstPage}
            </Link>
          )}
          {events.data?.nextCursor && (
            <Link
              to="/companies/$companyId"
              params={{ companyId }}
              search={{
                view: "history",
                cursor: events.data.nextCursor,
                ...filters,
              }}
            >
              {t.nextPage}
            </Link>
          )}
        </nav>
      )}
    </section>
  );
}
