import {
  useEffect,
  useCallback,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import {
  Link,
  useNavigate,
  useRouterState,
  useSearch,
} from "@tanstack/react-router";
import type { Heading } from "./documentation/types.js";
import {
  byId,
  manifest,
  sections,
  labels,
  folderLabel,
} from "./documentation/catalog-data.js";
import { DocLink } from "./documentation/navigation.js";
import { Detail } from "./documentation/reference-pages.js";
import { Catalog, Overview } from "./documentation/catalog.js";
import { SearchPage } from "./documentation/search-page.js";
import "./documentation.css";
import brandMark from "./assets/brand-mark.svg";
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function DocumentationPage() {
  const location = useRouterState({ select: (state) => state.location });
  const navigate = useNavigate();
  const id = safeDecode(location.pathname.replace(/^\/docs\/?/, "")).replace(
    /\/$/,
    "",
  );
  const search = useSearch({ strict: false });
  const entry = byId.get(id);
  const section = sections.find((item) => item.id === id);
  // Top-level sections render even before they have entries, such as a data
  // dictionary in a project without tables yet.
  const isCatalog =
    !entry &&
    (section !== undefined ||
      manifest.entries.some((item) => item.id.startsWith(`${id}/`)));
  const title = !id
    ? `${__PROJECT_NAME__} documentation`
    : id === "search"
      ? "Search documentation"
      : (entry?.title ??
        section?.title ??
        (isCatalog ? folderLabel(id.split("/").at(-1)!) : "Page not found"));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loadedOutline, setLoadedOutline] = useState<{
    id: string;
    headings: Heading[];
  }>({ id: "", headings: [] });
  const onHeadings = useCallback(
    (pageId: string, headings: Heading[]) =>
      setLoadedOutline({ id: pageId, headings }),
    [],
  );
  const detailHeadings =
    loadedOutline.id === id ? loadedOutline.headings : (entry?.headings ?? []);
  const titleId =
    detailHeadings.find((item) => item.level === 1)?.id ?? "docs-page-title";
  const heading = useRef<HTMLHeadingElement>(null);
  const content = useRef<HTMLElement>(null);
  const crumbs = id
    .split("/")
    .filter(Boolean)
    .map((part, index, parts) => ({
      id: parts.slice(0, index + 1).join("/"),
      label:
        index === parts.length - 1
          ? title
          : (sections.find((s) => s.id === part)?.title ?? folderLabel(part)),
    }));
  useEffect(() => {
    document.title = `${title} · ${__PROJECT_NAME__}`;
    heading.current?.focus({ preventScroll: true });
    if (!location.hash) window.scrollTo(0, 0);
  }, [id, title, search.q, search.page, location.hash]);
  useEffect(() => {
    if (!location.hash) return;
    const focusAnchor = () => {
      const target = document.getElementById(safeDecode(location.hash));
      if (!target) return false;
      target.scrollIntoView();
      target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
      return true;
    };
    if (focusAnchor()) return;
    const observer = new MutationObserver(() => {
      if (focusAnchor()) observer.disconnect();
    });
    if (content.current)
      observer.observe(content.current, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [id, location.hash, titleId]);
  function internalLinks(event: MouseEvent<HTMLElement>) {
    if (
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey ||
      event.defaultPrevented
    )
      return;
    const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>(
      ".docs-markdown a",
    );
    if (!anchor || anchor.target || anchor.hasAttribute("download")) return;
    const url = new URL(anchor.href);
    if (
      url.origin === window.location.origin &&
      url.pathname.startsWith("/docs/")
    ) {
      event.preventDefault();
      void navigate({
        to: "/docs/$",
        params: { _splat: safeDecode(url.pathname.slice(6)) },
        hash: safeDecode(url.hash.slice(1)),
        search: {},
      });
    }
  }
  const defaultHeadings: Record<string, Heading[]> = {
    api: ["Parameters", "Request", "Responses", "Explorer"]
      .filter((text) => text !== "Request" || entry)
      .map((text) => ({
        id: text.toLowerCase(),
        text: text === "Explorer" ? "Try this operation" : text,
        level: 2,
      })),
    database: [
      { id: "columns", text: "Columns", level: 2 },
      { id: "constraints", text: "Constraints and indexes", level: 2 },
    ],
    component: [
      { id: "props", text: "Props", level: 2 },
      { id: "usage", text: "Usage and accessibility", level: 2 },
      { id: "examples", text: "Examples", level: 2 },
    ],
  };
  const outline =
    entry?.kind === "repository"
      ? detailHeadings.filter((h) => h.level === 2 || h.level === 3)
      : entry
        ? entry.headings.length
          ? entry.headings
          : (defaultHeadings[entry.kind] ?? [])
        : [];
  return (
    <main className="docs-workspace">
      <a className="docs-skip" href={`#${titleId}`}>
        Skip to documentation
      </a>
      <aside className={`docs-rail ${mobileOpen ? "is-open" : ""}`}>
        <div className="docs-rail-brand">
          <img
            className="docs-brand-symbol"
            src={brandMark}
            alt=""
            width="28"
            height="28"
          />{" "}
          {__PROJECT_NAME__} <small>Documentation</small>
          <span
            className="docs-foundation-version"
            title={__ORION_FOUNDATION_VERSION__.commit ?? undefined}
          >
            <span className="sr-only">Orion foundation: </span>
            {__ORION_FOUNDATION_VERSION__.label}
          </span>
        </div>
        <button
          className="docs-menu-toggle"
          aria-expanded={mobileOpen}
          aria-controls="docs-navigation"
          onClick={() => setMobileOpen(!mobileOpen)}
        >
          Browse documentation <span aria-hidden="true">⌄</span>
        </button>
        <div id="docs-navigation" className="docs-rail-body">
          <nav
            aria-label="Documentation sections"
            onClick={() => setMobileOpen(false)}
          >
            <DocLink current={!id}>Overview</DocLink>
            <p className="docs-nav-label">Reference</p>
            {sections.slice(0, 3).map((s) => (
              <DocLink
                id={s.id}
                key={s.id}
                current={id === s.id || id.startsWith(`${s.id}/`)}
              >
                {s.title}
              </DocLink>
            ))}
            <p className="docs-nav-label">Project knowledge</p>
            <DocLink id="repository" current={id === "repository"}>
              Repository docs
            </DocLink>
            {[
              "architecture",
              "api",
              "database",
              "domains",
              "security",
              "reliability",
              "adr",
              "runbooks",
            ].map((category) => (
              <DocLink
                key={category}
                id={`repository/docs/${category}`}
                current={id.startsWith(`repository/docs/${category}`)}
              >
                {category === "adr"
                  ? "Decisions (ADRs)"
                  : category === "api"
                    ? "API policies"
                    : category === "database"
                      ? "Database policies"
                      : category.charAt(0).toUpperCase() + category.slice(1)}
              </DocLink>
            ))}
          </nav>
          <div className="docs-rail-footer">
            <DocLink id="repository/docs/contributing">
              Contributing guide
            </DocLink>
            <p>Built from repository sources.</p>
          </div>
        </div>
      </aside>
      <div className="docs-body">
        <div className="docs-topbar">
          <form
            role="search"
            key={`${search.q ?? ""}-${search.scope ?? ""}`}
            onSubmit={(event) => {
              event.preventDefault();
              const values = new FormData(event.currentTarget);
              void navigate({
                to: "/docs/$",
                params: { _splat: "search" },
                search: {
                  q:
                    typeof values.get("q") === "string"
                      ? (values.get("q") as string)
                      : "",
                  scope:
                    typeof values.get("scope") === "string"
                      ? (values.get("scope") as string)
                      : "",
                },
              });
            }}
          >
            <label className="sr-only" htmlFor="docs-search">
              Search documentation
            </label>
            <input
              id="docs-search"
              name="q"
              type="search"
              placeholder="Search documentation…"
              defaultValue={search.q ?? ""}
              maxLength={200}
            />
            <label className="sr-only" htmlFor="docs-search-scope">
              Search category
            </label>
            <select
              id="docs-search-scope"
              name="scope"
              defaultValue={search.scope ?? ""}
            >
              <option value="">All documentation</option>
              {Object.entries(labels).map(([kind, label]) => (
                <option key={kind} value={kind}>
                  {label}
                </option>
              ))}
            </select>
            <button type="submit">Search</button>
          </form>
          <Link to="/" className="docs-app-link">
            Application ↗
          </Link>
        </div>
        <div className="docs-page-grid">
          <article
            className="docs-article"
            ref={content}
            onClick={internalLinks}
          >
            <nav aria-label="Breadcrumbs" className="docs-breadcrumbs">
              <DocLink>Documentation</DocLink>
              {crumbs.map((crumb, i) => (
                <span key={crumb.id}>
                  <span aria-hidden="true"> / </span>
                  {i === crumbs.length - 1 ? (
                    <span aria-current="page">{crumb.label}</span>
                  ) : (
                    <DocLink id={crumb.id}>{crumb.label}</DocLink>
                  )}
                </span>
              ))}
            </nav>
            <header className="docs-page-header">
              <p className="docs-kicker">
                {entry
                  ? labels[entry.kind]
                  : !id
                    ? "The engineering knowledge base"
                    : `Explore ${__PROJECT_NAME__}`}
              </p>
              <h1 ref={heading} id={titleId} tabIndex={-1}>
                {title}
              </h1>
              {entry && (
                <p className="docs-source">
                  Source: <code>{entry.source}</code>
                </p>
              )}
            </header>
            {outline.length > 0 && (
              <details className="docs-inline-outline">
                <summary>On this page</summary>
                <nav aria-label="On this page">
                  {outline.map((h) => (
                    <a key={h.id} href={`#${h.id}`}>
                      {h.text}
                    </a>
                  ))}
                </nav>
              </details>
            )}
            {!id ? (
              <Overview />
            ) : id === "search" ? (
              <SearchPage
                key={`${search.q}-${search.scope}`}
                query={search.q ?? ""}
                scope={search.scope ?? ""}
              />
            ) : entry ? (
              <Detail key={entry.id} entry={entry} onHeadings={onHeadings} />
            ) : isCatalog ? (
              <Catalog
                key={id}
                id={id}
                page={search.page ?? 1}
                group={search.group ?? ""}
              />
            ) : (
              <p>
                This documentation page does not exist.{" "}
                <DocLink>Return to the overview</DocLink> or use search.
              </p>
            )}
            <footer className="docs-page-footer">
              {__PROJECT_NAME__} · Living documentation{" "}
              <span>Canonical sources. Connected context.</span>
            </footer>
          </article>
          {outline.length > 0 && (
            <aside className="docs-outline">
              <p className="docs-nav-label">On this page</p>
              <nav aria-label="On this page">
                {outline.map((h) => (
                  <a
                    key={h.id}
                    href={`#${h.id}`}
                    className={h.level === 3 ? "subheading" : ""}
                  >
                    {h.text}
                  </a>
                ))}
              </nav>
            </aside>
          )}
        </div>
      </div>
    </main>
  );
}
