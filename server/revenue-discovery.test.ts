import { describe, it, expect } from "vitest";
import {
  validSignal,
  summarizeSignals,
  hypothesisScore,
  deriveHypotheses,
  nextHypothesisStatus,
  HYPOTHESIS_SCORE_THRESHOLD,
  discoveryPeriod,
} from "./revenue-discovery";

describe("Revenue-Discovery (Abschnitt 4.1)", () => {
  it("validiert Signale strikt", () => {
    expect(validSignal({ source: "affiliate", key: "klicks", value: 10, period: "2026-10" })).toBe(true);
    expect(validSignal({ source: "paid_api", key: "x", value: 1, period: "2026-10" })).toBe(false);
    expect(validSignal({ source: "billing", key: "tokens", value: -1, period: "2026-10" })).toBe(false);
    expect(validSignal({ source: "billing", key: "tokens", value: 1.5, period: "2026-10" })).toBe(false);
    expect(validSignal({ source: "billing", key: "tokens", value: 1, period: "10-2026" })).toBe(false);
  });

  it("summarizeSignals aggregiert nach Quelle:Key", () => {
    const summary = summarizeSignals([
      { id: 1, source: "affiliate", key: "klicks", value: 5, period: "2026-10", createdAt: new Date() },
      { id: 2, source: "affiliate", key: "klicks", value: 7, period: "2026-10", createdAt: new Date() },
      { id: 3, source: "billing", key: "tokens", value: 100, period: "2026-10", createdAt: new Date() },
    ]);
    expect(summary["affiliate:klicks"]).toBe(12);
    expect(summary["billing:tokens"]).toBe(100);
  });

  it("hypothesisScore belohnt Markt/Automatisierung, bestraft Kosten/Risiko", () => {
    const gut = hypothesisScore({ market: 90, automatability: 90, cost: 10, risk: 10 });
    const schlecht = hypothesisScore({ market: 20, automatability: 20, cost: 80, risk: 80 });
    expect(gut).toBeGreaterThan(schlecht);
    expect(hypothesisScore({ market: 200, automatability: 200, cost: -50, risk: -50 })).toBe(100);
    expect(hypothesisScore({ market: -10, automatability: 0, cost: 100, risk: 100 })).toBe(0);
  });

  it("deriveHypotheses: Affiliate-Content-Pipe ab 50 Klicks", () => {
    const drafts = deriveHypotheses({ "affiliate:klicks": 60 });
    expect(drafts.some((d) => d.kind === "content_pipe")).toBe(true);
    expect(deriveHypotheses({ "affiliate:klicks": 10 })).toHaveLength(0);
  });

  it("deriveHypotheses: Micro-SaaS ab Token-Nachfrage", () => {
    const drafts = deriveHypotheses({ "billing:tokens": 150_000 });
    expect(drafts.some((d) => d.kind === "micro_saas")).toBe(true);
    expect(deriveHypotheses({ "billing:tokens": 1000 })).toHaveLength(0);
  });

  it("deriveHypotheses: Trading NUR mit bestandenem Sim-Gate und >=500 Trades", () => {
    const summary = { "trading:sim_trades": 600 };
    expect(deriveHypotheses(summary, { tradingSimGatePassed: true }).some((d) => d.kind === "automated_trading")).toBe(true);
    expect(deriveHypotheses(summary, { tradingSimGatePassed: false })).toHaveLength(0);
    expect(deriveHypotheses({ "trading:sim_trades": 100 }, { tradingSimGatePassed: true })).toHaveLength(0);
  });

  it("Score-Schwelle respektieren", () => {
    const drafts = deriveHypotheses({ "affiliate:klicks": 1000 }, { scoreThreshold: 101 });
    expect(drafts).toHaveLength(0);
    expect(HYPOTHESIS_SCORE_THRESHOLD).toBe(40);
  });

  it("Hypothesen-Statusmaschine: Umsetzung NUR nach Admin-Freigabe", () => {
    expect(nextHypothesisStatus("draft", "approve")).toBe("approved");
    expect(nextHypothesisStatus("draft", "reject")).toBe("rejected");
    expect(nextHypothesisStatus("approved", "deploy")).toBe("deployed");
    expect(nextHypothesisStatus("deployed", "scale")).toBe("scaled");
    expect(nextHypothesisStatus("approved", "park")).toBe("parked");
    expect(() => nextHypothesisStatus("draft", "deploy")).toThrow();
    expect(() => nextHypothesisStatus("rejected", "approve")).toThrow();
    expect(() => nextHypothesisStatus("scaled", "scale")).toThrow();
  });

  it("discoveryPeriod bildet 'YYYY-MM' ab", () => {
    expect(discoveryPeriod(new Date("2026-10-10T10:00:00Z"))).toBe("2026-10");
  });
});
