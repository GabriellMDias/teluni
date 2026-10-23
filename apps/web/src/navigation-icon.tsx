const paths = {
  home: "m3 10 9-7 9 7M5 9v12h5v-7h4v7h5V9",
  companies: "M4 21V5h10v16M14 11h6v10M8 9h2M8 13h2M8 17h2M2 21h20",
  sessions: "M3 4h18v12H3zM8 21h8M12 16v5",
  signIn: "M14 3h7v18h-7M3 12h13m-5-5 5 5-5 5",
  signOut: "M10 3H3v18h7M8 12h13m-5-5 5 5-5 5",
  branches:
    "M12 22s7-8 7-13a7 7 0 0 0-14 0c0 5 7 13 7 13ZM9 9a3 3 0 1 0 6 0 3 3 0 0 0-6 0",
  media: "M3 3h18v18H3zM3 17l6-6 4 4 3-3 5 5M15 7h.01",
  programming: "m12 3 10 5-10 5L2 8 12 3ZM2 12l10 5 10-5M2 16l10 5 10-5",
  catalogs: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  settings: "M3 7h18M3 17h18M8 3v8M16 13v8",
  members:
    "M5 7a4 4 0 1 0 8 0 4 4 0 0 0-8 0M2 21v-2a7 7 0 0 1 14 0v2M16 3a4 4 0 0 1 0 8M19 14a6 6 0 0 1 3 5v2",
  profiles: "M12 2 3 6v6c0 6 9 10 9 10s9-4 9-10V6l-9-4ZM8 12l3 3 5-6",
  invitations: "M3 5h18v14H3zM3 5l9 7 9-7",
  history: "M3 12a9 9 0 1 0 3-7M3 3v5h5M12 7v5l3 2",
} as const;

/** Decorative icons; each navigation action retains its visible text label. */
export function NavigationIcon({ name }: { name: keyof typeof paths }) {
  return (
    <svg className="navigation-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}
