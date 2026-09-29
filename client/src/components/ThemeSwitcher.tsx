import { useEffect, useRef, useState } from "react";
import { Check, Palette } from "lucide-react";
import {
  DASHBOARD_THEMES,
  useDashboardTheme,
} from "@/contexts/DashboardThemeContext";

/**
 * Compact dashboard-design picker. Lives in the header and offers four fully
 * distinct looks (see client/src/styles/themes.css). The selection is applied
 * by Home to `.villa-app` and persisted in the DashboardThemeProvider.
 */
export default function ThemeSwitcher() {
  const { theme, setTheme } = useDashboardTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="theme-switcher" ref={ref}>
      <button
        className={`icon-button${open ? " active" : ""}`}
        aria-label="Dashboard-Design wählen"
        aria-haspopup="true"
        aria-expanded={open}
        title="Dashboard-Design wählen"
        onClick={() => setOpen(value => !value)}
      >
        <Palette />
      </button>
      {open && (
        <div className="theme-menu" role="menu" aria-label="Dashboard-Design">
          <span className="theme-menu-title">Design wählen</span>
          {DASHBOARD_THEMES.map(option => (
            <button
              key={option.id}
              role="menuitemradio"
              aria-checked={option.id === theme}
              className={`theme-option${option.id === theme ? " selected" : ""}`}
              onClick={() => {
                setTheme(option.id);
                setOpen(false);
              }}
            >
              <span className="theme-swatch" aria-hidden="true">
                {option.swatch.map((color, index) => (
                  <i key={index} style={{ background: color }} />
                ))}
              </span>
              <span className="theme-option-copy">
                <strong>{option.name}</strong>
                <small>{option.tagline}</small>
              </span>
              {option.id === theme && (
                <Check className="theme-option-check" size={16} />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
