/**
 * Sprint 068 — Regression: Touch-Zielgrößen (Roadmap 067).
 *
 * Pinnt die mobile Mindestgröße interaktiver Ziele als CSS-Invariante:
 * Jedes interaktive Element erreicht eine effektive Trefferfläche von
 * mindestens 44x44px — entweder direkt über width/height/min-height oder
 * über die unsichtbare ::after-Hit-Area-Expansion.
 *
 * Das ist eine statische Prüfung der Stylesheet-Quelle: Sie verhindert,
 * dass spätere CSS-Änderungen die Touch-Ziele unbemerkt wieder schrumpfen
 * lassen (Sprint 061 hatte nur eine manuelle Prüfung).
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = await readFile(
  join(dirname(fileURLToPath(import.meta.url)), "../index.css"),
  "utf-8"
);

function escapeSelector(selector: string): string {
  return selector.replace(/[{}()[\].+*?^$|\\]/g, "\\$&");
}

/** Liefert den ersten CSS-Block für einen Selektor. */
function rule(selector: string): string {
  const match = css.match(new RegExp(`${escapeSelector(selector)}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`CSS-Regel fehlt: ${selector}`);
  return match[1];
}

/** Erste Zahl hinter einer Eigenschaft im Block. */
function size(block: string, property: string): number {
  const match = block.match(new RegExp(`${property}\\s*:\\s*([0-9.]+)px`));
  if (!match) throw new Error(`Eigenschaft fehlt: ${property}`);
  return Number(match[1]);
}

/** Hit-Area-Expansion (inset) des ::after-Pseudoelements, 0 wenn fehlt. */
function hitExpansion(selector: string): number {
  const match = css.match(
    new RegExp(`${escapeSelector(selector)}::after\\s*\\{[^}]*inset\\s*:\\s*(-[0-9.]+)px`)
  );
  return match ? Math.abs(Number(match[1])) : 0;
}

/** Effektive Trefferfläche: visuelle Größe + 2x Expansion je Seite. */
function effectiveHit(visual: number, expansion: number): number {
  return visual + 2 * expansion;
}

describe("Sprint 068 — Touch-Zielgrößen (statische CSS-Invariante)", () => {
  it("Icon-Buttons erreichen 44x44 effektive Trefferfläche", () => {
    const block = rule(".icon-button");
    const visual = size(block, "width");
    expect(visual).toBeGreaterThanOrEqual(40);
    expect(effectiveHit(visual, hitExpansion(".icon-button"))).toBeGreaterThanOrEqual(44);
    expect(size(block, "height")).toBe(size(block, "width"));
  });

  it("Bewertungs-Buttons erreichen 44x44 effektive Trefferfläche", () => {
    const block = rule(".message-rating button");
    const visual = size(block, "width");
    expect(visual).toBeGreaterThanOrEqual(32);
    expect(effectiveHit(visual, hitExpansion(".message-rating button"))).toBeGreaterThanOrEqual(44);
  });

  it("Bewertungs-Lücke überlappt die Hit-Area-Expansion nicht", () => {
    const gap = size(rule(".message-rating"), "gap");
    expect(gap).toBeGreaterThanOrEqual(2 * hitExpansion(".message-rating button"));
  });

  it("Header-Lücke überlappt die Icon-Hit-Areas nicht", () => {
    const gap = size(rule(".header-tools"), "gap");
    expect(gap).toBeGreaterThanOrEqual(2 * hitExpansion(".icon-button"));
  });

  it("Chat-einklappen-Button ist 44x44", () => {
    const block = rule(".chat-ready button");
    expect(size(block, "width")).toBe(44);
    expect(size(block, "height")).toBe(44);
  });

  it("Runde Hinzufügen-Taste ist mindestens 44x44", () => {
    const block = rule(".round-add");
    expect(size(block, "width")).toBeGreaterThanOrEqual(44);
    expect(size(block, "height")).toBeGreaterThanOrEqual(44);
  });

  it("Erneut-senden-Button (Sprint 067) bleibt mindestens 44px hoch", () => {
    expect(size(rule(".message-retry"), "min-height")).toBeGreaterThanOrEqual(44);
  });

  it("Mobile Tabbar-Buttons bleiben mindestens 44px breit", () => {
    expect(size(rule(".mobile-tabbar button"), "width")).toBeGreaterThanOrEqual(44);
  });
});
