/**
 * Sprint 094 — Theme-System stabilisieren: alle vier Themes teilen dieselben
 * Kern-Design-Tokens (--vf-*). Diese Tests pinnen die Konsistenz:
 *
 *  - Jedes Theme definiert DEN vollstaendigen Kern-Token-Satz (kein Theme
 *    darf still einen Token vergessen — sonst fehlen Farben ganze Flachen).
 *  - Alle in themes.css verwendeten var(--vf-*)-Referenzen sind definiert.
 *  - Die Kernflaechen ziehen ihre Farben wirklich aus Tokens (kein Rutsch
 *    zurueck in hartkodierte Hex-Werte in den Kern-Regeln).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const cssPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../styles/themes.css"
);
const css = readFileSync(cssPath, "utf8");

const THEMES = ["midnight", "paper", "terminal", "sunset"] as const;

/** Kern-Token-Satz, den jedes Theme vollstaendig definieren muss. */
export const CORE_TOKENS = [
  "header-bg",
  "header-border",
  "btn-bg",
  "btn-border",
  "btn-text",
  "btn-hover-bg",
  "btn-hover-border",
  "btn-hover-text",
  "chip-bg",
  "chip-border",
  "chip-text",
  "bubble-bg",
  "bubble-border",
  "bubble-user-bg",
  "bubble-user-border",
  "send-bg",
  "send-text",
  "author-text",
  "row-bg",
  "row-border",
  "row-text",
  "row-hover-bg",
  "row-hover-border",
  "drawer-bg",
  "drawer-border",
  "tabbar-bg",
  "tabbar-border",
  "modal-bg",
  "modal-border",
] as const;

/** Extrahiert die Token-Definitionen je Theme aus dem Token-Layer. */
export function themeTokens(theme: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  const blockRe = new RegExp(`\\.theme-${theme}\\s*\\{([^}]*)\\}`, "g");
  for (const [, block] of css.matchAll(blockRe)) {
    for (const [, name, value] of block.matchAll(/--vf-([\w-]+):\s*([^;]+);/g)) {
      tokens[name] = value.trim();
    }
  }
  return tokens;
}

describe("Theme-Design-Tokens (Sprint 094)", () => {
  it("jedes Theme definiert den vollstaendigen Kern-Token-Satz", () => {
    for (const theme of THEMES) {
      const tokens = themeTokens(theme);
      for (const token of CORE_TOKENS) {
        expect(tokens, `${theme}.${token}`).toHaveProperty(token);
        expect(tokens[token].length, `${theme}.${token}`).toBeGreaterThan(0);
      }
    }
  });

  it("alle verwendeten var(--vf-*)-Referenzen sind definiert", () => {
    const defined = new Set<string>();
    for (const theme of THEMES) {
      for (const name of Object.keys(themeTokens(theme))) {
        defined.add(name);
      }
    }
    const used = new Set<string>();
    for (const [, name] of css.matchAll(/var\(--vf-([\w-]+)\)/g)) {
      used.add(name);
    }
    expect(used.size).toBeGreaterThan(20);
    for (const name of used) {
      expect(defined, `var(--vf-${name})`).toContain(name);
    }
  });

  it("Kernflaechen nutzen Tokens statt hartkodierter Farben", () => {
    const coreChecks: Array<[theme: string, needle: string, token: string]> = [
      ["midnight", ".theme-midnight .app-header {", "--vf-header-bg"],
      ["paper", ".theme-paper .send-button {", "--vf-send-bg"],
      ["terminal", ".theme-terminal .message-bubble {", "--vf-bubble-bg"],
      ["sunset", ".theme-sunset .villa-row {", "--vf-row-bg"],
    ];
    for (const [, needle, token] of coreChecks) {
      const line = css.split("\n").find((l) => l.startsWith(needle));
      expect(line, needle).toBeDefined();
      expect(line, needle).toContain(`var(${token})`);
    }
  });

  it("Token-Werte unterscheiden sich je Theme (kein Copy-Paste-Theme)", () => {
    for (const token of CORE_TOKENS) {
      const values = new Set(THEMES.map((t) => themeTokens(t)[token]));
      // Mindestens zwei unterschiedliche Werte je Token ueber alle Themes.
      expect(values.size, `--vf-${token}`).toBeGreaterThan(1);
    }
  });
});
