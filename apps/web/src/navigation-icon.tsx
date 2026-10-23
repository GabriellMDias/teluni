const paths = {
  home: "m3 10 9-7 9 7M5 9v12h5v-7h4v7h5V9",
  companies: "M4 21V5h10v16M14 11h6v10M8 9h2M8 13h2M8 17h2M2 21h20",
  sessions: "M3 4h18v12H3zM8 21h8M12 16v5",
  signIn: "M14 3h7v18h-7M3 12h13m-5-5 5 5-5 5",
  signOut: "M10 3H3v18h7M8 12h13m-5-5 5 5-5 5",
} as const;

/** Decorative icons; each navigation action retains its visible text label. */
export function NavigationIcon({ name }: { name: keyof typeof paths }) {
  return (
    <svg className="navigation-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}
