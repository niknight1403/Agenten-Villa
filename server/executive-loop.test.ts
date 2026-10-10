import { describe, it, expect } from "vitest";
import {
  nextPhase,
  runAnalyze,
  runHypothesize,
  runSimulate,
  runDeploy,
  runVerifyRevenue,
  runRefactorScale,
  runPhase,
  executiveLoopIntervalMs,
  LOOP_ORDER,
} from "./executive-loop";

const baseCtx = {
  signalSummary: { "affiliate:klicks": 10 },
  tradingSimGatePassed: false,
  draftHypotheses: 0,
  actualMonthlyCents: 0,
  expectedMonthlyCents: 0,
};

describe("Executive Master-Loop (Abschnitt 4.2)", () => {
  it("Zirkel-Reihenfolge ist geschlossen und wiederholt sich", () => {
    expect(LOOP_ORDER[0]).toBe("analyze");
    expect(nextPhase("analyze")).toBe("hypothesize");
    expect(nextPhase("simulate")).toBe("deploy");
    expect(nextPhase("refactor_scale")).toBe("analyze");
    expect(() => nextPhase("unbekannt" as never)).toThrow();
  });

  it("analyze: blocked ohne Signale, ok mit Signalen", () => {
    expect(runAnalyze({ ...baseCtx, signalSummary: {} }).outcome).toBe("blocked");
    const ok = runAnalyze(baseCtx);
    expect(ok.outcome).toBe("ok");
    expect(ok.next).toBe("hypothesize");
  });

  it("hypothesize: offene Drafts = needs_admin, sonst weiter", () => {
    const admin = runHypothesize({ ...baseCtx, draftHypotheses: 3 });
    expect(admin.outcome).toBe("needs_admin");
    expect(admin.next).toBe("hypothesize");
    expect(runHypothesize(baseCtx).next).toBe("simulate");
  });

  it("simulate: Trading ohne bestandenes Gate bleibt blocked", () => {
    const blocked = runSimulate(baseCtx);
    expect(blocked.outcome).toBe("blocked");
    expect(blocked.next).toBe("simulate");
    const ready = runSimulate({ ...baseCtx, tradingSimGatePassed: true });
    expect(ready.outcome).toBe("needs_admin");
  });

  it("deploy: NUR mit Admin-Autorisierung, sonst needs_admin", () => {
    expect(runDeploy(false).outcome).toBe("needs_admin");
    const ok = runDeploy(true);
    expect(ok.outcome).toBe("ok");
    expect(ok.next).toBe("verify_revenue");
  });

  it("verify_revenue: Baseline ohne Erwartung, Unter-/Ueber-Erfuellung", () => {
    expect(runVerifyRevenue({ ...baseCtx, expectedMonthlyCents: 0 }).outcome).toBe("ok");
    const unter = runVerifyRevenue({ ...baseCtx, expectedMonthlyCents: 10_000, actualMonthlyCents: 5_000 });
    expect(unter.note).toContain("Refaktor");
    const ueber = runVerifyRevenue({ ...baseCtx, expectedMonthlyCents: 10_000, actualMonthlyCents: 10_000 });
    expect(ueber.note).toContain("erreicht");
  });

  it("refactor_scale: Refaktor geht zurueck zu analyze, Skalierung braucht Admin", () => {
    const refaktor = runRefactorScale({ ...baseCtx, expectedMonthlyCents: 10_000, actualMonthlyCents: 5_000 });
    expect(refaktor.next).toBe("analyze");
    const skala = runRefactorScale({ ...baseCtx, expectedMonthlyCents: 10_000, actualMonthlyCents: 12_000 });
    expect(skala.outcome).toBe("needs_admin");
  });

  it("runPhase dispatcht alle Phasen; deploy ohne Autorisierung bleibt Gate", () => {
    expect(runPhase("analyze", baseCtx).outcome).toBe("ok");
    expect(runPhase("deploy", baseCtx).outcome).toBe("needs_admin");
    expect(runPhase("deploy", baseCtx, true).outcome).toBe("ok");
  });

  it("Tick-Intervall betraegt 15 Minuten (HAARA-Takt)", () => {
    expect(executiveLoopIntervalMs()).toBe(900_000);
  });
});
