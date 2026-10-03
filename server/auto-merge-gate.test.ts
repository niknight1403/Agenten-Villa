import { describe, expect, it } from "vitest";
import {
  checkCouldTrigger,
  evaluateMergeGate,
  isProtectedPath,
  PATH_FILTERED_CHECKS,
  REQUIRED_CHECKS,
  type MergeGateInput,
} from "./auto-merge-gate";

function baseInput(overrides: Partial<MergeGateInput> = {}): MergeGateInput {
  return {
    branch: "agent/sprint-100-beispiel",
    state: "OPEN",
    isDraft: false,
    base: "main",
    changedFiles: ["server/x.ts", "client/src/lib/y.ts"],
    checks: REQUIRED_CHECKS.map(name => ({
      name,
      conclusion: "SUCCESS",
    })),
    ...overrides,
  };
}

describe("Pfadgefilterte Pflichtchecks (Sprint 081)", () => {
  it("fasst einen fehlenden Android-Smoke bei Server-only-PR als erfuellt auf", () => {
    const decision = evaluateMergeGate(
      baseInput({
        changedFiles: ["server/route-wait.ts", "docs/SPRINT-STATUS.md"],
        checks: [
          { name: "CI", conclusion: "SUCCESS" },
          { name: "PR Agent (Gemini)", conclusion: "SUCCESS" },
        ],
      })
    );
    expect(decision.merge).toBe(true);
    expect(decision.reason).toContain("Pflichtchecks gruen");
  });

  it("blockiert weiter, wenn der Pfadfilter den Check haette triggern muessen", () => {
    const decision = evaluateMergeGate(
      baseInput({
        changedFiles: ["server/x.ts", "client/src/lib/y.ts"],
        checks: [
          { name: "CI", conclusion: "SUCCESS" },
          { name: "PR Agent (Gemini)", conclusion: "SUCCESS" },
        ],
      })
    );
    expect(decision.merge).toBe(false);
    expect(decision.reason).toContain("Android mobile smoke fehlt noch");
  });

  it("bewertet die Trigger-Pfade exakt: Datei-Filter und Verzeichnis-Prefix", () => {
    expect(checkCouldTrigger("Android mobile smoke", ["package.json"])).toBe(true);
    expect(
      checkCouldTrigger("Android mobile smoke", ["client/irgendwas.tsx"])
    ).toBe(true);
    expect(
      checkCouldTrigger("Android mobile smoke", ["server/nichts-mobil.ts"])
    ).toBe(false);
    expect(
      checkCouldTrigger("Android mobile smoke", ["android/egal.kt"])
    ).toBe(true);
    expect(checkCouldTrigger("Android mobile smoke", ["android.d.ts"])).toBe(false);
  });

  it("haelt Checks ohne bekannten Pfadfilter bedingungslos Pflicht", () => {
    expect(checkCouldTrigger("CI", ["server/nur-server.ts"])).toBe(true);
    expect(PATH_FILTERED_CHECKS["Android mobile smoke"]).toContain("client/");
  });
});

describe("Auto-Merge-Gate (Sprint 078)", () => {
  it("merged einen offenen agent/*-PR auf main mit allen Pflichtchecks gruen", () => {
    const decision = evaluateMergeGate(baseInput());
    expect(decision).toEqual({
      merge: true,
      reason: "Offener agent/*-PR auf main mit allen Pflichtchecks gruen",
    });
  });

  it("akzeptiert Check-Ergebnisse unabhaengig von Gross-/Kleinschreibung", () => {
    const decision = evaluateMergeGate(
      baseInput({
        checks: [
          { name: "CI", conclusion: "success" },
          { name: "PR Agent (Gemini)", conclusion: "Success" },
          { name: "Android mobile smoke", conclusion: "SUCCESS" },
        ],
      })
    );
    expect(decision.merge).toBe(true);
  });

  it("blockiert Drafts, geschlossene PRs und andere Ziel-Branches", () => {
    expect(evaluateMergeGate(baseInput({ isDraft: true })).merge).toBe(false);
    expect(
      evaluateMergeGate(baseInput({ state: "MERGED" })).merge
    ).toBe(false);
    expect(
      evaluateMergeGate(baseInput({ base: "release" })).merge
    ).toBe(false);
  });

  it("blockiert Branches ausserhalb von agent/*", () => {
    const decision = evaluateMergeGate(
      baseInput({ branch: "feature/wichtige-aenderung" })
    );
    expect(decision.merge).toBe(false);
    expect(decision.reason).toContain("kein agent/*-Branch");
  });

  it("blockiert PRs mit geschuetzten Pfaden (Admin-Disziplin bleibt)", () => {
    for (const file of [
      ".github/workflows/ci.yml",
      "docs/BRANCH-PROTECTION.md",
      "server/auto-merge-gate.ts",
    ]) {
      const decision = evaluateMergeGate(
        baseInput({ changedFiles: ["server/x.ts", file] })
      );
      expect(decision.merge).toBe(false);
      expect(decision.reason).toContain(file);
    }
  });

  it("blockiert noch laufende Checks — der naechste Trigger entscheidet neu", () => {
    const decision = evaluateMergeGate(
      baseInput({
        checks: [
          { name: "CI", conclusion: "SUCCESS" },
          { name: "PR Agent (Gemini)", conclusion: null },
          { name: "Android mobile smoke", conclusion: "SUCCESS" },
        ],
      })
    );
    expect(decision.merge).toBe(false);
    expect(decision.reason).toContain("laufen noch");
  });

  it("blockiert gescheiterte Checks mit klarer Begruendung", () => {
    const decision = evaluateMergeGate(
      baseInput({
        checks: [
          { name: "CI", conclusion: "SUCCESS" },
          { name: "PR Agent (Gemini)", conclusion: "FAILURE" },
          { name: "Android mobile smoke", conclusion: "SUCCESS" },
        ],
      })
    );
    expect(decision.merge).toBe(false);
    expect(decision.reason).toContain("PR Agent (Gemini)");
  });

  it("blockiert fehlende Pflichtchecks", () => {
    const decision = evaluateMergeGate(
      baseInput({
        checks: [{ name: "CI", conclusion: "SUCCESS" }],
      })
    );
    expect(decision.merge).toBe(false);
    expect(decision.reason).toContain("PR Agent (Gemini)");
    expect(decision.reason).toContain("fehlt noch");
  });

  it("laesst abgeschlossene, nicht blockierende Checks zu (skipped/neutral)", () => {
    const decision = evaluateMergeGate(
      baseInput({
        checks: [
          { name: "CI", conclusion: "SUCCESS" },
          { name: "PR Agent (Gemini)", conclusion: "SUCCESS" },
          { name: "Android mobile smoke", conclusion: "SUCCESS" },
          { name: "Vercel Preview", conclusion: "SKIPPED" },
        ],
      })
    );
    expect(decision.merge).toBe(true);
  });

  it("kennt die geschuetzten Pfade als reine Funktion", () => {
    expect(isProtectedPath(".github/scripts/auto-merge.sh")).toBe(true);
    expect(isProtectedPath("server/provider-registry.ts")).toBe(false);
    expect(isProtectedPath("docs/SPRINT-STATUS.md")).toBe(false);
  });
});
