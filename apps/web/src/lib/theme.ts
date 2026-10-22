import { useCallback, useState } from "react";

/**
 * Named color themes. Each id here needs a matching `:root[data-theme="…"]`
 * block in styles.css that re-assigns the design-token variables; "midnight"
 * is the default and uses the `@theme` values as-is, so it has no block.
 *
 * A theme is a personal display preference, not campaign content, so it lives
 * in localStorage — same reasoning as the sidebar's expand/collapse state.
 */
export const THEMES = [
  { id: "midnight", label: "Midnight", swatch: "#4a63c4" },
  { id: "ember", label: "Ember", swatch: "#a8323a" },
  { id: "parchment", label: "Parchment", swatch: "#e9dfc9" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

const STORAGE_KEY = "dwa:theme";

function isThemeId(value: string | null): value is ThemeId {
  return THEMES.some((t) => t.id === value);
}

export function readTheme(): ThemeId {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isThemeId(stored) ? stored : "midnight";
  } catch {
    return "midnight";
  }
}

export function applyTheme(theme: ThemeId): void {
  const root = document.documentElement;
  if (theme === "midnight") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeId>(readTheme);

  const setTheme = useCallback((next: ThemeId) => {
    applyTheme(next);
    setThemeState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Best-effort: blocked storage just means the choice doesn't stick.
    }
  }, []);

  return { theme, setTheme };
}
