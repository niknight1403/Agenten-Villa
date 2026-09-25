import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AgentError,
  LIMITS,
  isFallbackEligible,
  isRetryableStatus,
  safeAgentError,
  validAgentInput,
  validRating,
  type AgentInput,
} from "./agent-engine";
import { DEFAULT_VILLA_ID, getVillaSystemContext } from "./agent-villa";

const baseInput: AgentInput = {
  prompt: "Analysiere das Projekt",
  mode: "home",
  history: [],
};

describe("agent input validation", () => {
  it("accepts a well-formed home request without history", () => {
    expect(validAgentInput(baseInput)).toBe(true);
  });

  it("accepts workshop mode and assistant/user history entries", () => {
    expect(
      validAgentInput({
        prompt: " Lies server/db.ts ",
        mode: "workshop",
        history: [
          { role: "user", content: "Hallo" },
          { role: "assistant", content: "Willkommen" },
        ],
      })
    ).toBe(true);
  });

  it("rejects empty and over-limit prompts", () => {
    expect(validAgentInput({ ...baseInput, prompt: "   " })).toBe(false);
    expect(
      validAgentInput({ ...baseInput, prompt: "x".repeat(LIMITS.promptChars + 1) })
    ).toBe(false);
  });

  it("rejects unknown modes, broken history shapes, and too much history", () => {
    expect(validAgentInput({ ...baseInput, mode: "admin" as AgentInput["mode"] })).toBe(false);
    expect(
      validAgentInput({ ...baseInput, history: [{ role: "system" as never, content: "x" }] })
    ).toBe(false);
    expect(
      validAgentInput({
        ...baseInput,
        history: Array.from({ length: 21 }, () => ({ role: "user" as const, content: "x" })),
      })
    ).toBe(false);
  });
});

describe("safe error handling", () => {
  it("exposes only deliberate AgentError messages", () => {
    expect(safeAgentError(new AgentError("custom", "Sichtbarer Hinweis"))).toBe(
      "Sichtbarer Hinweis"
    );
    expect(safeAgentError(new Error("internal stack details"))).toBe(
      "Der Agent konnte die Anfrage gerade nicht abschließen."
    );
    expect(safeAgentError(undefined)).toBe(
      "Der Agent konnte die Anfrage gerade nicht abschließen."
    );
  });
});

describe("rating and status helpers", () => {
  it("only accepts the two explicit rating values", () => {
    expect(validRating(-1)).toBe(true);
    expect(validRating(1)).toBe(true);
    expect(validRating(0)).toBe(false);
    expect(validRating(2)).toBe(false);
  });

  it("treats 408/500/503 as retryable and success/4xx client errors as final", () => {
    for (const status of [408, 500, 502, 503, 504]) {
      expect(isRetryableStatus(status)).toBe(true);
    }
    for (const status of [200, 400, 401, 402, 403, 404, 422]) {
      expect(isRetryableStatus(status)).toBe(false);
    }
  });

  it("never allows a fallback after an exhausted quota (429/402) or without opt-in", () => {
    expect(isFallbackEligible(429, true)).toBe(false);
    expect(isFallbackEligible(402, true)).toBe(false);
    expect(isFallbackEligible(503, false)).toBe(false);
    expect(isFallbackEligible(503, true)).toBe(true);
  });
});

describe("villa system context", () => {
  it("describes capacity, lazy provisioning, and all pack ids", () => {
    const context = getVillaSystemContext(DEFAULT_VILLA_ID);
    expect(context).toContain("villa-main");
    expect(context).toContain("5000");
    expect(context).toContain("bei Bedarf gestartet");
    expect(context).toContain("audit-trail");
    expect(context).not.toContain("Umgehung");
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
