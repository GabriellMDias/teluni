import { createRoute, Link } from "@tanstack/react-router";
import { rootRoute } from "../shell.js";
import {
  CompaniesPage,
  CompanyPage,
  useOrganizationMessages,
} from "./pages.js";
import "./organizations.css";

const companiesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/companies",
  component: CompaniesPage,
});

const companyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/companies/$companyId",
  validateSearch: (search: Record<string, unknown>): { cursor?: string } => ({
    ...(typeof search.cursor === "string" &&
    search.cursor.length > 0 &&
    search.cursor.length <= 1024
      ? { cursor: search.cursor }
      : {}),
  }),
  component: function CompanyRoute() {
    const { companyId } = companyRoute.useParams();
    const { cursor } = companyRoute.useSearch();
    return (
      <CompanyPage key={companyId} companyId={companyId} cursor={cursor} />
    );
  },
});

export const organizationRoutes = [companiesRoute, companyRoute] as const;

/** Header and home-page entry to the companies workspace; makes no API call. */
export function OrganizationsNavigation() {
  const { locale, t } = useOrganizationMessages();
  return (
    <Link to="/companies" lang={locale}>
      {t.navCompanies}
    </Link>
  );
}
