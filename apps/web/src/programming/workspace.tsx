import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Button, TextField } from "../components.js";
import type { DataSetMode } from "../dataset.js";
import { NavigationIcon } from "../navigation-icon.js";
import { useProgrammingMessages } from "./common.js";
import type { ProgramSource } from "./api.js";

export type ProgrammingSection =
  "preview" | "screens" | "publication" | "settings";
export type ProgrammingDetailFilter = Readonly<{
  section?: ProgrammingSection;
}>;

/** Visit on demand, then keep local drafts mounted while another URL section is shown. */
export function ProgrammingPanel({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  const [visited, setVisited] = useState(active);
  useEffect(() => {
    if (active) setVisited(true);
  }, [active]);
  return visited || active ? (
    <div className="programming-section-panel" hidden={!active}>
      {children}
    </div>
  ) : null;
}

/** Explains the existing content-to-screen workflow without inferring completion. */
export function ProgrammingGuide() {
  const { t } = useProgrammingMessages(),
    w = t.workspace;
  return (
    <section className="programming-guide" aria-label={w.guideTitle}>
      <ol>
        {[
          {
            title: w.stepContent,
            text: w.stepContentLead,
            icon: "media" as const,
          },
          {
            title: w.stepSchedule,
            text: w.stepScheduleLead,
            icon: "programming" as const,
          },
          {
            title: w.stepPublish,
            text: w.stepPublishLead,
            icon: "sessions" as const,
          },
        ].map((step, index) => (
          <li key={step.title}>
            <span className="programming-step-number">{index + 1}</span>
            <div>
              <strong>{step.title}</strong>
              <p>{step.text}</p>
            </div>
            <NavigationIcon name={step.icon} />
          </li>
        ))}
      </ol>
    </section>
  );
}

export function ProgramNavigation({
  companyId,
  source,
  section,
  editable,
  assignable,
}: {
  companyId: string;
  source: ProgramSource;
  section?: ProgrammingSection;
  editable: boolean;
  assignable?: boolean;
}) {
  const { t } = useProgrammingMessages(),
    w = t.workspace;
  const items = [
    { id: undefined, label: w.scheduleTab },
    { id: "preview" as const, label: w.previewTab },
    ...(source.kind === "group"
      ? [{ id: "screens" as const, label: w.screensTab }]
      : []),
    { id: "publication" as const, label: w.publishTab },
    ...((source.kind === "group" ? editable : assignable)
      ? [
          {
            id: "settings" as const,
            label: source.kind === "group" ? w.settingsTab : w.destinationTab,
          },
        ]
      : []),
  ];
  return (
    <nav className="programming-tabs" aria-label={w.detailSections}>
      {items.map((item) =>
        source.kind === "group" ? (
          <Link
            key={item.id ?? "schedule"}
            to="/companies/$companyId/programming/groups/$groupId"
            params={{ companyId, groupId: source.groupId }}
            search={item.id ? { section: item.id } : {}}
            aria-current={section === item.id ? "page" : undefined}
          >
            {item.label}
          </Link>
        ) : (
          <Link
            key={item.id ?? "schedule"}
            to="/companies/$companyId/programming/screens/$deviceId"
            params={{ companyId, deviceId: source.deviceId }}
            search={item.id ? { section: item.id } : {}}
            aria-current={section === item.id ? "page" : undefined}
          >
            {item.label}
          </Link>
        ),
      )}
    </nav>
  );
}

export type ProgrammingSearch = Readonly<{
  view?: "groups" | "layouts";
  cursor?: string;
  text?: string;
  mode?: DataSetMode;
  record?: string;
}>;

/** The three programming datasets share URL selection and draft navigation rules. */
export function useProgrammingDataSet<Row extends { id: string }>({
  companyId,
  filter,
  rows,
  editable,
}: {
  companyId: string;
  filter: ProgrammingSearch;
  rows: readonly Row[];
  editable: boolean;
}) {
  const navigate = useNavigate();
  const [dirty, setDirty] = useState(false);
  const queuedSearch = useRef<ProgrammingSearch | null>(null);
  const mode = filter.mode ?? "grid";
  const record =
    editable &&
    (filter.record === "new" ||
      (filter.view === "layouts" && filter.record === "import"))
      ? filter.record
      : rows.some((row) => row.id === filter.record)
        ? filter.record
        : mode === "form"
          ? rows[0]?.id
          : undefined;
  const selected = rows.find((row) => row.id === record);
  const go = (
    next: Pick<ProgrammingSearch, "mode" | "record">,
    replace = false,
  ) => {
    setDirty(false);
    // DataSet reports row activation as selection + mode in the same event.
    // Commit one URL update so competing navigations cannot discard either.
    const search = { ...(queuedSearch.current ?? filter), ...next };
    queuedSearch.current = search;
    queueMicrotask(() => {
      if (queuedSearch.current !== search) return;
      queuedSearch.current = null;
      void navigate({
        to: "/companies/$companyId/programming",
        params: { companyId },
        search,
        replace,
        resetScroll: false,
      });
    });
  };
  return { mode, record, selected, dirty, setDirty, go };
}

/** Server-side name filtering, composed from the existing field/action controls. */
export function ProgrammingNameFilter({
  text,
  onApply,
}: {
  text?: string;
  onApply: (text: string | undefined) => void;
}) {
  const { t } = useProgrammingMessages();
  const [value, setValue] = useState(text ?? "");
  return (
    <form
      className="form-stack"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        onApply(value.trim() || undefined);
      }}
    >
      <TextField
        label={t.filterText}
        type="search"
        maxLength={120}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        data-autofocus
      />
      <div className="button-row">
        <Button type="submit" variant="primary">
          {t.search}
        </Button>
        <Button onClick={() => onApply(undefined)}>
          {t.workspace.clearFilter}
        </Button>
      </div>
    </form>
  );
}
