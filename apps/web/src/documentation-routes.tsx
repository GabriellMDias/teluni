import { createRoute, lazyRouteComponent, Link } from "@tanstack/react-router";
import { rootRoute } from "./shell.js";

// The Living Documentation portal's routes and header entry. Composition in
// modules.tsx decides where the portal is mounted.
const documentationSearch = (
  search: Record<string, unknown>,
): { q?: string; scope?: string; group?: string; page?: number } => ({
  ...(typeof search.q === "string" ? { q: search.q.slice(0, 200) } : {}),
  ...(typeof search.scope === "string" ? { scope: search.scope } : {}),
  ...(typeof search.group === "string" ? { group: search.group } : {}),
  ...(Number.isSafeInteger(Number(search.page)) && Number(search.page) > 1
    ? { page: Math.min(Number(search.page), 100000) }
    : {}),
});
const documentationComponent = lazyRouteComponent(
  () => import("./documentation.js"),
  "DocumentationPage",
);
const documentationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/docs",
  component: documentationComponent,
  validateSearch: documentationSearch,
});
const documentationDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/docs/$",
  component: documentationComponent,
  validateSearch: documentationSearch,
});

export const documentationRoutes = [
  documentationRoute,
  documentationDetailRoute,
] as const;

/** Header entry to the portal. */
export function DocumentationNavigation() {
  return <Link to="/docs">Documentation</Link>;
}
