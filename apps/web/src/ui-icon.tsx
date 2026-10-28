const paths = {
  grid: "M3 4h18v16H3zM3 9h18M3 14h18M9 9v11",
  form: "M5 3h14v18H5zM8 8h8M8 12h8M8 16h5",
  add: "M12 5v14M5 12h14",
  previous: "m15 6-6 6 6 6",
  next: "m9 6 6 6-6 6",
  delete: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  duplicate: "M8 8h12v12H8zM4 16V4h12",
  refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
  more: "M12 5h.01M12 12h.01M12 19h.01",
  filter: "M3 5h18l-7 8v6l-4 2v-8z",
  sortAscending: "M12 19V5M6 11l6-6 6 6",
  sortDescending: "M12 5v14M6 13l6 6 6-6",
  check: "m5 12 5 5 9-10",
  download: "M12 4v11M7 10l5 5 5-5M5 20h14",
} as const;

export type UiIconName = keyof typeof paths;

/** Decorative icons of shared components; each control keeps its own label. */
export function UiIcon({ name }: { name: UiIconName }) {
  return (
    <svg className="ui-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}
