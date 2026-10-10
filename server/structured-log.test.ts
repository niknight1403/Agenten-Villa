import { describe, expect, it, vi, afterEach } from "vitest";
import {
  LOG_FIELD_MAX_CHARS,
  newCorrelationId,
  startCorrelation,
  structuredLog,
} from "./structured-log";

afterEach(() => {
  vi.restoreAllMocks();
});

/** Test-Logger: fängt Zeilen auf, statt sie nach stdout zu schreiben. */
function capture() {
  const lines: { log: unknown[][]; warn: unknown[][]; error: unknown[][] } = {
    log: [],
    warn: [],
    error: [],
  };
  const logger = {
    log: (...a: unknown[]) => void lines.log.push(a),
    warn: (...a: unknown[]) => void lines.warn.push(a),
    error: (...a: unknown[]) => void lines.error.push(a),
  };
  return { logger, lines };
}

function parse(call: unknown[]) {
  return JSON.parse(String(call[0])) as Record<string, unknown>;
}

describe("structuredLog (Sprint 078)", () => {
  it("schreibt genau eine JSON-Zeile mit ts, level und event", () => {
    const { logger, lines } = capture();
    structuredLog("info", "watchdog_tick", { status: "RUNNING", durationMs: 12 }, logger);
    expect(lines.log).toHaveLength(1);
    const line = parse(lines.log[0]);
    expect(line.event).toBe("watchdog_tick");
    expect(line.level).toBe("info");
    expect(line.status).toBe("RUNNING");
    expect(line.durationMs).toBe(12);
    expect(typeof line.ts).toBe("string");
    expect(Number.isNaN(Date.parse(String(line.ts)))).toBe(false);
  });

  it("route level: warn geht an warn, error an error", () => {
    const { logger, lines } = capture();
    structuredLog("warn", "a", {}, logger);
    structuredLog("error", "b", {}, logger);
    expect(lines.log).toHaveLength(0);
    expect(parse(lines.warn[0]).event).toBe("a");
    expect(parse(lines.error[0]).event).toBe("b");
  });

  it("verwirft geheimnisverdaechtige Felder vollständig", () => {
    const { logger, lines } = capture();
    structuredLog(
      "info",
      "provider_call",
      { provider: "openrouter", api_key: "ghp_supergeheim", apiKey: "x", token: "y", password: "z" },
      logger
    );
    const line = parse(lines.log[0]);
    expect(line.provider).toBe("openrouter");
    expect(JSON.stringify(line)).not.toContain("supergeheim");
    expect("api_key" in line).toBe(false);
    expect("apiKey" in line).toBe(false);
    expect("token" in line).toBe(false);
    expect("password" in line).toBe(false);
  });

  it("kuerzt ueberlange Werte — keine Prompts in Logs", () => {
    const { logger, lines } = capture();
    const longPrompt = "p".repeat(LOG_FIELD_MAX_CHARS + 400);
    structuredLog("info", "turn_rejected", { reason: longPrompt }, logger);
    const line = parse(lines.log[0]);
    const value = String(line.reason);
    expect(value.length).toBeLessThanOrEqual(LOG_FIELD_MAX_CHARS + 40);
    expect(value).toContain("gekürzt");
  });

  it("behält Zahlen, Booleans und null unverändert", () => {
    const { logger, lines } = capture();
    structuredLog("info", "mix", { n: 7, b: false, nothing: null, nested: { ok: true } }, logger);
    const line = parse(lines.log[0]);
    expect(line.n).toBe(7);
    expect(line.b).toBe(false);
    expect(line.nothing).toBeNull();
    expect((line.nested as Record<string, unknown>).ok).toBe(true);
  });
});

describe("startCorrelation (Sprint 078)", () => {
  it("liefert verstreiche Millisekunden und eine frische ID", async () => {
    const { correlationId, elapsedMs } = startCorrelation();
    expect(correlationId).toMatch(/^[0-9a-f]{12}$/);
    const first = elapsedMs();
    expect(first).toBeGreaterThanOrEqual(0);
    await new Promise((r) => setTimeout(r, 15));
    expect(elapsedMs()).toBeGreaterThan(first);
  });
});
