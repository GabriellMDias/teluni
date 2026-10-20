import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "../shell.js";
import {
  CatalogPage,
  CatalogsPage,
  RecordPage,
  type CatalogFilter,
  type CatalogsFilter,
} from "./pages.js";
import "./catalogs.css";

const cursor = (search: Record<string, unknown>) =>
  typeof search.cursor === "string" &&
  search.cursor.length > 0 &&
  search.cursor.length <= 1024
    ? { cursor: search.cursor }
    : {};
const text = (search: Record<string, unknown>) =>
  typeof search.text === "string" &&
  search.text.trim().length > 0 &&
  search.text.length <= 120
    ? { text: search.text.trim() }
    : {};

const listRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/companies/$companyId/catalogs",
  validateSearch: (search: Record<string, unknown>): CatalogsFilter => ({
    ...cursor(search),
    ...text(search),
    ...(search.status === "ARCHIVED" ? { status: search.status } : {}),
  }),
  component: function CatalogsRoute() {
    const { companyId } = listRoute.useParams();
    const filter = listRoute.useSearch();
    return (
      <CatalogsPage key={companyId} companyId={companyId} filter={filter} />
    );
  },
});

const catalogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/companies/$companyId/catalogs/$catalogId",
  validateSearch: (search: Record<string, unknown>): CatalogFilter => ({
    ...(search.view === "fields" ? { view: search.view } : {}),
    ...cursor(search),
    ...text(search),
  }),
  component: function CatalogRoute() {
    const { companyId, catalogId } = catalogRoute.useParams();
    const filter = catalogRoute.useSearch();
    return (
      <CatalogPage
        key={`${companyId}/${catalogId}`}
        companyId={companyId}
        catalogId={catalogId}
        filter={filter}
      />
    );
  },
});

const recordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/companies/$companyId/catalogs/$catalogId/items/$recordId",
  component: function RecordRoute() {
    const { companyId, catalogId, recordId } = recordRoute.useParams();
    return (
      <RecordPage
        key={`${companyId}/${catalogId}/${recordId}`}
        companyId={companyId}
        catalogId={catalogId}
        recordId={recordId}
      />
    );
  },
});

export const catalogRoutes = [listRoute, catalogRoute, recordRoute] as const;
