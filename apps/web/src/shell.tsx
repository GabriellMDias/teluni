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
import { useColorTheme, type ThemePreference } from "./theme.js";
import "./shell.css";

function Shell() {
  const isDocumentation = useRouterState({
    select: (state) =>
      state.location.pathname === "/docs" ||
      state.location.pathname.startsWith("/docs/"),
  });
  return isDocumentation ? <DocumentationShell /> : <ProductShell />;
}

function ProductShell() {
  const navigation = useModuleNavigation();
  const locale = browserLocale();
  const t = shellMessages[locale];
  const { preference, theme, selectTheme } = useColorTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const location = useRouterState({ select: (state) => state.location.href });
  useEffect(() => setMenuOpen(false), [location]);

  return (
    <div
      className="app-shell product-shell"
      data-theme={theme}
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
        <p className="product-workspace-label">{t.workspace}</p>
        <label className="product-theme">
          <span>{t.theme}</span>
          <select
            value={preference}
            onChange={(event) =>
              selectTheme(event.target.value as ThemePreference)
            }
          >
            <option value="system">{t.system}</option>
            <option value="light">{t.light}</option>
            <option value="dark">{t.dark}</option>
          </select>
        </label>
      </header>
      <aside className="product-sidebar" data-open={menuOpen}>
        <Link to="/" className="product-brand">
          <img src={brandMark} alt="" width="36" height="36" />
          {__PROJECT_NAME__}
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
      </aside>
      <div className="product-workspace">
        <main id="product-content" tabIndex={-1} className="main-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

// The development portal retains its existing light presentation and never
// reads the product's session or appearance preference.
function DocumentationShell() {
  const navigation = useModuleNavigation();
  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="site-header-inner">
          <Link to="/" className="brand">
            <img src={brandMark} alt="" width="32" height="32" />
            {__PROJECT_NAME__}
            <span> / Documentation</span>
          </Link>
          <span className="header-note">Living documentation</span>
          <nav aria-label="Application" className="header-nav">
            {navigation.map((Item, index) => (
              <Item key={index} />
            ))}
          </nav>
        </div>
      </header>
      <main className="main-content documentation-main">
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
