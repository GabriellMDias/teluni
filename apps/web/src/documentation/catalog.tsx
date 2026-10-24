import { useNavigate } from "@tanstack/react-router";
import { DocLink } from "./navigation.js";
import { manifest, sections, folderLabel } from "./catalog-data.js";
import { catalogPage } from "./catalog-model.js";
import openapiUrl from "../../../../docs/generated/api/openapi.json?url";
import errorsUrl from "../../../../docs/generated/api/errors.md?url";
import databaseUrl from "../../../../docs/generated/database/schema.md?url";
import componentsUrl from "../../../../docs/generated/components/web.md?url";
export function Catalog({
  id,
  page,
  group,
}: {
  id: string;
  page: number;
  group: string;
}) {
  const navigate = useNavigate();
  const { entryCount, folders, entries, groups, current, pageCount } =
    catalogPage(manifest.entries, id, page, group);
  return (
    <>
      <p className="docs-lead">
        {entryCount === 0
          ? "No entries exist in this section yet."
          : `${entryCount} entries in this section. Choose a collection or open a reference.`}
      </p>
      {id === "components" && (
        <nav
          aria-label="Component categories"
          className="docs-component-categories"
        >
          <DocLink id="components" current={!group}>
            All components
          </DocLink>
          {(manifest.componentCategories ?? groups).map((category) => (
            <DocLink
              key={category}
              id="components"
              group={category}
              current={group === category}
            >
              {category}
            </DocLink>
          ))}
        </nav>
      )}
      {folders.length > 0 && (
        <div className="docs-collections">
          {folders.map(({ name, count }) => (
            <DocLink
              key={name}
              id={`${id}/${name}`}
              className="docs-collection"
            >
              <span aria-hidden="true">▤</span>
              <span>
                {folderLabel(name)}
                <small>{count} entries</small>
              </span>
              <span aria-hidden="true">→</span>
            </DocLink>
          ))}
        </div>
      )}
      {id === "api" && groups.length > 0 && (
        <label className="docs-catalog-filter">
          API group{" "}
          <select
            value={group}
            onChange={(event) => {
              void navigate({
                to: "/docs/$",
                params: { _splat: id },
                search: { group: event.target.value },
              });
            }}
          >
            <option value="">All groups</option>
            {groups.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="docs-entry-list">
        {id === "components" && group && entries.length === 0 && (
          <p>No components match this category.</p>
        )}
        {entries.map((entry) => (
          <DocLink key={entry.id} id={entry.id} className="docs-entry">
            <div>
              {entry.method && (
                <span
                  className={`docs-verb verb-${entry.method.toLowerCase()}`}
                >
                  {entry.method}
                </span>
              )}
              <strong>{entry.title}</strong>
              {entry.path && <code>{entry.path}</code>}
            </div>
            <p>{entry.summary}</p>
            {entry.kind === "component" && (
              <p className="docs-muted">
                {entry.category ?? "Uncategorized"} · {entry.scope ?? "shared"}{" "}
                · {entry.owner ?? entry.source}
              </p>
            )}
            <span aria-hidden="true">→</span>
          </DocLink>
        ))}
      </div>
      {pageCount > 1 && (
        <nav className="docs-pagination" aria-label="Catalog pages">
          <button
            disabled={current === 1}
            onClick={() => {
              void navigate({
                to: "/docs/$",
                params: { _splat: id },
                search: { page: current - 1, group },
              });
            }}
          >
            Previous
          </button>
          <span>
            Page {current} of {pageCount}
          </span>
          <button
            disabled={current === pageCount}
            onClick={() => {
              void navigate({
                to: "/docs/$",
                params: { _splat: id },
                search: { page: current + 1, group },
              });
            }}
          >
            Next
          </button>
        </nav>
      )}
      {id === "api" && (
        <section id="artifacts">
          <h2>Contract and error references</h2>
          <div className="docs-resource-links">
            <a href={openapiUrl}>OpenAPI 3.1 JSON</a>
            <DocLink id="repository/docs/generated/api/errors">
              Public error registry
            </DocLink>
            <a href={errorsUrl}>AI-readable error registry</a>
          </div>
        </section>
      )}
      {id === "database" && (
        <p>
          <a href={databaseUrl}>AI-readable database reference</a>
        </p>
      )}
      {id === "components" && (
        <p>
          <a href={componentsUrl}>AI-readable component reference</a>
        </p>
      )}
    </>
  );
}
export function Overview() {
  return (
    <>
      <p className="docs-lead">
        A map of the system, from the first request to the decisions behind it.
      </p>
      <div className="docs-hub">
        {sections.map((section) => (
          <DocLink id={section.id} key={section.id} className="docs-hub-card">
            <span className="docs-hub-symbol" aria-hidden="true">
              {section.symbol}
            </span>
            <h2>{section.title}</h2>
            <p>{section.summary}</p>
            <span className="docs-card-footer">
              {
                manifest.entries.filter((entry) => entry.kind === section.kind)
                  .length
              }{" "}
              entries <span aria-hidden="true">→</span>
            </span>
          </DocLink>
        ))}
      </div>
      <section className="docs-start">
        <div>
          <p className="docs-kicker">Start with context</p>
          <h2>New to {__PROJECT_NAME__}?</h2>
          <p>
            Set up the project, understand the boundaries, and find the source
            that owns a behavior.
          </p>
        </div>
        <div className="docs-start-links">
          <DocLink id="repository/docs/setup">
            Set up your workspace <span aria-hidden="true">→</span>
          </DocLink>
          <DocLink id="repository/docs/project-derivation">
            Start or upgrade from Orion <span aria-hidden="true">→</span>
          </DocLink>
          <DocLink id="repository/docs/architecture/repository-structure">
            Explore the repository <span aria-hidden="true">→</span>
          </DocLink>
          <DocLink id="repository/docs/architecture/principles">
            Understand the architecture <span aria-hidden="true">→</span>
          </DocLink>
          <DocLink id="repository/docs/contributing">
            Make a change <span aria-hidden="true">→</span>
          </DocLink>
        </div>
      </section>
    </>
  );
}
