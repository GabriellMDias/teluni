import { useEffect, useState } from "react";

const storageKey = "teluni.sidebar";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(storageKey) === "collapsed";
  } catch {
    return false;
  }
}

/** Only the desktop sidebar layout is stored; no session or tenant data. */
export function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(readCollapsed);

  useEffect(() => {
    const updateStorage = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null)
        setCollapsed(readCollapsed());
    };
    window.addEventListener("storage", updateStorage);
    return () => window.removeEventListener("storage", updateStorage);
  }, []);

  function toggleCollapsed() {
    const value = !collapsed;
    setCollapsed(value);
    try {
      if (value) localStorage.setItem(storageKey, "collapsed");
      else localStorage.removeItem(storageKey);
    } catch {
      // Storage may be unavailable; the current view still changes layout.
    }
  }

  return { collapsed, toggleCollapsed };
}
