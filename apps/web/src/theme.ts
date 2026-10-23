import { useEffect, useState } from "react";

export type ThemePreference = "system" | "light" | "dark";
const storageKey = "teluni.theme";

function preferenceFrom(value: string | null): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

function readPreference(): ThemePreference {
  try {
    return preferenceFrom(localStorage.getItem(storageKey));
  } catch {
    return "system";
  }
}

/** Only the appearance preference is stored; no session or tenant data. */
export function useColorTheme() {
  const [preference, setPreference] = useState(readPreference);
  const [systemDark, setSystemDark] = useState(
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );

  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const updateSystem = () => setSystemDark(media.matches);
    const updateStorage = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null)
        setPreference(readPreference());
    };
    updateSystem();
    media.addEventListener("change", updateSystem);
    window.addEventListener("storage", updateStorage);
    return () => {
      media.removeEventListener("change", updateSystem);
      window.removeEventListener("storage", updateStorage);
    };
  }, []);

  function selectTheme(value: ThemePreference) {
    setPreference(value);
    try {
      if (value === "system") localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, value);
    } catch {
      // Storage may be unavailable; the current view still changes theme.
    }
  }

  return {
    preference,
    theme:
      preference === "system" ? (systemDark ? "dark" : "light") : preference,
    selectTheme,
  };
}
