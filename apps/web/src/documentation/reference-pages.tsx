import { useEffect, useState } from "react";
import type { Entry, Heading } from "./types.js";
import { ApiExplorer, type ExplorerOperation } from "./api-explorer.js";
import { Example } from "./examples.js";
import { DocLink } from "./navigation.js";
const pages = import.meta.glob<string>("../generated/pages/**/*.json", {
  eager: true,
  query: "?url",
  import: "default",
});
type Field = { name: string; type: string; required: boolean };
type ApiPage = ExplorerOperation & {
  kind: "api";
  summary?: string;
  description?: string;
  request: { fields: Field[] } | null;
  responses: {
    status: string;
    description?: string;
    fields: Field[];
    schema?: Record<string, unknown>;
  }[];
};
type DatabasePage = {
  kind: "database";
  name: string;
  description: string;
  owner: string;
  classification: string;
  lifecycle: string;
  columns: Record<string, string>[];
  constraints: Record<string, string>[];
};
type ComponentPage = {
  kind: "component";
  name: string;
  summary: string;
  usage: string;
  accessibility: string;
  category?: string;
  scope?: string;
  owner?: string;
  sourceUrl?: string;
  metadataUrl?: string;
  props: {
    name: string;
    type: string;
    meaning: string;
    required?: boolean;
    default?: string;
  }[];
  states: string[];
  examples: {
    id: string;
    label: string;
    description: string;
    code?: string;
    live?: boolean;
  }[];
};
type RepositoryPage = { kind: "repository"; html: string; headings: Heading[] };
type Page = ApiPage | DatabasePage | ComponentPage | RepositoryPage;

function FieldTable({ fields }: { fields: Field[] }) {
  if (!fields.length)
    return (
      <p className="docs-muted">
        No object fields declared. See the complete schema below.
      </p>
    );
  return (
    <div
      className="docs-table-scroll"
      tabIndex={0}
      role="region"
      aria-label="Schema fields"
    >
      <table>
        <thead>
          <tr>
            <th>Field</th>
            <th>Type and constraints</th>
            <th>Required</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((field) => (
            <tr key={field.name}>
              <th scope="row">
                <code>{field.name}</code>
              </th>
              <td>
                <code>{field.type}</code>
              </td>
              <td>{field.required ? "Yes" : "No"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function RecordTable({
  rows,
  label,
}: {
  rows: Record<string, string>[];
  label: string;
}) {
  const columns = Object.keys(rows[0] ?? {});
  return (
    <div
      className="docs-table-scroll"
      tabIndex={0}
      role="region"
      aria-label={label}
    >
      <table>
        <thead>
          <tr>
            {columns.map((key) => (
              <th key={key} scope="col">
                {key}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {columns.map((key, i) =>
                i === 0 ? (
                  <th key={key} scope="row">
                    <code>{row[key]}</code>
                  </th>
                ) : (
                  <td key={key}>{row[key]}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function ApiDetail({ data }: { data: ApiPage }) {
  return (
    <>
      <div className="docs-endpoint">
        <span className={`docs-verb verb-${data.method.toLowerCase()}`}>
          {data.method}
        </span>
        <code>{data.path}</code>
      </div>
      <p>
        {data.summary ||
          data.description ||
          "Explore the executable API contract and its supported responses."}
      </p>
      <p className="docs-auth">
        <strong>Authentication:</strong> {data.authentication}
      </p>
      <section id="parameters">
        <h2>Parameters</h2>
        {data.parameters.length ? (
          <RecordTable
            label="Operation parameters"
            rows={data.parameters.map((p) => ({
              Name: p.name,
              Location: p.in,
              Type: p.type,
              Required: p.required ? "Yes" : "No",
            }))}
          />
        ) : (
          <p>This operation has no declared parameters.</p>
        )}
      </section>
      {data.request && (
        <section id="request">
          <h2>Request body</h2>
          <FieldTable fields={data.request.fields} />
          <details>
            <summary>Complete request schema</summary>
            <pre>{JSON.stringify(data.request.schema, null, 2)}</pre>
          </details>
        </section>
      )}
      <section id="responses">
        <h2>Responses</h2>
        <p className="docs-muted">
          Statuses are operation-specific. Error codes and meanings are in the{" "}
          <DocLink id="repository/docs/generated/api/errors">
            public error registry
          </DocLink>
          .
        </p>
        {data.responses.map((response) => (
          <details key={response.status} open={response.status.startsWith("2")}>
            <summary>
              <code>{response.status}</code>{" "}
              <span>{response.description || "Response"}</span>
            </summary>
            <FieldTable fields={response.fields} />
            <details>
              <summary>Complete response schema</summary>
              <pre>{JSON.stringify(response.schema, null, 2)}</pre>
            </details>
          </details>
        ))}
      </section>
      {data.components?.schemas && (
        <details>
          <summary>Referenced schemas</summary>
          <pre>{JSON.stringify(data.components.schemas, null, 2)}</pre>
        </details>
      )}
      <section id="explorer">
        <h2>Try this operation</h2>
        <ApiExplorer operation={data} />
      </section>
    </>
  );
}
function DataDetail({ data }: { data: DatabasePage }) {
  return (
    <>
      <p className="docs-lead">{data.description}</p>
      <dl className="docs-facts">
        <div>
          <dt>Owner</dt>
          <dd>{data.owner}</dd>
        </div>
        <div>
          <dt>Classification</dt>
          <dd>{data.classification}</dd>
        </div>
        <div>
          <dt>Lifecycle</dt>
          <dd>{data.lifecycle}</dd>
        </div>
      </dl>
      <section id="columns">
        <h2>Columns</h2>
        <RecordTable rows={data.columns} label="Database columns" />
      </section>
      <section id="constraints">
        <h2>Constraints and indexes</h2>
        <RecordTable rows={data.constraints} label="Database constraints" />
      </section>
      <p>
        <DocLink id="repository/docs/generated/database/schema">
          Complete database reference and enums
        </DocLink>
      </p>
    </>
  );
}
function ComponentDetail({ data }: { data: ComponentPage }) {
  return (
    <>
      <p className="docs-lead">{data.summary}</p>
      <dl className="docs-facts">
        <div>
          <dt>Category</dt>
          <dd>{data.category ?? "Uncategorized"}</dd>
        </div>
        <div>
          <dt>Reuse scope</dt>
          <dd>{data.scope ?? "shared"}</dd>
        </div>
        {data.owner && (
          <div>
            <dt>Owner</dt>
            <dd>{data.owner}</dd>
          </div>
        )}
      </dl>
      <p className="docs-resource-links">
        {data.sourceUrl && <a href={data.sourceUrl}>Component source</a>}
        {data.metadataUrl && <a href={data.metadataUrl}>Owned metadata</a>}
      </p>
      <section id="props">
        <h2>Props</h2>
        {data.props.length ? (
          <RecordTable
            rows={data.props.map((prop) => ({
              Prop: prop.name,
              Type: prop.type,
              Meaning: prop.meaning,
              Required:
                prop.required === undefined
                  ? "See type"
                  : prop.required
                    ? "Yes"
                    : "No",
              Default: prop.default ?? "—",
            }))}
            label="Component properties"
          />
        ) : (
          <p>No component-specific props are declared.</p>
        )}
      </section>
      <section id="usage">
        <h2>Usage and accessibility</h2>
        <p>{data.usage}</p>
        <p>{data.accessibility}</p>
        <h3>States</h3>
        <ul>
          {data.states.map((state) => (
            <li key={state}>{state}</li>
          ))}
        </ul>
      </section>
      <section id="examples">
        <h2>Examples</h2>
        <p className="docs-muted">
          Live previews use the actual components and keep input local.
          Code-only examples are not executed.
        </p>
        {data.examples.map((example) => (
          <section key={example.id}>
            <h3>{example.label}</h3>
            <p>{example.description}</p>
            {example.code && (
              <pre>
                <code>{example.code}</code>
              </pre>
            )}
            {(example.live ?? !example.code) && <Example id={example.id} />}
          </section>
        ))}
      </section>
    </>
  );
}
export function Detail({
  entry,
  onHeadings,
}: {
  entry: Entry;
  onHeadings: (id: string, headings: Heading[]) => void;
}) {
  const [result, setResult] = useState<{
    id: string;
    data?: Page;
    error?: string;
  }>({ id: entry.id });
  useEffect(() => {
    const controller = new AbortController();
    const url = pages[`../generated/${entry.file}`];
    void (async () => {
      if (!url) throw new Error("Missing page");
      const response = await fetch(url, {
        signal: controller.signal,
        credentials: "omit",
      });
      if (!response.ok) throw new Error("Page unavailable");
      const data = (await response.json()) as Page;
      if (!controller.signal.aborted) {
        setResult({ id: entry.id, data });
        onHeadings(
          entry.id,
          data.kind === "repository" ? data.headings : entry.headings,
        );
      }
    })().catch(() => {
      if (!controller.signal.aborted)
        setResult({
          id: entry.id,
          error:
            "This page could not be loaded. Reload to retry, or browse another section.",
        });
    });
    return () => controller.abort();
  }, [entry, onHeadings]);
  if (result.id !== entry.id || !result.data)
    return (
      <p role={result.error ? "alert" : "status"}>
        {result.error ?? "Loading documentation…"}
      </p>
    );
  const data = result.data;
  if (data.kind === "api") return <ApiDetail data={data} />;
  if (data.kind === "database") return <DataDetail data={data} />;
  if (data.kind === "component") return <ComponentDetail data={data} />;
  return (
    <div
      className="docs-markdown"
      dangerouslySetInnerHTML={{ __html: data.html }}
    />
  );
}
