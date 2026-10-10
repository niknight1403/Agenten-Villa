/**
 * Sprint 103 — Tests: Loop Engineering & Self-Evolution
 * (Master-Prompt Abschnitt 2.3).
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  EVOLUTION_THRESHOLDS,
  evaluateLoop,
  reviewPromptCandidate,
  applyPromptRefactor,
  rollbackToPreviousVersion,
  createRefactorProposal,
  resetEvolutionForTests,
  type LoopOutcomeSample,
} from "./self-evolution";
import {
  resetPromptVersionsForTests,
  commitPromptVersion,
} from "./prompt-versions";
import { resetAgentMetricsForTests } from "./agent-metrics";

function sample(outcome: "completed" | "partial" | "failed", latencyMs = 10_000): LoopOutcomeSample {
  return { outcome, latencyMs, at: Date.now() };
}

beforeEach(() => {
  resetEvolutionForTests();
  resetPromptVersionsForTests();
  resetAgentMetricsForTests();
});

describe("evaluateLoop — Bewertung der Feedback-Schleife", () => {
  it("meldet ohne Stichproben 'keep'", () => {
    const result = evaluateLoop([]);
    expect(result.successRate).toBeNull();
    expect(result.sampleCount).toBe(0);
    expect(result.recommendation.action).toBe("keep");
  });

  it("bleibt unter der Mindeststichprobe träge (keine Panik-Reaktion)", () => {
    const result = evaluateLoop([sample("failed"), sample("failed"), sample("failed")]);
    expect(result.sampleCount).toBe(3);
    expect(result.recommendation.action).toBe("keep");
  });

  it("empfiehlt Rollback bei kritischer Erfolgsquote", () => {
    const samples = Array.from({ length: 10 }, (_, i) =>
      sample(i < 6 ? "failed" : "completed")
    );
    const result = evaluateLoop(samples);
    expect(result.successRate).toBe(0.4);
    expect(result.recommendation.action).toBe("rollback_prompt");
  });

  it("empfiehlt Prompt-Refactoring unter dem Ziel, aber ueber kritisch", () => {
    const samples = Array.from({ length: 10 }, (_, i) =>
      sample(i < 3 ? "failed" : "completed")
    );
    const result = evaluateLoop(samples);
    expect(result.successRate).toBe(0.7);
    expect(result.recommendation.action).toBe("refactor_prompt");
  });

  it("empfiehlt Prompt-Pruning bei ueberhoehter Latenz", () => {
    const samples = Array.from({ length: 10 }, () => sample("completed", 60_000));
    const result = evaluateLoop(samples);
    expect(result.recommendation.action).toBe("prune_prompt");
  });

  it("haelt bei gruenen Läufen stabil", () => {
    const samples = Array.from({ length: 10 }, () => sample("completed"));
    const result = evaluateLoop(samples);
    expect(result.successRate).toBe(1);
    expect(result.recommendation.action).toBe("keep");
  });

  it("erkennt die dominante Fehlerklasse", () => {
    const samples = [
      sample("completed"), sample("failed"), sample("failed"), sample("partial"),
      sample("completed"), sample("completed"), sample("completed"), sample("completed"),
    ];
    const result = evaluateLoop(samples);
    expect(result.topFailureKind).toBe("failed");
  });
});

describe("Prompt-Refactoring mit A/B-Schutz", () => {
  it("weist leere Kandidaten ab", () => {
    const result = reviewPromptCandidate({ text: "   ", reason: "Test" }, "Aktiv", "refactor");
    expect(result.applied).toBe(false);
    expect(result.reason).toContain("Leerer");
  });

  it("weist Pruning-Kandidaten ab, die nicht kuerzer sind", () => {
    const result = reviewPromptCandidate(
      { text: "a".repeat(100), reason: "Pruning" },
      "a".repeat(50),
      "prune"
    );
    expect(result.applied).toBe(false);
  });

  it("weist uebergrosse Kandidaten ab (Prompt-Budget)", () => {
    const result = reviewPromptCandidate(
      { text: "x".repeat(EVOLUTION_THRESHOLDS.maxPromptChars + 1), reason: "Zu lang" },
      null,
      "refactor"
    );
    expect(result.applied).toBe(false);
    expect(result.reason).toContain("Budget");
  });

  it("wendet ein gueltiges Refactoring als neue Version an", () => {
    const result = applyPromptRefactor({ text: "Neuer Prompt", reason: "Test-Refactor" });
    expect(result.applied).toBe(true);
    expect(result.versionId).toBe(1);
  });

  it("rollt autonom auf die vorherige Version zurueck", () => {
    commitPromptVersion("Version A", "Test");
    applyPromptRefactor({ text: "Version B", reason: "Verschlechterung" });
    const rollback = rollbackToPreviousVersion();
    expect(rollback.applied).toBe(true);
  });

  it("lehnt Rollback ohne Historie ab", () => {
    const rollback = rollbackToPreviousVersion();
    expect(rollback.applied).toBe(false);
    expect(rollback.reason).toContain("Keine vorherige Version");
  });
});

describe("Code-Refactoring — gepruefte Vorschlaege", () => {
  it("erzeugt einen Vorschlag nur bei hartem Fehlerbild", () => {
    const samples = Array.from({ length: 8 }, (_, i) =>
      sample(i < 2 ? "failed" : "completed")
    );
    const evaluation = evaluateLoop(samples);
    const proposal = createRefactorProposal(evaluation);
    expect(proposal).not.toBeNull();
    expect(proposal!.kind).toBe("code");
    expect(proposal!.delivery).toBe("agent_branch_pr");
    expect(proposal!.status).toBe("proposed");
  });

  it("erzeugt keinen Vorschlag bei stabiler Lage", () => {
    const evaluation = evaluateLoop([sample("completed"), sample("completed")]);
    expect(createRefactorProposal(evaluation)).toBeNull();
  });
});
