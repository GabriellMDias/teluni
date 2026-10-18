// Interface locale selection shared by product workflows. Locale is
// independent of time zone, currency and country; no i18n library is
// selected yet (D-10).

export type Locale = "pt-BR" | "en-US";

/** Brazil is the initial market: Portuguese unless the browser prefers English. */
export function preferredLocale(languages: readonly string[]): Locale {
  for (const language of languages) {
    const normalized = language.toLowerCase();
    if (normalized.startsWith("pt")) return "pt-BR";
    if (normalized.startsWith("en")) return "en-US";
  }
  return "pt-BR";
}

export function browserLocale(): Locale {
  return preferredLocale(
    typeof navigator === "undefined" ? [] : navigator.languages,
  );
}
