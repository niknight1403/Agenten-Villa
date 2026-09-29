import React, { createContext, useContext, useEffect, useState } from "react";

/**
 * Four selectable dashboard designs. Each id maps to a `.theme-<id>` class on
 * `.villa-app` (see client/src/styles/themes.css). The choice is persisted per
 * browser and applied before the app renders (see main.tsx).
 */
export type DashboardThemeId = "midnight" | "paper" | "terminal" | "sunset";

export type DashboardTheme = {
  id: DashboardThemeId;
  name: string;
  tagline: string;
  /** Short palette preview used by the switcher (CSS colors). */
  swatch: [string, string, string];
  /** Light themes need dark text on the native splash. */
  scheme: "dark" | "light";
};

export const DASHBOARD_THEMES: readonly DashboardTheme[] = [
  {
    id: "midnight",
    name: "Mitternacht",
    tagline: "Neon-Werkstatt · Teal & Violett",
    swatch: ["#0b0b1d", "#19d7c2", "#9571ff"],
    scheme: "dark",
  },
  {
    id: "paper",
    name: "Papier",
    tagline: "Editorial hell · Serif & Terrakotta",
    swatch: ["#f6f2ea", "#1f4d3a", "#b4441f"],
    scheme: "light",
  },
  {
    id: "terminal",
    name: "Terminal",
    tagline: "Monochrom · Phosphorgrün",
    swatch: ["#050805", "#4dff88", "#16411f"],
    scheme: "dark",
  },
  {
    id: "sunset",
    name: "Sonnenuntergang",
    tagline: "Gradient-Glas · Amber & Pink",
    swatch: ["#2a1030", "#ff9f6d", "#e0498b"],
    scheme: "dark",
  },
] as const;

export const DEFAULT_DASHBOARD_THEME: DashboardThemeId = "midnight";
const STORAGE_KEY = "villa-dashboard-theme";

export function isDashboardThemeId(value: unknown): value is DashboardThemeId {
  return (
    typeof value === "string" &&
    DASHBOARD_THEMES.some(theme => theme.id === value)
  );
}

/** Reads the persisted theme without touching React (used before first paint). */
export function readStoredDashboardTheme(): DashboardThemeId {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isDashboardThemeId(stored)) return stored;
  } catch {
    // localStorage unavailable (privacy mode) — fall back to the default.
  }
  return DEFAULT_DASHBOARD_THEME;
}

interface DashboardThemeContextValue {
  theme: DashboardThemeId;
  setTheme: (theme: DashboardThemeId) => void;
  themes: readonly DashboardTheme[];
}

const DashboardThemeContext = createContext<
  DashboardThemeContextValue | undefined
>(undefined);

export function DashboardThemeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [theme, setThemeState] = useState<DashboardThemeId>(() =>
    readStoredDashboardTheme()
  );

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Ignore persistence failures; the in-memory choice still applies.
    }
  }, [theme]);

  const value: DashboardThemeContextValue = {
    theme,
    setTheme: setThemeState,
    themes: DASHBOARD_THEMES,
  };

  return (
    <DashboardThemeContext.Provider value={value}>
      {children}
    </DashboardThemeContext.Provider>
  );
}

export function useDashboardTheme(): DashboardThemeContextValue {
  const context = useContext(DashboardThemeContext);
  if (!context) {
    throw new Error(
      "useDashboardTheme must be used within DashboardThemeProvider"
    );
  }
  return context;
}
