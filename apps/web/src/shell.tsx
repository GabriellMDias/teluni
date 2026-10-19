import {
  createRootRoute,
  createRoute,
  Link,
  Outlet,
  useRouterState,
} from "@tanstack/react-router";
import brandMark from "./assets/brand-mark.svg";
import { HomePage } from "./home.js";
import { useModuleNavigation } from "./module-navigation.js";

function Shell() {
  const navigation = useModuleNavigation();
  const isDocumentation = useRouterState({
    select: (state) =>
      state.location.pathname === "/docs" ||
      state.location.pathname.startsWith("/docs/"),
  });
  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="site-header-inner">
          <Link to="/" className="brand">
            <img src={brandMark} alt="" width="32" height="32" />
            {__PROJECT_NAME__}
            {isDocumentation && <span> / Documentation</span>}
          </Link>
          {isDocumentation && (
            <span className="header-note">Living documentation</span>
          )}
          <nav aria-label="Application" className="header-nav">
            {navigation.map((Item, index) => (
              <Item key={index} />
            ))}
          </nav>
        </div>
      </header>
      <main
        className={
          isDocumentation ? "main-content documentation-main" : "main-content"
        }
      >
        <Outlet />
      </main>
    </div>
  );
}

export const rootRoute = createRootRoute({ component: Shell });

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
});
/**
 * The shell's generic home page. A product may mount its own `/` route in
 * `modules.tsx` instead; the documentation portal's routes live in
 * `documentation-routes.tsx` so a product can decide where it is served.
 */
export const coreRoutes = [homeRoute] as const;
