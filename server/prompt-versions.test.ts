import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activePrompt,
  commitPromptVersion,
  listPromptVersions,
  resetPromptVersionsForTests,
  rollbackPromptVersion,
} from "./prompt-versions";

afterEach(() => {
  resetPromptVersionsForTests();
  vi.restoreAllMocks();
});

describe("Prompt- und Kontextversionierung (Sprint 049)", () => {
  it("zeichnet Änderungen versioniert mit Autor und Zeitstempel auf", () => {
    expect(activePrompt()).toBeNull();
    const first = commitPromptVersion("Sei präzise.", "admin@example.com");
    expect(first).toMatchObject({ version: 1, prompt: "Sei präzise.", changedBy: "admin@example.com" });
    expect(first.changedAt).toBeTruthy();
    const second = commitPromptVersion(null, "admin@example.com", "Override entfernt.");
    expect(second.version).toBe(2);
    expect(activePrompt()).toBeNull();
    expect(listPromptVersions()[0].version).toBe(2);
  });

  it("setzt eine frühere Version explizit als eigene Version zurück", () => {
    commitPromptVersion("Fassung A", "admin@example.com");
    commitPromptVersion("Fassung B", "admin@example.com");
    const rollback = rollbackPromptVersion(1, "admin@example.com");
    expect(rollback).toMatchObject({ version: 3, prompt: "Fassung A" });
    expect(rollback.note).toContain("Version 1");
    expect(activePrompt()).toBe("Fassung A");
    expect(listPromptVersions()).toHaveLength(3);
  });

  it("weist unbekannte Versionen mit NOT_FOUND zurück", () => {
    expect(() => rollbackPromptVersion(99, "admin@example.com")).toThrow(/existiert nicht/);
  });

  it("begrenzt den Verlauf auf 50 Versionen", () => {
    for (let i = 0; i < 55; i++) commitPromptVersion(`Fassung ${i}`, "admin@example.com");
    expect(listPromptVersions()).toHaveLength(50);
    expect(listPromptVersions()[0].version).toBe(55);
    expect(listPromptVersions()[49].version).toBe(6);
  });
});
