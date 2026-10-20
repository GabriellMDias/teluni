import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ApiFailure, type ApiIssue } from "../api-client.js";
import {
  catalogKey,
  getCatalog,
  listCatalogChoices,
  type Catalog,
} from "../catalogs/api.js";
import { describe, type CompanyWithAccess } from "../organizations/api.js";
import {
  createLayout,
  deleteLayout,
  exportLayout,
  importLayout,
  layoutKey,
  layoutsKey,
  getLayout,
  listLayouts,
  listSelectableMedia,
  updateLayout,
  type AreaInput,
  type ImportedDocument,
  type Layout,
  type LayoutDefinition,
  type LayoutDocument,
  type LayoutSummary,
  type PageInput,
  type ViewInput,
} from "./api.js";
import {
  BackLink,
  can,
  CompanyGate,
  ConfirmedDelete,
  mustReload,
  scopeName,
  useProgrammingMessages,
  type Messages,
} from "./common.js";

// Layouts (D-11 increment 2): the list, creation and import, and the editor
// of areas, catalog views and pages. The API validates every save and
// reports issues by JSON Pointer; the editor names the area or page.

type Orientation = Layout["orientation"];
type Kind = AreaInput["kind"];
type Role = ViewInput["fields"][number]["role"];
type Presentation = ViewInput["presentation"];
type Branch = { id: string; name: string };

/** The canvas of each orientation, as the API defines it. */
const canvasSizes: Readonly<
  Record<Orientation, { width: number; height: number }>
> = {
  landscape: { width: 1920, height: 1080 },
  portrait: { width: 1080, height: 1920 },
};
const grid = 10;
const minSize = 40;
const maxImportBytes = 512 * 1024;

export type LayoutsFilter = Readonly<{ cursor?: string; text?: string }>;

/** Issue text, prefixed with the area or page its path names. */
function issueText(
  issue: ApiIssue,
  t: Messages,
  areas: readonly { name: string }[],
  outputs: readonly { key: string; name: string }[],
): string {
  const l = t.layouts;
  // Programs lose the outputs of removed areas: the key names a saved area.
  const output = /^\/outputs\/([^/]+)/.exec(issue.path);
  if (output) {
    const name =
      outputs.find((entry) => entry.key === output[1])?.name ?? output[1];
    const count = issue.count ?? 0;
    return `${l.selectedTitle(name)}: ${
      issue.reason === "DEFAULT_REMOVED"
        ? l.programsLoseDefault(count)
        : l.programsLoseOutput(count)
    }`;
  }
  const text = l.issues[issue.reason] ?? t.generic;
  const area = /^(?:\/document)?\/areas\/(\d+)/.exec(issue.path);
  if (area) {
    const name = areas[Number(area[1])]?.name;
    return name ? `${l.selectedTitle(name)}: ${text}` : text;
  }
  const page = /^(?:\/document)?\/pages\/(\d+)/.exec(issue.path);
  if (page) return `${l.pageTitle(Number(page[1]) + 1)}: ${text}`;
  if (issue.path.endsWith("/audioMixConfirmed"))
    return `${l.audioLabel}: ${text}`;
  return text;
}

function LayoutFailure({
  error,
  operation,
  areas = [],
  outputs = [],
  onReload,
}: {
  error: unknown;
  operation: "read" | "write";
  areas?: readonly { name: string }[];
  /** The saved areas, which issues about program outputs name by key. */
  outputs?: readonly { key: string; name: string }[];
  onReload?: () => void;
}) {
  const { t } = useProgrammingMessages();
  const issues = error instanceof ApiFailure ? error.issues : [];
  return (
    <div role="alert" className="notice notice-error">
      {describe(error, t, operation)}
      {issues.length > 0 && (
        <ul className="layout-issues">
          {issues.map((issue, index) => (
            <li key={`${issue.path}-${issue.reason}-${index}`}>
              {issueText(issue, t, areas, outputs)}
            </li>
          ))}
        </ul>
      )}
      {onReload && (
        <button type="button" onClick={onReload}>
          {t.reload}
        </button>
      )}
    </div>
  );
}

// Overview: list, creation and import

function ScopeSelect({
  id,
  value,
  branches,
  onChange,
}: {
  id: string;
  value: string;
  branches: Branch[];
  onChange: (value: string) => void;
}) {
  const { t } = useProgrammingMessages();
  return (
    <>
      <label htmlFor={id}>{t.fieldScope}</label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="company">{t.companyScope}</option>
        {branches.map((branch) => (
          <option key={branch.id} value={branch.id}>
            {branch.name}
          </option>
        ))}
      </select>
    </>
  );
}

function CreateLayoutForm({
  companyId,
  branches,
}: {
  companyId: string;
  branches: Branch[];
}) {
  const { t } = useProgrammingMessages();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [scope, setScope] = useState("company");
  const [orientation, setOrientation] = useState<Orientation>("landscape");
  const create = useMutation({
    mutationFn: () =>
      createLayout(companyId, {
        name,
        branchId: scope === "company" ? null : scope,
        // A new layout starts with one media area over the whole canvas.
        definition: {
          orientation,
          areas: [
            {
              key: "main",
              name: t.layouts.firstAreaName,
              x: 0,
              y: 0,
              ...canvasSizes[orientation],
              z: 0,
              kind: "media",
            },
          ],
        },
      }),
    onSuccess: (created) =>
      navigate({
        to: "/companies/$companyId/programming/layouts/$layoutId",
        params: { companyId, layoutId: created.id },
      }),
  });
  return (
    <form
      className="form-stack"
      aria-labelledby="create-layout-title"
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate();
      }}
    >
      <h2 id="create-layout-title">{t.layouts.createTitle}</h2>
      <label htmlFor="layout-name">{t.fieldName}</label>
      <input
        id="layout-name"
        required
        maxLength={120}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <ScopeSelect
        id="layout-scope"
        value={scope}
        branches={branches}
        onChange={setScope}
      />
      <label htmlFor="layout-orientation">{t.layouts.orientationLabel}</label>
      <select
        id="layout-orientation"
        value={orientation}
        onChange={(event) => setOrientation(event.target.value as Orientation)}
      >
        <option value="landscape">{t.layouts.orientations.landscape}</option>
        <option value="portrait">{t.layouts.orientations.portrait}</option>
      </select>
      {create.error && <LayoutFailure error={create.error} operation="write" />}
      <button
        type="submit"
        className="button-primary"
        disabled={create.isPending || !name.trim()}
      >
        {create.isPending ? t.creating : t.create}
      </button>
    </form>
  );
}

/** Reads an exported layout file; null when it is not a JSON object. */
async function readDocument(file: File): Promise<ImportedDocument | null> {
  if (file.size > maxImportBytes) return null;
  try {
    const parsed: unknown = JSON.parse(await file.text());
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as ImportedDocument)
      : null;
  } catch {
    return null;
  }
}

function ImportLayoutForm({
  companyId,
  branches,
}: {
  companyId: string;
  branches: Branch[];
}) {
  const { t } = useProgrammingMessages();
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [scope, setScope] = useState("company");
  const [unreadable, setUnreadable] = useState(false);
  const run = useMutation({
    mutationFn: async (document: ImportedDocument) =>
      importLayout(companyId, {
        branchId: scope === "company" ? null : scope,
        document,
      }),
    onSuccess: (created) =>
      navigate({
        to: "/companies/$companyId/programming/layouts/$layoutId",
        params: { companyId, layoutId: created.id },
      }),
  });
  const areas =
    run.variables && Array.isArray(run.variables.areas)
      ? run.variables.areas
      : [];
  return (
    <form
      className="form-stack"
      aria-labelledby="import-layout-title"
      onSubmit={(event) => {
        event.preventDefault();
        if (!file) return;
        void readDocument(file).then((document) => {
          setUnreadable(document === null);
          if (document) run.mutate(document);
        });
      }}
    >
      <h2 id="import-layout-title">{t.layouts.importTitle}</h2>
      <p className="hint">{t.layouts.importLead}</p>
      <label htmlFor="layout-import-file">{t.layouts.importFile}</label>
      <input
        id="layout-import-file"
        type="file"
        accept="application/json,.json"
        onChange={(event) => {
          setFile(event.target.files?.[0] ?? null);
          setUnreadable(false);
          run.reset();
        }}
      />
      <ScopeSelect
        id="layout-import-scope"
        value={scope}
        branches={branches}
        onChange={setScope}
      />
      {unreadable && (
        <p role="alert" className="notice notice-error">
          {t.layouts.importUnreadable}
        </p>
      )}
      {run.error && (
        <LayoutFailure error={run.error} operation="write" areas={areas} />
      )}
      <button
        type="submit"
        className="button-primary"
        disabled={!file || run.isPending}
      >
        {run.isPending ? t.layouts.importing : t.layouts.import}
      </button>
    </form>
  );
}

function summaryText(layout: LayoutSummary, t: Messages) {
  return [
    scopeName(layout.branch, t),
    t.layouts.orientations[layout.orientation],
    t.layouts.summary(layout.areaCount, layout.pageCount),
  ].join(" · ");
}

function LayoutList({
  companyId,
  filter,
}: {
  companyId: string;
  filter: LayoutsFilter;
}) {
  const { t } = useProgrammingMessages();
  const navigate = useNavigate();
  const [text, setText] = useState(filter.text ?? "");
  const layouts = useQuery({
    queryKey: [...layoutsKey(companyId), filter],
    queryFn: () =>
      listLayouts(companyId, {
        ...(filter.cursor ? { cursor: filter.cursor } : {}),
        ...(filter.text ? { text: filter.text } : {}),
      }),
  });
  return (
    <section aria-labelledby="layouts-title">
      <h2 id="layouts-title">{t.views.layouts}</h2>
      <form
        role="search"
        className="programming-filters"
        onSubmit={(event) => {
          event.preventDefault();
          void navigate({
            to: "/companies/$companyId/programming",
            params: { companyId },
            search: {
              view: "layouts",
              ...(text.trim() ? { text: text.trim() } : {}),
            },
          });
        }}
      >
        <label htmlFor="layout-text">{t.filterText}</label>{" "}
        <input
          id="layout-text"
          type="search"
          maxLength={120}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />{" "}
        <button type="submit">{t.search}</button>
      </form>
      {layouts.isPending ? (
        <p>{t.loading}</p>
      ) : layouts.isError ? (
        <LayoutFailure
          error={layouts.error}
          operation="read"
          onReload={() => void layouts.refetch()}
        />
      ) : layouts.data.items.length === 0 ? (
        <p className="empty-state">
          {filter.cursor ? t.pageEmpty : t.layouts.listEmpty}
        </p>
      ) : (
        <ul className="programming-list">
          {layouts.data.items.map((layout) => (
            <li key={layout.id}>
              <Link
                to="/companies/$companyId/programming/layouts/$layoutId"
                params={{ companyId, layoutId: layout.id }}
              >
                {layout.name}
              </Link>
              <span className="hint">{summaryText(layout, t)}</span>
            </li>
          ))}
        </ul>
      )}
      <nav className="pagination" aria-label={t.views.layouts}>
        {filter.cursor && (
          <Link
            to="/companies/$companyId/programming"
            params={{ companyId }}
            search={{
              view: "layouts",
              ...(filter.text ? { text: filter.text } : {}),
            }}
          >
            {t.firstPage}
          </Link>
        )}
        {layouts.data?.nextCursor && (
          <Link
            to="/companies/$companyId/programming"
            params={{ companyId }}
            search={{
              view: "layouts",
              ...filter,
              cursor: layouts.data.nextCursor,
            }}
          >
            {t.nextPage}
          </Link>
        )}
      </nav>
    </section>
  );
}

/** The layouts section of the programming overview. */
export function LayoutsView({
  companyId,
  company,
  branches,
  filter,
}: {
  companyId: string;
  company: CompanyWithAccess;
  branches: Branch[];
  filter: LayoutsFilter;
}) {
  return (
    <>
      {can(company, "programming.edit") && (
        <>
          <CreateLayoutForm companyId={companyId} branches={branches} />
          <ImportLayoutForm companyId={companyId} branches={branches} />
        </>
      )}
      <LayoutList companyId={companyId} filter={filter} />
    </>
  );
}

// Editor draft

type DraftView = {
  catalogId: string;
  catalogName: string;
  fields: { fieldId: string; role: Role }[];
  presentation: Presentation;
  textSize: number;
  unavailable: "hide" | "show";
  pageSeconds: number;
};

type DraftArea = {
  /** Editor identity; the key may still change before the first save. */
  uid: string;
  saved: boolean;
  key: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  background: string;
  fit: "contain" | "cover";
  muted: boolean;
  volume: number;
  kind: Kind;
  pageControlled: boolean;
  view: DraftView | null;
};

type DraftContent = {
  mediaAssetId: string | null;
  mediaName: string | null;
  viewPage: number | null;
  groupChoiceId: string | null;
};

type DraftPage = {
  uid: string;
  durationSeconds: number;
  /** By area uid. */
  contents: Record<string, DraftContent>;
};

type Draft = {
  name: string;
  audioMixConfirmed: boolean;
  areas: DraftArea[];
  pages: DraftPage[];
};

let draftUids = 0;
const nextUid = () => `draft-${++draftUids}`;

function toDraft(layout: Layout): Draft {
  const areas: DraftArea[] = layout.areas.map((area) => ({
    uid: nextUid(),
    saved: true,
    key: area.key,
    name: area.name,
    x: area.x,
    y: area.y,
    width: area.width,
    height: area.height,
    z: area.z,
    background: area.background,
    fit: area.fit,
    muted: area.muted,
    volume: area.volume,
    kind: area.kind,
    pageControlled: area.pageControlled,
    view: area.view
      ? {
          catalogId: area.view.catalog.id,
          catalogName: area.view.catalog.name,
          fields: area.view.fields.map((field) => ({
            fieldId: field.fieldId,
            role: field.role,
          })),
          presentation: area.view.presentation,
          textSize: area.view.textSize,
          unavailable: area.view.unavailable,
          pageSeconds: area.view.pageSeconds,
        }
      : null,
  }));
  const byKey = new Map(areas.map((area) => [area.key, area.uid]));
  return {
    name: layout.name,
    audioMixConfirmed: layout.audioMixConfirmed,
    areas,
    pages: layout.pages.map((page) => ({
      uid: nextUid(),
      durationSeconds: page.durationSeconds,
      contents: Object.fromEntries(
        page.contents.flatMap((content) => {
          const uid = byKey.get(content.areaKey);
          return uid
            ? [
                [
                  uid,
                  {
                    mediaAssetId: content.mediaAssetId,
                    mediaName: content.media?.name ?? null,
                    viewPage: content.viewPage,
                    groupChoiceId: content.groupChoiceId,
                  },
                ],
              ]
            : [];
        }),
      ),
    })),
  };
}

const emptyContent = (area: DraftArea): DraftContent => ({
  mediaAssetId: null,
  mediaName: null,
  viewPage: area.kind === "catalog" ? 1 : null,
  groupChoiceId: null,
});

function toDefinition(layout: Layout, draft: Draft): LayoutDefinition {
  const controlled = draft.areas.filter((area) => area.pageControlled);
  return {
    orientation: layout.orientation,
    audioMixConfirmed: draft.audioMixConfirmed,
    areas: draft.areas.map((area) => ({
      key: area.key,
      name: area.name,
      x: area.x,
      y: area.y,
      width: area.width,
      height: area.height,
      z: area.z,
      background: area.background,
      fit: area.fit,
      muted: area.muted,
      volume: area.volume,
      kind: area.kind,
      pageControlled: area.pageControlled,
      view:
        area.kind === "catalog" && area.view
          ? {
              catalogId: area.view.catalogId,
              fields: area.view.fields,
              presentation: area.view.presentation,
              textSize: area.view.textSize,
              unavailable: area.view.unavailable,
              pageSeconds: area.view.pageSeconds,
            }
          : null,
    })),
    pages: draft.pages.map((page): PageInput => ({
      durationSeconds: page.durationSeconds,
      contents: controlled.map((area) => {
        const content = page.contents[area.uid] ?? emptyContent(area);
        return area.kind === "media"
          ? { areaKey: area.key, mediaAssetId: content.mediaAssetId }
          : content.groupChoiceId !== null
            ? { areaKey: area.key, groupChoiceId: content.groupChoiceId }
            : { areaKey: area.key, viewPage: content.viewPage };
      }),
    })),
  };
}

const audible = (area: { muted: boolean; volume: number }) =>
  !area.muted && area.volume > 0;

/** A whole number from a number input; NaN stays NaN for the API to refuse. */
const whole = (value: string) =>
  value.trim() === "" ? Number.NaN : Number(value);

// Canvas

type Geometry = Pick<DraftArea, "x" | "y" | "width" | "height">;

const snap = (value: number) => Math.round(value / grid) * grid;
const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));

/**
 * The canvas scaled to the page, with areas drawn by stacking order. Areas
 * move by dragging or arrow keys and resize by their corner or Shift with
 * arrow keys, snapping to 10 units inside the canvas.
 */
function LayoutCanvas({
  name,
  canvas,
  areas,
  selected,
  flagged,
  onSelect,
  onMove,
}: {
  name: string;
  canvas: { width: number; height: number };
  areas: readonly Pick<
    DraftArea,
    "uid" | "name" | "kind" | "background" | "z" | keyof Geometry
  >[];
  selected?: string | null;
  flagged?: ReadonlySet<number>;
  onSelect?: (uid: string) => void;
  onMove?: (uid: string, geometry: Geometry) => void;
}) {
  const { t } = useProgrammingMessages();
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    uid: string;
    mode: "move" | "resize";
    x: number;
    y: number;
    start: Geometry;
    last: Geometry;
  } | null>(null);
  const place = (
    start: Geometry,
    mode: "move" | "resize",
    dx: number,
    dy: number,
  ) =>
    mode === "move"
      ? {
          ...start,
          x: clamp(snap(start.x + dx), 0, canvas.width - start.width),
          y: clamp(snap(start.y + dy), 0, canvas.height - start.height),
        }
      : {
          ...start,
          width: clamp(snap(start.width + dx), minSize, canvas.width - start.x),
          height: clamp(
            snap(start.height + dy),
            minSize,
            canvas.height - start.y,
          ),
        };
  const begin = (
    event: PointerEvent<HTMLElement>,
    area: Geometry & { uid: string },
    mode: "move" | "resize",
  ) => {
    if (!onMove) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    // Preventing the default also prevents focus, which arrow keys need.
    event.currentTarget.closest("button")?.focus();
    const start = {
      x: area.x,
      y: area.y,
      width: area.width,
      height: area.height,
    };
    drag.current = {
      uid: area.uid,
      mode,
      x: event.clientX,
      y: event.clientY,
      start,
      last: start,
    };
    onSelect?.(area.uid);
  };
  const follow = (event: PointerEvent<HTMLElement>) => {
    const current = drag.current;
    const rect = box.current?.getBoundingClientRect();
    if (!current || !rect || !onMove) return;
    const next = place(
      current.start,
      current.mode,
      ((event.clientX - current.x) * canvas.width) / rect.width,
      ((event.clientY - current.y) * canvas.height) / rect.height,
    );
    // A click's jitter that snaps back to the same place changes nothing.
    if (
      next.x === current.last.x &&
      next.y === current.last.y &&
      next.width === current.last.width &&
      next.height === current.last.height
    )
      return;
    current.last = next;
    onMove(current.uid, next);
  };
  const end = () => {
    drag.current = null;
  };
  const keys = (
    event: KeyboardEvent<HTMLButtonElement>,
    area: Geometry & { uid: string },
  ) => {
    const step = {
      ArrowLeft: [-grid, 0],
      ArrowRight: [grid, 0],
      ArrowUp: [0, -grid],
      ArrowDown: [0, grid],
    }[event.key];
    if (!step || !onMove) return;
    event.preventDefault();
    onMove(
      area.uid,
      place(area, event.shiftKey ? "resize" : "move", step[0], step[1]),
    );
  };
  return (
    <div
      ref={box}
      className="layout-canvas"
      role="group"
      aria-label={t.layouts.canvasLabel(name)}
      style={{
        aspectRatio: `${canvas.width} / ${canvas.height}`,
        // Portrait canvases stay within the window's height.
        width: `min(100%, ${(70 * canvas.width) / canvas.height}vh)`,
      }}
    >
      {areas.map((area, index) =>
        !onSelect ? (
          <div
            key={area.uid}
            className="layout-area"
            style={{
              left: `${(area.x / canvas.width) * 100}%`,
              top: `${(area.y / canvas.height) * 100}%`,
              width: `${(area.width / canvas.width) * 100}%`,
              height: `${(area.height / canvas.height) * 100}%`,
              zIndex: area.z + 1,
              background: area.background,
            }}
          >
            <span className="layout-area-label">
              {t.layouts.areaButton(area.name, t.layouts.kinds[area.kind])}
            </span>
          </div>
        ) : (
          <button
            key={area.uid}
            type="button"
            className={`layout-area${area.uid === selected ? " selected" : ""}${
              flagged?.has(index) ? " flagged" : ""
            }`}
            aria-pressed={area.uid === selected}
            style={{
              left: `${(area.x / canvas.width) * 100}%`,
              top: `${(area.y / canvas.height) * 100}%`,
              width: `${(area.width / canvas.width) * 100}%`,
              height: `${(area.height / canvas.height) * 100}%`,
              zIndex: area.z + 1,
              background: area.background,
            }}
            onClick={() => onSelect(area.uid)}
            onPointerDown={(event) => begin(event, area, "move")}
            onPointerMove={follow}
            onPointerUp={end}
            onPointerCancel={end}
            onKeyDown={(event) => keys(event, area)}
          >
            <span className="layout-area-label">
              {t.layouts.areaButton(area.name, t.layouts.kinds[area.kind])}
            </span>
            {onMove && area.uid === selected && (
              <span
                className="layout-area-handle"
                aria-hidden="true"
                onPointerDown={(event) => begin(event, area, "resize")}
                onPointerMove={follow}
                onPointerUp={end}
                onPointerCancel={end}
              />
            )}
          </button>
        ),
      )}
    </div>
  );
}

// Editor panels

function NumberInput({
  id,
  label,
  value,
  min,
  max,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <span className="layout-number">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        step={1}
        required
        value={Number.isNaN(value) ? "" : value}
        onChange={(event) => onChange(whole(event.target.value))}
      />
    </span>
  );
}

function useCatalog(
  companyId: string,
  catalogId: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: catalogKey(companyId, catalogId ?? ""),
    queryFn: () => getCatalog(companyId, catalogId ?? ""),
    enabled: enabled && catalogId !== null,
  });
}

/** A sensible first role for a field of a type; the API checks the pair. */
function defaultRole(type: string, roles: readonly Role[]): Role {
  const preferred: Role =
    type === "money"
      ? "price"
      : type === "media"
        ? "image"
        : type === "selection" || type === "weekdays"
          ? "group"
          : roles.includes("title")
            ? "detail"
            : "title";
  return preferred;
}

function ViewEditor({
  companyId,
  layout,
  area,
  catalogsVisible,
  onChange,
}: {
  companyId: string;
  layout: Layout;
  area: DraftArea;
  catalogsVisible: boolean;
  onChange: (view: DraftView | null) => void;
}) {
  const { t } = useProgrammingMessages();
  const l = t.layouts;
  const view = area.view;
  const choices = useQuery({
    queryKey: ["programming", "layout-catalogs", companyId],
    queryFn: () => listCatalogChoices(companyId),
    enabled: catalogsVisible,
  });
  const catalog = useCatalog(
    companyId,
    view?.catalogId ?? null,
    catalogsVisible,
  );
  // The server checks scope again; this only hides what cannot be used.
  const usable = (choices.data ?? []).filter(
    (item) =>
      item.branch === null ||
      (layout.branch !== null && item.branch.id === layout.branch.id),
  );
  const fields = (catalog.data?.fields ?? []).filter(
    (field) => !field.archived,
  );
  const label = (fieldId: string) =>
    catalog.data?.fields.find((field) => field.id === fieldId)?.label ??
    layout.areas
      .flatMap((entry) => entry.view?.fields ?? [])
      .find((field) => field.fieldId === fieldId)?.label ??
    fieldId;
  const change = (patch: Partial<DraftView>) =>
    view && onChange({ ...view, ...patch });
  const id = `area-${area.uid}`;
  return (
    <fieldset className="layout-view">
      <legend>{l.viewTitle}</legend>
      {!catalogsVisible && <p className="hint">{l.catalogsUnavailable}</p>}
      <label htmlFor={`${id}-catalog`}>{l.catalog}</label>
      <select
        id={`${id}-catalog`}
        value={view?.catalogId ?? ""}
        onChange={(event) => {
          const chosen = usable.find((item) => item.id === event.target.value);
          onChange(
            chosen
              ? {
                  catalogId: chosen.id,
                  catalogName: chosen.name,
                  fields: [],
                  presentation: view?.presentation ?? "list",
                  textSize: view?.textSize ?? 40,
                  unavailable: view?.unavailable ?? "hide",
                  pageSeconds: view?.pageSeconds ?? 10,
                }
              : null,
          );
        }}
      >
        <option value="">{l.chooseCatalog}</option>
        {view && !usable.some((item) => item.id === view.catalogId) && (
          <option value={view.catalogId}>{view.catalogName}</option>
        )}
        {usable.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
      {view && (
        <>
          <p className="hint">{l.viewFieldsHint}</p>
          <ol className="layout-view-fields" aria-label={l.viewFields}>
            {view.fields.map((bound, index) => (
              <li key={`${bound.fieldId}-${index}`}>
                <span className="layout-number">
                  <label htmlFor={`${id}-field-${index}`}>
                    {l.fieldPosition(index + 1)}
                  </label>
                  <select
                    id={`${id}-field-${index}`}
                    value={bound.fieldId}
                    onChange={(event) =>
                      change({
                        fields: view.fields.map((entry, position) =>
                          position === index
                            ? { ...entry, fieldId: event.target.value }
                            : entry,
                        ),
                      })
                    }
                  >
                    {!fields.some((field) => field.id === bound.fieldId) && (
                      <option value={bound.fieldId}>
                        {label(bound.fieldId)}
                      </option>
                    )}
                    {fields.map((field) => (
                      <option key={field.id} value={field.id}>
                        {field.label}
                      </option>
                    ))}
                  </select>
                </span>
                <span className="layout-number">
                  <label htmlFor={`${id}-role-${index}`}>
                    {l.roleOf(index + 1)}
                  </label>
                  <select
                    id={`${id}-role-${index}`}
                    value={bound.role}
                    onChange={(event) =>
                      change({
                        fields: view.fields.map((entry, position) =>
                          position === index
                            ? { ...entry, role: event.target.value as Role }
                            : entry,
                        ),
                      })
                    }
                  >
                    {(Object.keys(l.roles) as Role[]).map((role) => (
                      <option key={role} value={role}>
                        {l.roles[role]}
                      </option>
                    ))}
                  </select>
                </span>
                <span className="programming-item-actions">
                  <button
                    type="button"
                    disabled={index === 0}
                    aria-label={`${t.moveUp}: ${l.fieldPosition(index + 1)}`}
                    onClick={() => {
                      const next = [...view.fields];
                      next.splice(index - 1, 0, ...next.splice(index, 1));
                      change({ fields: next });
                    }}
                  >
                    {t.moveUp}
                  </button>
                  <button
                    type="button"
                    aria-label={`${t.remove}: ${l.fieldPosition(index + 1)}`}
                    onClick={() =>
                      change({
                        fields: view.fields.filter(
                          (_, position) => position !== index,
                        ),
                      })
                    }
                  >
                    {t.remove}
                  </button>
                </span>
              </li>
            ))}
          </ol>
          <button
            type="button"
            disabled={view.fields.length >= 8 || fields.length === 0}
            onClick={() => {
              const used = new Set(view.fields.map((entry) => entry.fieldId));
              const field =
                fields.find((entry) => !used.has(entry.id)) ?? fields[0];
              if (!field) return;
              change({
                fields: [
                  ...view.fields,
                  {
                    fieldId: field.id,
                    role: defaultRole(
                      field.type,
                      view.fields.map((entry) => entry.role),
                    ),
                  },
                ],
              });
            }}
          >
            {l.addField}
          </button>
          <label htmlFor={`${id}-presentation`}>{l.presentation}</label>
          <select
            id={`${id}-presentation`}
            value={view.presentation}
            onChange={(event) =>
              change({ presentation: event.target.value as Presentation })
            }
          >
            {(Object.keys(l.presentations) as Presentation[]).map((item) => (
              <option key={item} value={item}>
                {l.presentations[item]}
              </option>
            ))}
          </select>
          <NumberInput
            id={`${id}-text-size`}
            label={l.textSize}
            value={view.textSize}
            min={24}
            max={200}
            onChange={(textSize) => change({ textSize })}
          />
          <label htmlFor={`${id}-unavailable`}>{l.unavailable}</label>
          <select
            id={`${id}-unavailable`}
            value={view.unavailable}
            onChange={(event) =>
              change({ unavailable: event.target.value as "hide" | "show" })
            }
          >
            <option value="hide">{l.unavailableChoices.hide}</option>
            <option value="show">{l.unavailableChoices.show}</option>
          </select>
          {!area.pageControlled && (
            <NumberInput
              id={`${id}-page-seconds`}
              label={l.pageSeconds}
              value={view.pageSeconds}
              min={5}
              max={120}
              onChange={(pageSeconds) => change({ pageSeconds })}
            />
          )}
        </>
      )}
    </fieldset>
  );
}

function AreaSettings({
  companyId,
  layout,
  area,
  issues,
  catalogsVisible,
  onChange,
  onRemove,
}: {
  companyId: string;
  layout: Layout;
  area: DraftArea;
  issues: string[];
  catalogsVisible: boolean;
  onChange: (area: DraftArea) => void;
  onRemove: () => void;
}) {
  const { t } = useProgrammingMessages();
  const l = t.layouts;
  const id = `area-${area.uid}`;
  const set = (patch: Partial<DraftArea>) => onChange({ ...area, ...patch });
  const canvas = layout.canvas;
  return (
    <section className="layout-settings" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`}>{l.selectedTitle(area.name)}</h3>
      {issues.length > 0 && (
        <p className="layout-field-issue">{issues.join(" ")}</p>
      )}
      <label htmlFor={`${id}-name`}>{l.areaName}</label>
      <input
        id={`${id}-name`}
        required
        maxLength={40}
        value={area.name}
        onChange={(event) => set({ name: event.target.value })}
      />
      <label htmlFor={`${id}-key`}>{l.areaKey}</label>
      <input
        id={`${id}-key`}
        required
        maxLength={16}
        value={area.key}
        readOnly={area.saved}
        onChange={(event) => set({ key: event.target.value })}
      />
      <p className="hint">{l.areaKeyHint}</p>
      <label htmlFor={`${id}-kind`}>{l.areaKind}</label>
      <select
        id={`${id}-kind`}
        value={area.kind}
        onChange={(event) => {
          const kind = event.target.value as Kind;
          set({ kind, view: kind === "media" ? null : area.view });
        }}
      >
        <option value="media">{l.kinds.media}</option>
        <option value="catalog">{l.kinds.catalog}</option>
      </select>
      <fieldset className="layout-geometry">
        <legend>{l.geometry}</legend>
        <NumberInput
          id={`${id}-x`}
          label={l.x}
          value={area.x}
          min={0}
          max={canvas.width}
          onChange={(x) => set({ x })}
        />
        <NumberInput
          id={`${id}-y`}
          label={l.y}
          value={area.y}
          min={0}
          max={canvas.height}
          onChange={(y) => set({ y })}
        />
        <NumberInput
          id={`${id}-width`}
          label={l.width}
          value={area.width}
          min={minSize}
          max={canvas.width}
          onChange={(width) => set({ width })}
        />
        <NumberInput
          id={`${id}-height`}
          label={l.height}
          value={area.height}
          min={minSize}
          max={canvas.height}
          onChange={(height) => set({ height })}
        />
      </fieldset>
      <NumberInput
        id={`${id}-z`}
        label={l.stack}
        value={area.z}
        min={0}
        max={99}
        onChange={(z) => set({ z })}
      />
      <label htmlFor={`${id}-background`}>{l.background}</label>
      <input
        id={`${id}-background`}
        type="color"
        value={area.background.toLowerCase()}
        onChange={(event) =>
          set({ background: event.target.value.toUpperCase() })
        }
      />
      {area.kind === "media" && (
        <>
          <label htmlFor={`${id}-fit`}>{l.fit}</label>
          <select
            id={`${id}-fit`}
            value={area.fit}
            onChange={(event) =>
              set({ fit: event.target.value as "contain" | "cover" })
            }
          >
            <option value="contain">{l.fits.contain}</option>
            <option value="cover">{l.fits.cover}</option>
          </select>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={area.muted}
              onChange={(event) => set({ muted: event.target.checked })}
            />
            {l.muted}
          </label>
          {!area.muted && (
            <NumberInput
              id={`${id}-volume`}
              label={l.volume}
              value={area.volume}
              min={0}
              max={100}
              onChange={(volume) => set({ volume })}
            />
          )}
        </>
      )}
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={area.pageControlled}
          onChange={(event) => set({ pageControlled: event.target.checked })}
        />
        {l.pageControlled}
      </label>
      {area.kind === "catalog" && (
        <ViewEditor
          companyId={companyId}
          layout={layout}
          area={area}
          catalogsVisible={catalogsVisible}
          onChange={(view) => set({ view })}
        />
      )}
      <button type="button" onClick={onRemove}>
        {l.removeArea}
      </button>
    </section>
  );
}

function MediaChoice({
  companyId,
  layout,
  label,
  content,
  onChoose,
}: {
  companyId: string;
  layout: Layout;
  label: string;
  content: DraftContent;
  onChoose: (content: DraftContent) => void;
}) {
  const { t } = useProgrammingMessages();
  const l = t.layouts;
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [query, setQuery] = useState<string | undefined>(undefined);
  const media = useQuery({
    queryKey: ["programming", "picker", companyId, query],
    queryFn: () => listSelectableMedia(companyId, query),
    enabled: open,
  });
  // The server checks scope again; this only hides what cannot be used.
  const items = (media.data?.items ?? []).filter(
    (item) =>
      item.branch === null ||
      (layout.branch !== null && item.branch.id === layout.branch.id),
  );
  return (
    <div className="layout-content">
      <span>
        {label}: <strong>{content.mediaName ?? l.noMedia}</strong>
      </span>{" "}
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? l.closePicker : `${l.chooseMedia}: ${label}`}
      </button>
      {open && (
        <div className="programming-picker">
          {/* Inside the editor's form, so the search is not a form itself. */}
          <div role="search">
            <label>
              {t.filterText}{" "}
              <input
                type="search"
                maxLength={120}
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  setQuery(text.trim() || undefined);
                }}
              />
            </label>{" "}
            <button
              type="button"
              onClick={() => setQuery(text.trim() || undefined)}
            >
              {t.search}
            </button>
          </div>
          {media.isPending ? (
            <p>{t.loading}</p>
          ) : media.isError ? (
            <LayoutFailure error={media.error} operation="read" />
          ) : items.length === 0 ? (
            <p className="empty-state">{t.pickerEmpty}</p>
          ) : (
            <ul className="layout-media-choices">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChoose({
                        mediaAssetId: item.id,
                        mediaName: item.name,
                        viewPage: null,
                        groupChoiceId: null,
                      });
                      setOpen(false);
                    }}
                  >
                    {l.useMedia(item.name)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function CatalogChoice({
  companyId,
  id,
  label,
  area,
  catalogsVisible,
  content,
  onChoose,
}: {
  companyId: string;
  id: string;
  label: string;
  area: DraftArea;
  catalogsVisible: boolean;
  content: DraftContent;
  onChoose: (content: DraftContent) => void;
}) {
  const { t } = useProgrammingMessages();
  const l = t.layouts;
  const catalog = useCatalog(
    companyId,
    area.view?.catalogId ?? null,
    catalogsVisible,
  );
  const groupField = groupFieldOf(area, catalog.data);
  const grouped = Boolean(
    area.view?.fields.some((field) => field.role === "group"),
  );
  const mode = content.groupChoiceId !== null ? "group" : "page";
  const options: { id: string; label: string }[] =
    groupField?.type === "weekdays"
      ? l.weekdays.map((day, index) => ({ id: String(index + 1), label: day }))
      : (groupField?.choices ?? []);
  return (
    <div className="layout-content">
      <span className="layout-number">
        <label htmlFor={`${id}-mode`}>{l.content(label)}</label>
        <select
          id={`${id}-mode`}
          value={mode}
          onChange={(event) =>
            onChoose(
              event.target.value === "group"
                ? {
                    ...content,
                    viewPage: null,
                    groupChoiceId: options[0]?.id ?? "",
                  }
                : { ...content, viewPage: 1, groupChoiceId: null },
            )
          }
        >
          <option value="page">{l.contentModes.page}</option>
          {(grouped || mode === "group") && (
            <option value="group">{l.contentModes.group}</option>
          )}
        </select>
      </span>
      {mode === "page" ? (
        <NumberInput
          id={`${id}-page`}
          label={l.viewPage(label)}
          value={content.viewPage ?? Number.NaN}
          min={1}
          max={1000}
          onChange={(viewPage) => onChoose({ ...content, viewPage })}
        />
      ) : (
        <span className="layout-number">
          <label htmlFor={`${id}-group`}>{l.group(label)}</label>
          <select
            id={`${id}-group`}
            value={content.groupChoiceId ?? ""}
            onChange={(event) =>
              onChoose({ ...content, groupChoiceId: event.target.value })
            }
          >
            <option value="">{l.chooseGroup}</option>
            {content.groupChoiceId &&
              !options.some(
                (option) => option.id === content.groupChoiceId,
              ) && (
                <option value={content.groupChoiceId}>
                  {content.groupChoiceId}
                </option>
              )}
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </span>
      )}
    </div>
  );
}

function groupFieldOf(area: DraftArea, catalog: Catalog | undefined) {
  const bound = area.view?.fields.find((field) => field.role === "group");
  return bound
    ? catalog?.fields.find((field) => field.id === bound.fieldId)
    : undefined;
}

function PagesEditor({
  companyId,
  layout,
  draft,
  catalogsVisible,
  onChange,
}: {
  companyId: string;
  layout: Layout;
  draft: Draft;
  catalogsVisible: boolean;
  onChange: (pages: DraftPage[]) => void;
}) {
  const { t } = useProgrammingMessages();
  const l = t.layouts;
  const controlled = draft.areas.filter((area) => area.pageControlled);
  const setPage = (index: number, page: DraftPage) =>
    onChange(
      draft.pages.map((entry, position) => (position === index ? page : entry)),
    );
  const addPage = () => {
    const last = draft.pages.at(-1);
    const fresh = (): DraftPage => ({
      uid: nextUid(),
      durationSeconds: 10,
      contents: Object.fromEntries(
        controlled.map((area) => [
          area.uid,
          last?.contents[area.uid] ?? emptyContent(area),
        ]),
      ),
    });
    // Pages come in twos at first: a layout has none or at least two.
    onChange(
      draft.pages.length === 0 ? [fresh(), fresh()] : [...draft.pages, fresh()],
    );
  };
  return (
    <section aria-labelledby="layout-pages-title" className="form-stack">
      <h2 id="layout-pages-title">{l.pagesTitle}</h2>
      <p className="hint">{l.pagesLead}</p>
      {controlled.length === 0 && <p className="hint">{l.noControlledAreas}</p>}
      {draft.pages.length === 0 ? (
        <p className="empty-state">{l.pagesEmpty}</p>
      ) : (
        <ol className="layout-pages">
          {draft.pages.map((page, index) => {
            const suggested = layout.pages[index]?.suggestedSeconds ?? null;
            return (
              <li key={page.uid} aria-label={l.pageTitle(index + 1)}>
                <h3>{l.pageTitle(index + 1)}</h3>
                <NumberInput
                  id={`page-${page.uid}-duration`}
                  label={`${l.pageTitle(index + 1)}: ${l.pageDuration}`}
                  value={page.durationSeconds}
                  min={1}
                  max={600}
                  onChange={(durationSeconds) =>
                    setPage(index, { ...page, durationSeconds })
                  }
                />
                {suggested !== null && (
                  <p className="hint">{l.suggested(suggested)}</p>
                )}
                {controlled.map((area) => {
                  const content = page.contents[area.uid] ?? emptyContent(area);
                  const choose = (next: DraftContent) =>
                    setPage(index, {
                      ...page,
                      contents: { ...page.contents, [area.uid]: next },
                    });
                  return area.kind === "media" ? (
                    <MediaChoice
                      key={area.uid}
                      companyId={companyId}
                      layout={layout}
                      label={`${l.pageTitle(index + 1)} · ${area.name}`}
                      content={content}
                      onChoose={choose}
                    />
                  ) : (
                    <CatalogChoice
                      key={area.uid}
                      companyId={companyId}
                      id={`content-${page.uid}-${area.uid}`}
                      label={`${l.pageTitle(index + 1)} · ${area.name}`}
                      area={area}
                      catalogsVisible={catalogsVisible}
                      content={content}
                      onChoose={choose}
                    />
                  );
                })}
                <button
                  type="button"
                  aria-label={`${l.removePage}: ${l.pageTitle(index + 1)}`}
                  onClick={() =>
                    onChange(
                      draft.pages.filter((_, position) => position !== index),
                    )
                  }
                >
                  {l.removePage}
                </button>
              </li>
            );
          })}
        </ol>
      )}
      <button
        type="button"
        disabled={draft.pages.length >= 20}
        onClick={addPage}
      >
        {l.addPage}
      </button>
    </section>
  );
}

function FitReport({ layout }: { layout: Layout }) {
  const { t } = useProgrammingMessages();
  const l = t.layouts;
  const names = new Map(layout.areas.map((area) => [area.key, area.name]));
  return (
    <section aria-labelledby="layout-fit-title">
      <h2 id="layout-fit-title">{l.fitTitle}</h2>
      <p className="hint">{l.fitLead}</p>
      {layout.fit.length === 0 ? (
        <p className="empty-state">{l.fitEmpty}</p>
      ) : (
        <ul className="programming-list layout-fit">
          {layout.fit.map((entry) => (
            <li key={entry.areaKey}>
              <span className="programming-item-name">
                {names.get(entry.areaKey) ?? entry.areaKey}
              </span>
              <span className="hint">
                {l.fitSummary(entry.records, entry.pages, entry.rowsPerPage)}
              </span>
              {entry.overflow.length > 0 && (
                <ul className="layout-overflow">
                  {entry.overflow.map((overflow) => (
                    <li key={`${overflow.recordId}-${overflow.reason}`}>
                      {overflow.title ?? l.overflowRecord}:{" "}
                      {l.overflow[overflow.reason] ?? t.generic}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Downloads the layout's `teluni.layout` JSON. */
function download(document: LayoutDocument) {
  const blob = new Blob([`${JSON.stringify(document, null, 2)}\n`], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement("a");
  link.href = url;
  link.download = `${
    document.name
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "layout"
  }.teluni-layout.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function ExportButton({
  companyId,
  layout,
  onDone,
}: {
  companyId: string;
  layout: Layout;
  onDone: (notice: string) => void;
}) {
  const { t } = useProgrammingMessages();
  const run = useMutation({
    mutationFn: () => exportLayout(companyId, layout.id),
    onSuccess: (document) => {
      download(document);
      onDone(t.layouts.exported);
    },
  });
  return (
    <>
      <button
        type="button"
        disabled={run.isPending}
        onClick={() => run.mutate()}
      >
        {run.isPending ? t.layouts.exporting : t.layouts.export}
      </button>
      {run.error && <LayoutFailure error={run.error} operation="read" />}
    </>
  );
}

function issuesOfArea(error: unknown, index: number, t: Messages): string[] {
  if (!(error instanceof ApiFailure)) return [];
  return error.issues
    .filter((issue) => new RegExp(`^/areas/${index}(?:/|$)`).test(issue.path))
    .map((issue) => t.layouts.issues[issue.reason] ?? t.generic);
}

function LayoutEditor({
  companyId,
  layout,
  catalogsVisible,
  onChanged,
}: {
  companyId: string;
  layout: Layout;
  catalogsVisible: boolean;
  onChanged: (changed: Layout | null, notice?: string) => Promise<void>;
}) {
  const { t } = useProgrammingMessages();
  const l = t.layouts;
  const [draft, setDraft] = useState<Draft>(() => toDraft(layout));
  const [selected, setSelected] = useState<string | null>(
    () => draft.areas[0]?.uid ?? null,
  );
  const [dirty, setDirty] = useState(false);
  const change = (next: Draft) => {
    setDraft(next);
    setDirty(true);
  };
  const setArea = (uid: string, patch: Partial<DraftArea>) =>
    change({
      ...draft,
      areas: draft.areas.map((area) =>
        area.uid === uid ? { ...area, ...patch } : area,
      ),
    });
  const [confirmRemoval, setConfirmRemoval] = useState(false);
  const save = useMutation({
    mutationFn: () =>
      updateLayout(companyId, layout, {
        ...(draft.name.trim() !== layout.name ? { name: draft.name } : {}),
        definition: toDefinition(layout, draft),
        ...(confirmRemoval ? { confirmRemovedOutputs: true } : {}),
      }),
    onSuccess: (changed) => onChanged(changed, l.layoutSaved),
  });
  const removalPending =
    save.error instanceof ApiFailure &&
    save.error.code === "LAYOUT_CHANGE_CONFIRMATION_REQUIRED";
  const addArea = (kind: Kind) => {
    const keys = new Set(draft.areas.map((area) => area.key));
    let number = draft.areas.length + 1;
    while (keys.has(`area-${number}`)) number += 1;
    const canvas = layout.canvas;
    const width = Math.min(480, canvas.width);
    const height = Math.min(270, canvas.height);
    const area: DraftArea = {
      uid: nextUid(),
      saved: false,
      key: `area-${number}`,
      name: l.newAreaName(number),
      x: snap((canvas.width - width) / 2),
      y: snap((canvas.height - height) / 2),
      width,
      height,
      z: Math.min(99, Math.max(-1, ...draft.areas.map((entry) => entry.z)) + 1),
      background: "#000000",
      fit: "contain",
      muted: true,
      volume: 100,
      kind,
      pageControlled: false,
      view: null,
    };
    change({ ...draft, areas: [...draft.areas, area] });
    setSelected(area.uid);
  };
  const flagged = new Set(
    draft.areas.flatMap((_, index) =>
      issuesOfArea(save.error, index, t).length > 0 ? [index] : [],
    ),
  );
  const current = draft.areas.find((area) => area.uid === selected) ?? null;
  const audibleAreas = draft.areas.filter(
    (area) => area.kind === "media" && audible(area),
  );
  return (
    <form
      className="layout-editor"
      aria-label={l.saveLayout}
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <section className="form-stack" aria-labelledby="layout-name-title">
        <h2 id="layout-name-title">{l.nameTitle}</h2>
        <label htmlFor="layout-rename">{t.fieldName}</label>
        <input
          id="layout-rename"
          required
          maxLength={120}
          value={draft.name}
          onChange={(event) => change({ ...draft, name: event.target.value })}
        />
      </section>
      <section aria-labelledby="layout-areas-title">
        <h2 id="layout-areas-title">{l.areasTitle}</h2>
        <p className="hint">{l.canvasHint}</p>
        <div className="layout-workspace">
          <LayoutCanvas
            name={draft.name}
            canvas={layout.canvas}
            areas={draft.areas}
            selected={selected}
            flagged={flagged}
            onSelect={setSelected}
            onMove={(uid, geometry) => setArea(uid, geometry)}
          />
          <div className="layout-side">
            <div className="programming-item-actions">
              <button
                type="button"
                disabled={draft.areas.length >= 12}
                onClick={() => addArea("media")}
              >
                {l.addMediaArea}
              </button>
              <button
                type="button"
                disabled={draft.areas.length >= 12}
                onClick={() => addArea("catalog")}
              >
                {l.addCatalogArea}
              </button>
            </div>
            {current ? (
              <AreaSettings
                key={current.uid}
                companyId={companyId}
                layout={layout}
                area={current}
                issues={issuesOfArea(
                  save.error,
                  draft.areas.indexOf(current),
                  t,
                )}
                catalogsVisible={catalogsVisible}
                onChange={(area) => setArea(area.uid, area)}
                onRemove={() => {
                  change({
                    ...draft,
                    areas: draft.areas.filter(
                      (area) => area.uid !== current.uid,
                    ),
                  });
                  setSelected(null);
                }}
              />
            ) : (
              <p className="hint">{l.noSelection}</p>
            )}
          </div>
        </div>
      </section>
      {(audibleAreas.length > 1 || draft.audioMixConfirmed) && (
        <fieldset className="layout-audio">
          <legend>{l.audioTitle}</legend>
          <p className="hint">
            {l.audioAreas(audibleAreas.map((area) => area.name).join(", "))}
          </p>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={draft.audioMixConfirmed}
              onChange={(event) =>
                change({ ...draft, audioMixConfirmed: event.target.checked })
              }
            />
            {l.audioMix}
          </label>
        </fieldset>
      )}
      <PagesEditor
        companyId={companyId}
        layout={layout}
        draft={draft}
        catalogsVisible={catalogsVisible}
        onChange={(pages) => change({ ...draft, pages })}
      />
      {dirty && <p className="hint">{t.unsaved}</p>}
      {save.error && (
        <LayoutFailure
          error={save.error}
          operation="write"
          areas={draft.areas}
          outputs={layout.areas}
          onReload={() => {
            save.reset();
            void onChanged(layout);
          }}
        />
      )}
      {removalPending && (
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={confirmRemoval}
            onChange={(event) => setConfirmRemoval(event.target.checked)}
          />
          {l.confirmRemoval}
        </label>
      )}
      <button
        type="submit"
        className="button-primary"
        disabled={
          !dirty ||
          !draft.name.trim() ||
          save.isPending ||
          mustReload(save.error) ||
          (removalPending && !confirmRemoval)
        }
      >
        {save.isPending ? t.saving : l.saveLayout}
      </button>
    </form>
  );
}

function ReadOnlyLayout({ layout }: { layout: Layout }) {
  const { t } = useProgrammingMessages();
  const l = t.layouts;
  return (
    <section aria-labelledby="layout-areas-title">
      <h2 id="layout-areas-title">{l.readOnlyAreas}</h2>
      <LayoutCanvas
        name={layout.name}
        canvas={layout.canvas}
        areas={layout.areas.map((area) => ({ ...area, uid: area.key }))}
      />
      <ul className="programming-list">
        {layout.areas.map((area) => (
          <li key={area.key}>
            <span className="programming-item-name">{area.name}</span>
            <span className="hint">
              {l.kinds[area.kind]} · {area.width} × {area.height}
              {area.view ? ` · ${l.viewOf(area.view.catalog.name)}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function LayoutDetail({
  companyId,
  layoutId,
  company,
}: {
  companyId: string;
  layoutId: string;
  company: CompanyWithAccess;
}) {
  const { t } = useProgrammingMessages();
  const l = t.layouts;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [notice, setNotice] = useState<string | null>(null);
  const layout = useQuery({
    queryKey: layoutKey(companyId, layoutId),
    queryFn: () => getLayout(companyId, layoutId),
  });
  const onChanged = async (changed: Layout | null, done?: string) => {
    setNotice(done ?? null);
    if (changed)
      queryClient.setQueryData(layoutKey(companyId, layoutId), changed);
    await queryClient.invalidateQueries({ queryKey: layoutsKey(companyId) });
    if (!changed)
      await queryClient.invalidateQueries({
        queryKey: layoutKey(companyId, layoutId),
      });
  };
  if (layout.isPending) return <p>{t.loading}</p>;
  if (layout.isError)
    return (
      <>
        <LayoutFailure
          error={layout.error}
          operation="read"
          onReload={() => void layout.refetch()}
        />
        <BackLink companyId={companyId} view="layouts" />
      </>
    );
  const item = layout.data;
  // Company layouts need company-wide authority, which the server decides.
  const edit = can(company, "programming.edit");
  return (
    <>
      <BackLink companyId={companyId} view="layouts" />
      <h1 id="programming-title">{item.name}</h1>
      <p className="hint">
        {scopeName(item.branch, t)} · {l.orientations[item.orientation]} ·{" "}
        {l.summary(item.areas.length, item.pages.length)}
      </p>
      {notice && <p role="status">{notice}</p>}
      <ExportButton
        companyId={companyId}
        layout={item}
        onDone={(done) => setNotice(done)}
      />
      {edit ? (
        <LayoutEditor
          key={`editor-${item.version}`}
          companyId={companyId}
          layout={item}
          catalogsVisible={can(company, "catalogs.view")}
          onChanged={onChanged}
        />
      ) : (
        <ReadOnlyLayout layout={item} />
      )}
      <FitReport layout={item} />
      {edit && (
        <ConfirmedDelete
          key={`delete-${item.version}`}
          title={l.deleteTitle}
          lead={l.deleteLead}
          confirm={l.deleteConfirm(item.name)}
          label={l.delete}
          run={() => deleteLayout(companyId, item)}
          onDone={() => {
            void queryClient.invalidateQueries({
              queryKey: layoutsKey(companyId),
            });
            void navigate({
              to: "/companies/$companyId/programming",
              params: { companyId },
              search: { view: "layouts" },
            });
          }}
        />
      )}
    </>
  );
}

export function LayoutPage({
  companyId,
  layoutId,
}: {
  companyId: string;
  layoutId: string;
}) {
  return (
    <CompanyGate
      companyId={companyId}
      returnTo={`/companies/${companyId}/programming/layouts/${layoutId}`}
    >
      {(company) => (
        <LayoutDetail
          companyId={companyId}
          layoutId={layoutId}
          company={company}
        />
      )}
    </CompanyGate>
  );
}
