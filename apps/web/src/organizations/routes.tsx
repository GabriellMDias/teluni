import { useQuery } from "@tanstack/react-query";
import { createRoute, Link, useRouterState } from "@tanstack/react-router";
import { sessionQuery } from "../identity/api.js";
import { rootRoute } from "../shell.js";
import { AcceptInvitationPage } from "./invitations.js";
import {
  CompaniesPage,
  CompanyPage,
  useOrganizationMessages,
} from "./pages.js";
import "./organizations.css";

const companiesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/companies",
  validateSearch: (search: Record<string, unknown>): { cursor?: string } => ({
    ...(typeof search.cursor === "string" &&
    search.cursor.length > 0 &&
    search.cursor.length <= 1024
      ? { cursor: search.cursor }
      : {}),
  }),
  component: function CompaniesRoute() {
    const { cursor } = companiesRoute.useSearch();
    return <CompaniesPage cursor={cursor} />;
  },
});

const companyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/companies/$companyId",
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    cursor?: string;
    view?: "settings" | "history" | "members" | "invitations";
  } => ({
    ...(typeof search.cursor === "string" &&
    search.cursor.length > 0 &&
    search.cursor.length <= 1024
      ? { cursor: search.cursor }
      : {}),
    ...(search.view === "settings" ||
    search.view === "history" ||
    search.view === "members" ||
    search.view === "invitations"
      ? { view: search.view }
      : {}),
  }),
  component: function CompanyRoute() {
    const { companyId } = companyRoute.useParams();
    const { cursor, view } = companyRoute.useSearch();
    return (
      <CompanyPage
        key={companyId}
        companyId={companyId}
        cursor={cursor}
        view={view}
      />
    );
  },
});

// The invitation credential arrives in the URL fragment, which the page moves
// into session storage; no search parameter carries it.
const acceptInvitationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/invitations/accept",
  component: function AcceptInvitationRoute() {
    const { locale, t } = useOrganizationMessages();
    return <AcceptInvitationPage locale={locale} t={t} />;
  },
});

export const organizationRoutes = [
  companiesRoute,
  companyRoute,
  acceptInvitationRoute,
] as const;

/** Header entry to the companies workspace, shown to signed-in people. */
export function OrganizationsNavigation() {
  const { locale, t } = useOrganizationMessages();
  // The portal makes no API calls while browsing, so it neither queries
  // nor shows the session.
  const isDocumentation = useRouterState({
    select: (state) =>
      state.location.pathname === "/docs" ||
      state.location.pathname.startsWith("/docs/"),
  });
  const session = useQuery({ ...sessionQuery, enabled: !isDocumentation });
  if (isDocumentation || !session.data) return null;
  return (
    <Link to="/companies" lang={locale}>
      {t.navCompanies}
    </Link>
  );
}
