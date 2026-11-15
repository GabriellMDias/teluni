import {
  createRootRoute,
  createRoute,
  Link,
  Outlet,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import brandMark from "./assets/brand-mark.svg";
import { HomePage } from "./home.js";
import { browserLocale } from "./locale.js";
import { useModuleNavigation } from "./module-navigation.js";
import { shellMessages } from "./shell-messages.js";
import { useSidebarCollapsed } from "./sidebar.js";
import { useColorTheme } from "./theme.js";
import "./shell.css";

function Shell() {
  const isDocumentation = useRouterState({
    select: (state) =>
      __ORION_INTERNAL_DOCS__ &&
      (state.location.pathname === "/docs" ||
        state.location.pathname.startsWith("/docs/")),
  });
  return isDocumentation ? <Outlet /> : <ProductShell />;
}

function ProductShell() {
  const navigation = useModuleNavigation();
  const locale = browserLocale();
  const t = shellMessages[locale];
  const { theme, selectTheme } = useColorTheme();
  const { collapsed, toggleCollapsed } = useSidebarCollapsed();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const location = useRouterState({ select: (state) => state.location.href });
  useEffect(() => setMenuOpen(false), [location]);

  return (
    <div
      className="app-shell product-shell"
      data-theme={theme}
      data-sidebar={collapsed ? "collapsed" : "expanded"}
      lang={locale}
      onKeyDown={(event) => {
        if (event.key === "Escape" && menuOpen) {
          setMenuOpen(false);
          menuButton.current?.focus();
        }
      }}
    >
      <a className="product-skip" href="#product-content">
        {t.skip}
      </a>
      <header className="product-topbar">
        <button
          ref={menuButton}
          type="button"
          className="product-menu"
          aria-controls="product-navigation"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
          {t.menu}
        </button>
      </header>
      <aside className="product-sidebar" data-open={menuOpen}>
        <Link to="/" className="product-brand">
          <img src={brandMark} alt="" width="36" height="36" />
          <span className="product-brand-name">{__PROJECT_NAME__}</span>
        </Link>
        <nav
          id="product-navigation"
          aria-label={t.navigation}
          className="product-navigation"
          onClick={(event) => {
            if (event.target instanceof Element && event.target.closest("a")) {
              setMenuOpen(false);
              if (menuOpen) document.getElementById("product-content")?.focus();
            }
          }}
        >
          {navigation.map((Item, index) => (
            <Item key={index} />
          ))}
        </nav>
        <p className="product-tagline">{t.tagline}</p>
        <div className="product-sidebar-footer">
          <button
            type="button"
            role="switch"
            className="product-theme-switch"
            aria-checked={theme === "dark"}
            aria-label={t.darkTheme}
            title={t.darkTheme}
            onClick={() => selectTheme(theme === "dark" ? "light" : "dark")}
          >
            <span className="product-theme-knob" aria-hidden="true" />
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
            </svg>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
            </svg>
          </button>
          <button
            type="button"
            className="product-collapse"
            aria-label={collapsed ? t.expandSidebar : t.collapseSidebar}
            title={collapsed ? t.expandSidebar : t.collapseSidebar}
            onClick={toggleCollapsed}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 4h18v16H3zM9 4v16M16 9l-3 3 3 3" />
            </svg>
          </button>
        </div>
      </aside>
      <div className="product-workspace">
        <main id="product-content" tabIndex={-1} className="main-content">
          <Outlet />
        </main>
      </div>
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
