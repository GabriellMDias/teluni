import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Button } from "../components.js";
import {
  devicesKey,
  listDevices,
  listScreenStates,
  screenStatesKey,
} from "../devices/api.js";
import { NavigationIcon } from "../navigation-icon.js";
import {
  companyKey,
  getCompany,
  type CompanySummary,
} from "../organizations/api.js";
import { organizationMessages } from "../organizations/messages.js";
import type { Locale } from "../locale.js";
import type { WorkspaceMessages } from "./messages.js";

const previewRefreshMs = 30_000;

/** A bounded company entry; roles are labels, never permission checks. */
export function CompanyCard({
  company,
  locale,
  t,
}: {
  company: CompanySummary;
  locale: Locale;
  t: WorkspaceMessages;
}) {
  const details = useQuery({
    // A Home preview must not make a destination route skip its access fetch.
    queryKey: [...companyKey(company.id), "home"],
    queryFn: () => getCompany(company.id),
    refetchInterval: previewRefreshMs,
    enabled: company.status !== "SUSPENDED",
  });
  const suspended =
    company.status === "SUSPENDED" ||
    (details.isSuccess && details.data.company.status === "SUSPENDED");
  // A failed refetch can retain data from before an access revocation.
  const access = details.isSuccess && !suspended ? details.data.access : null;
  const initials = company.displayName
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((word) => Array.from(word)[0])
    .join("")
    .toLocaleUpperCase(locale);
  const workflows = [
    {
      capability: "devices.view",
      to: "/companies/$companyId/screens",
      icon: "sessions",
      label: t.screens,
    },
    {
      capability: "media.view",
      to: "/companies/$companyId/media",
      icon: "media",
      label: t.media,
    },
    {
      capability: "programming.view",
      to: "/companies/$companyId/programming",
      icon: "programming",
      label: t.programming,
    },
    {
      capability: "catalogs.view",
      to: "/companies/$companyId/catalogs",
      icon: "catalogs",
      label: t.catalogs,
    },
  ] as const;
  const available = workflows.filter((item) =>
    access?.capabilities.includes(item.capability),
  );
  return (
    <li className="workspace-company">
      <div className="workspace-company-heading">
        <span className="workspace-company-avatar" aria-hidden="true">
          {initials}
        </span>
        <div className="workspace-company-identity">
          <h3>
            <Link
              to="/companies/$companyId"
              params={{ companyId: company.id }}
              className="workspace-company-name"
            >
              {company.displayName}
            </Link>
          </h3>
          <p>
            {company.roles
              .map((role) => organizationMessages[locale].roles[role])
              .join(", ")}
          </p>
        </div>
        <span className="workspace-company-arrow" aria-hidden="true">
          →
        </span>
      </div>
      {suspended ? (
        <p className="workspace-company-unavailable">{t.companySuspended}</p>
      ) : details.isPending ? (
        <p className="workspace-company-status" role="status">
          {t.accessLoading}
        </p>
      ) : details.isError ? (
        <div className="workspace-company-unavailable" role="alert">
          <p>{t.accessFailed}</p>
          <Button onClick={() => void details.refetch()}>{t.reload}</Button>
        </div>
      ) : (
        <>
          {access?.capabilities.includes("devices.view") && (
            <CompanyScreens companyId={company.id} t={t} />
          )}
          {available.length > 0 ? (
            <nav
              className="workspace-company-links"
              aria-label={t.companyShortcuts(company.displayName)}
            >
              {available.map((item) => (
                <Link
                  key={item.capability}
                  to={item.to}
                  params={{ companyId: company.id }}
                >
                  <NavigationIcon name={item.icon} />
                  {item.label}
                  <span aria-hidden="true">→</span>
                </Link>
              ))}
            </nav>
          ) : (
            <p className="workspace-company-status">{t.noShortcuts}</p>
          )}
        </>
      )}
    </li>
  );
}

function CompanyScreens({
  companyId,
  t,
}: {
  companyId: string;
  t: WorkspaceMessages;
}) {
  const devices = useQuery({
    queryKey: [...devicesKey(companyId), "home"],
    queryFn: () => listDevices(companyId, { status: "ACTIVE" }),
    refetchInterval: previewRefreshMs,
  });
  const ids = devices.isSuccess
    ? devices.data.items.map((item) => item.id)
    : [];
  const states = useQuery({
    queryKey: screenStatesKey(companyId, ids),
    queryFn: () => listScreenStates(companyId, ids),
    enabled: devices.isSuccess && ids.length > 0,
    refetchInterval: previewRefreshMs,
  });
  const connected = states.isSuccess
    ? [...states.data.values()].filter((state) => state.connection === "online")
        .length
    : 0;
  return (
    <div className="workspace-screen-summary">
      {devices.isPending ? (
        <p role="status">{t.screensLoading}</p>
      ) : devices.isError ? (
        <div role="alert">
          <p>{t.screensFailed}</p>
          <Button onClick={() => void devices.refetch()}>{t.reload}</Button>
        </div>
      ) : ids.length === 0 ? (
        <p>{t.noScreens}</p>
      ) : (
        <>
          <p className="workspace-screen-count">
            <NavigationIcon name="sessions" />
            <strong>
              {t.screenCount(ids.length, Boolean(devices.data.nextCursor))}
            </strong>
            {states.isSuccess && states.data.size === ids.length && (
              <span
                className="workspace-connection"
                data-connected={connected > 0}
              >
                <span aria-hidden="true" />
                {t.connectedCount(connected)}
              </span>
            )}
          </p>
          <p className="workspace-screen-caption">
            {states.isError ||
            (states.isSuccess && states.data.size !== ids.length)
              ? t.connectionUnavailable
              : states.isPending
                ? t.connectionLoading
                : t.contactHint}
          </p>
          {devices.data.nextCursor && (
            <p className="workspace-screen-caption">{t.screensPartial}</p>
          )}
        </>
      )}
    </div>
  );
}
