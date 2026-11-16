import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
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

/** Native disclosure retains form and unknown-outcome state when collapsed. */
export function ProgrammingCreate({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <details className="programming-create">
      <summary>
        <span>{title}</span>
        <span className="programming-create-plus" aria-hidden="true">
          ＋
        </span>
      </summary>
      <div className="programming-create-body">{children}</div>
    </details>
  );
}
