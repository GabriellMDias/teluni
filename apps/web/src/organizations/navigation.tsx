import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { sessionQuery } from "../identity/api.js";
import { browserLocale } from "../locale.js";
import { NavigationIcon } from "../navigation-icon.js";
import { companyKey, getCompany } from "./api.js";
import { organizationMessages } from "./messages.js";

/** Company context comes only from the matched route, never persisted state. */
export function CompanyNavigation() {
  const companyId = useRouterState({
    select: (state) => {
      const params = state.matches.at(-1)?.params;
      return params &&
        "companyId" in params &&
        typeof params.companyId === "string"
        ? params.companyId
        : undefined;
    },
  });
  return companyId ? (
    <CompanyLinks key={companyId} companyId={companyId} />
  ) : null;
}

function CompanyLinks({ companyId }: { companyId: string }) {
  // Pagination is not a distinct section. Ignore other search keys only for
  // the selected view, while still requiring the company's exact pathname.
  const view = useRouterState({
    select: (state) => state.location.search.view,
  });
  const locale = browserLocale();
  const t = organizationMessages[locale];
  const session = useQuery(sessionQuery);
  const company = useQuery({
    queryKey: companyKey(companyId),
    queryFn: () => getCompany(companyId),
    enabled: Boolean(session.data) && !session.isError,
  });
  // A failed refetch can retain cached data. Never use it to keep links visible
  // after an access denial or an unavailable session service.
  if (!session.data || session.isError || !company.isSuccess) return null;
  const { access } = company.data;
  const canView = access.capabilities.includes("branches.view");
  return (
    <div
      className="company-navigation"
      role="group"
      aria-label={company.data.company.displayName}
      lang={locale}
    >
      <div className="company-navigation-context">
        <span>{t.companyContext}</span>
        <strong>{company.data.company.displayName}</strong>
      </div>
      <Link
        to="/companies"
        className="company-navigation-switch"
        activeOptions={{ exact: true }}
      >
        {t.switchCompany}
      </Link>
      {canView && (
        <Link
          to="/companies/$companyId"
          params={{ companyId }}
          search={{}}
          activeOptions={{ exact: true, includeSearch: view !== undefined }}
        >
          <NavigationIcon name="branches" />
          {t.branchesTitle}
        </Link>
      )}
      {access.capabilities.includes("devices.view") && (
        <Link to="/companies/$companyId/screens" params={{ companyId }}>
          <NavigationIcon name="sessions" />
          {t.screensTitle}
        </Link>
      )}
      {access.capabilities.includes("media.view") && (
        <Link to="/companies/$companyId/media" params={{ companyId }}>
          <NavigationIcon name="media" />
          {t.mediaTitle}
        </Link>
      )}
      {access.capabilities.includes("programming.view") && (
        <Link to="/companies/$companyId/programming" params={{ companyId }}>
          <NavigationIcon name="programming" />
          {t.programmingTitle}
        </Link>
      )}
      {access.capabilities.includes("catalogs.view") && (
        <Link to="/companies/$companyId/catalogs" params={{ companyId }}>
          <NavigationIcon name="catalogs" />
          {t.catalogsTitle}
        </Link>
      )}
      {access.capabilities.includes("company.settings.manage") && (
        <Link
          to="/companies/$companyId"
          params={{ companyId }}
          search={{ view: "settings" }}
          activeOptions={{ exact: true, includeSearch: view !== "settings" }}
        >
          <NavigationIcon name="settings" />
          {t.settingsTitle}
        </Link>
      )}
      {access.capabilities.includes("members.manage") && (
        <Link
          to="/companies/$companyId"
          params={{ companyId }}
          search={{ view: "members" }}
          activeOptions={{ exact: true, includeSearch: view !== "members" }}
        >
          <NavigationIcon name="members" />
          {t.membersTitle}
        </Link>
      )}
      {access.capabilities.includes("members.manage") && (
        <Link
          to="/companies/$companyId"
          params={{ companyId }}
          search={{ view: "profiles" }}
          activeOptions={{ exact: true, includeSearch: view !== "profiles" }}
        >
          <NavigationIcon name="profiles" />
          {t.profilesTitle}
        </Link>
      )}
      {access.capabilities.includes("invitations.manage") && (
        <Link
          to="/companies/$companyId"
          params={{ companyId }}
          search={{ view: "invitations" }}
          activeOptions={{ exact: true, includeSearch: view !== "invitations" }}
        >
          <NavigationIcon name="invitations" />
          {t.invitationsTitle}
        </Link>
      )}
      {access.capabilities.includes("audit.view") && (
        <Link
          to="/companies/$companyId"
          params={{ companyId }}
          search={{ view: "history" }}
          activeOptions={{ exact: true, includeSearch: view !== "history" }}
        >
          <NavigationIcon name="history" />
          {t.historyTitle}
        </Link>
      )}
    </div>
  );
}
