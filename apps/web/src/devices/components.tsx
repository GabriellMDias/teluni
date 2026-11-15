import type { ReactNode } from "react";

/** Feature-owned grouping for a screen's information or task. */
export function ScreenCard({
  title,
  description,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`screen-card ${className}`} aria-label={title}>
      <header className="screen-card-heading">
        <h2>{title}</h2>
        {description && <p className="hint">{description}</p>}
      </header>
      {children}
    </section>
  );
}

/** Text remains the source of meaning; the dot and tone are decorative. */
export function ScreenStatus({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "positive" | "danger" | "info" | "neutral";
}) {
  return (
    <span className={`screen-status screen-status-${tone}`}>{children}</span>
  );
}
