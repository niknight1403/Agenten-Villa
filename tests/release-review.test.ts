import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

/**
 * Release-Review Regression Tests (Sprint 090)
 *
 * Verifies that the RELEASE-REVIEW.md document exists and contains
 * status entries for all 9 roadmap areas.
 */
describe("Release-Review (Sprint 090)", () => {
  const reviewPath = join(process.cwd(), "docs", "RELEASE-REVIEW.md");

  it("docs/RELEASE-REVIEW.md exists", () => {
    expect(existsSync(reviewPath)).toBe(true);
  });

  it("contains status matrix for all 9 roadmap areas", () => {
    const content = readFileSync(reviewPath, "utf-8");
    // Check that all 9 area headings are referenced
    for (const area of [
      "1. Fundament",
      "2. Villa-",
      "3. Autonome",
      "4. Provider",
      "5. Agenten",
      "6. Sicherheit",
      "7. Mobile",
      "8. Daten",
      "9. Qualität",
    ]) {
      expect(content).toContain(area);
    }
  });

  it("marks open points honestly", () => {
    const content = readFileSync(reviewPath, "utf-8");
    // Bereich 8 should have open points marked
    expect(content).toContain("offen");
    expect(content).toContain("Teilweise offen");
  });

  it("references SPRINT-STATUS.md", () => {
    const content = readFileSync(reviewPath, "utf-8");
    expect(content).toContain("SPRINT-STATUS.md");
  });

  it("contains security checklist", () => {
    const content = readFileSync(reviewPath, "utf-8");
    expect(content).toContain("Sicherheits-Checkliste");
    expect(content).toContain("Limit-Bypass");
    expect(content).toContain("Admin-Allowlist");
  });

  it("contains test overview with counts", () => {
    const content = readFileSync(reviewPath, "utf-8");
    expect(content).toContain("Test-Übersicht");
    expect(content).toContain("Grün");
  });
});
