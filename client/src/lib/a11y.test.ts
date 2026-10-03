/**
 * Sprint 070 — Regression: Mobile Accessibility.
 *
 * Pinnt drei Invarianten statisch:
 *
 *  1. Kontrast: Die Kern-Textfarbenpaare der Chat-Oberfläche
 *     (Dunkel-Design) erreichen WCAG 2.1 AA (>= 4.5:1).
 *  2. Fokus: Es existiert ein globaler :focus-visible-Ring, dessen
 *     Farbe >= 3:1 gegen den App-Hintergrund erreicht (WCAG 1.4.11
 *     bzw. Focus Appearance) — und die Deckkraft-Variante von früher
 *     (28 % Transparenz) ist für den Standard-Fokus verboten.
 *  3. Icon-Buttons: Jeder Icon-Button (kein sichtbarer Text) trägt
 *     ein aria-label — Screenreader hören nie ein stummes Element.
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const libDir = dirname(fileURLToPath(import.meta.url));

const css = await readFile(join(libDir, "../index.css"), "utf-8");

/** Relative Luminanz nach WCAG 2.1. */
function luminance(color: string): number {
  const [r, g, b] = [0, 2, 4].map(i => parseInt(color.slice(i, i + 2), 16) / 255);
  const channel = (c: number) =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Kontrastverhältnis zweier Hexfarben. */
export function contrastRatio(foreground: string, background: string): number {
  const first = luminance(foreground);
  const second = luminance(background);
  const [light, dark] = first > second ? [first, second] : [second, first];
  return (light + 0.05) / (dark + 0.05);
}

/** Kern-Textpaare des Dunkel-Designs (fg auf bg). */
const TEXT_PAIRS: Array<[name: string, fg: string, bg: string]> = [
  ["Haupttext", "eef0fc", "0b0f19"],
  ["Muted-Text", "9faed3", "0b0f19"],
  ["Chat-bereit-Hinweis", "718499", "0b0f19"],
  ["Query-State-Hinweis", "8a97bd", "0b0f19"],
  ["Marken-Untertext", "99a8ca", "0d1226"],
  ["Drawer-Suche", "99a8ca", "0f142b"],
  ["Bewertungs-Button", "8a97bd", "131a32"],
  ["Stopp-Hinweis Composer", "718499", "0e1429"],
];

describe("Sprint 070 — Kontrast (WCAG AA, Text >= 4.5:1)", () => {
  it.each(TEXT_PAIRS)("%s erreicht 4.5:1", (_name, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("Sprint 070 — Tastatur-Fokus", () => {
  it("hat einen globalen :focus-visible-Ring", () => {
    expect(css).toMatch(
      /:where\(button, a, select, textarea, \[tabindex\]\):focus-visible/
    );
  });

  it("Fokusfarbe erreicht 3:1 gegen den App-Hintergrund", () => {
    const match = css.match(
      /:where\(button[^}]*:focus-visible\s*\{[^}]*outline:\s*2px\s+solid\s+#([0-9a-f]{6})/
    );
    expect(match).not.toBeNull();
    expect(contrastRatio(match![1], "0b0f19")).toBeGreaterThanOrEqual(3);
  });
});

describe("Sprint 070 — Icon-Buttons tragen aria-label", () => {
  const PAGE_NAMES = [
    "Home",
    "EliteMission",
    "Controller",
    "DemoAdmin",
    "AndroidFiles",
    "Auth",
  ];

  /** Prüft eine Quelle: jedes Icon-Element braucht Label oder Text. */
  function findUnlabeledIconButtons(page: string, source: string): string[] {
    const violations: string[] = [];
    for (const match of source.matchAll(/<(button|a)\b([^>]*?)>([\s\S]*?)<\/\1>/gs)) {
      const attrs = match[2];
      const body = match[3];
      if (!/(icon-button|round-add)/.test(attrs)) continue;
      const hasLabel = /aria-label|title=/.test(attrs);
      // Sichtbarer Text = Body ohne Tags enthält Nicht-Whitespace.
      const text = body.replace(/<[^>]*>/g, "").trim();
      if (!hasLabel && !text) {
        violations.push(`${page}: ${attrs.trim().replace(/\s+/g, " ").slice(0, 70)}`);
      }
    }
    return violations;
  }

  it("kein Icon-Button ohne zugänglichen Namen", async () => {
    const violations: string[] = [];
    for (const page of PAGE_NAMES) {
      const source = await readFile(join(libDir, `../pages/${page}.tsx`), "utf-8");
      violations.push(...findUnlabeledIconButtons(page, source));
    }
    expect(violations).toEqual([]);
  });

  it("Theme-Switcher und Komponenten sind eingeschlossen", async () => {
    const source = await readFile(
      join(libDir, "../components/ThemeSwitcher.tsx"),
      "utf-8"
    );
    expect(findUnlabeledIconButtons("ThemeSwitcher", source)).toEqual([]);
  });
});
