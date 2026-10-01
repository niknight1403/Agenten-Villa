import { afterEach, describe, expect, it } from "vitest";
import {
  TELEMETRY_SAMPLE_LIMIT,
  recordRouterTelemetry,
  resetRouterTelemetryForTests,
  routerTelemetrySummary,
} from "./router-telemetry";

afterEach(() => {
  resetRouterTelemetryForTests();
});

describe("Router-Telemetrie (Sprint 038)", () => {
  it("aggregiert Latenz, Erfolg und Versuche über alle Turns", () => {
    recordRouterTelemetry({
      success: true,
      provider: "groq",
      model: "a",
      attempts: 1,
      latencyMs: 100,
    });
    recordRouterTelemetry({
      success: true,
      provider: "groq",
      model: "b",
      attempts: 2,
      latencyMs: 300,
      fallbackFrom: "openrouter",
      fallbackReason: "LIMIT",
    });
    recordRouterTelemetry({
      success: false,
      provider: "gemini",
      model: "c",
      attempts: 3,
      latencyMs: 200,
      errorCode: "LIMIT",
    });
    const summary = routerTelemetrySummary();
    expect(summary).toMatchObject({
      turns: 3,
      successes: 2,
      failures: 1,
      successRate: 2 / 3,
    });
    expect(summary.averageLatencyMs).toBe(200);
    expect(summary.averageAttempts).toBe(2);
    expect(summary.fallbacks).toBe(1);
    expect(summary.fallbackReasons).toEqual([{ reason: "LIMIT", count: 1 }]);
  });

  it("gruppiert nach Anbieter mit sortierter, deterministischer Ausgabe", () => {
    recordRouterTelemetry({
      success: true,
      provider: "groq",
      model: "a",
      attempts: 1,
      latencyMs: 100,
    });
    recordRouterTelemetry({
      success: true,
      provider: "openrouter",
      model: "b",
      attempts: 1,
      latencyMs: 200,
    });
    recordRouterTelemetry({
      success: false,
      provider: "groq",
      model: "a",
      attempts: 1,
      latencyMs: 100,
      errorCode: "UNAVAILABLE",
    });
    const summary = routerTelemetrySummary();
    expect(summary.byProvider.map(p => p.provider)).toEqual([
      "groq",
      "openrouter",
    ]);
    expect(summary.byProvider[0]).toMatchObject({
      turns: 2,
      successes: 1,
      averageLatencyMs: 100,
    });
  });

  it("liefert für leere Samples unschädliche Nullwerte", () => {
    expect(routerTelemetrySummary()).toMatchObject({
      turns: 0,
      successRate: 0,
      averageLatencyMs: 0,
      byProvider: [],
      fallbackReasons: [],
    });
  });

  it("begrenzt den Speicher auf die letzten Samples", () => {
    for (let i = 0; i < TELEMETRY_SAMPLE_LIMIT + 50; i += 1)
      recordRouterTelemetry({
        success: true,
        provider: "groq",
        model: `m-${i}`,
        attempts: 1,
        latencyMs: 1,
      });
    expect(routerTelemetrySummary().turns).toBe(TELEMETRY_SAMPLE_LIMIT);
  });
});
