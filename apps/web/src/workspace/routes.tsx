import { useQuery } from "@tanstack/react-query";
import { createRoute, Link, useRouterState } from "@tanstack/react-router";
import { sessionQuery } from "../identity/api.js";
import { rootRoute } from "../shell.js";
import { EntryPage, useWorkspaceMessages } from "./pages.js";
import "./workspace.css";

const entryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: EntryPage,
});

export const workspaceRoutes = [entryRoute] as const;

/** Header entry to the home page, shown to signed-in people. */
export function WorkspaceNavigation() {
  const { locale, t } = useWorkspaceMessages();
  const isDocumentation = useRouterState({
    select: (state) =>
      state.location.pathname === "/docs" ||
      state.location.pathname.startsWith("/docs/"),
  });
  const session = useQuery({ ...sessionQuery, enabled: !isDocumentation });
  if (isDocumentation || !session.data) return null;
  return (
    <Link to="/" lang={locale} activeOptions={{ exact: true }}>
      {t.navHome}
    </Link>
  );
}
