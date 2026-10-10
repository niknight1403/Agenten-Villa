import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ollamaChatUrl,
  ollamaModels,
  ollamaModelsUrl,
  ollamaTimeoutMs,
} from "./provider-endpoints";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Ollama-Endpunkte (Sprint 080)", () => {
  it("dokumentiert die Standard-Modellkette klein zuerst (Oracle-VM-realistisch, Sprint 103)", () => {
    expect(ollamaModels()).toEqual([
      "gemma4:12b",
      "devstral:24b",
      "qwen3.6:27b",
      "qwen3-coder:30b",
    ]);
  });

  it("erlaubt Modellketten-Override per OLLAMA_MODELS", () => {
    vi.stubEnv("OLLAMA_MODELS", " qwen3-coder:30b , mistral:7b ");
    expect(ollamaModels()).toEqual(["qwen3-coder:30b", "mistral:7b"]);
  });

  it("baut Chat- und Modelle-URL aus OLLAMA_BASE_URL (OpenAI-kompatibel)", () => {
    vi.stubEnv("OLLAMA_BASE_URL", "http://mein-host:11434/v1/");
    expect(ollamaChatUrl()).toBe("http://mein-host:11434/v1/chat/completions");
    expect(ollamaModelsUrl()).toBe("http://mein-host:11434/v1/models");
  });

  it("liefert ohne OLLAMA_BASE_URL leere URLs (Route existiert nicht)", () => {
    expect(ollamaChatUrl()).toBe("");
    expect(ollamaModelsUrl()).toBe("");
  });

  it("gibt der Route ein eigenes grosszuegiges Zeitlimit (lokale 27B-Inferenz)", () => {
    expect(ollamaTimeoutMs()).toBe(120_000);
    vi.stubEnv("OLLAMA_TIMEOUT_MS", "300000");
    expect(ollamaTimeoutMs()).toBe(300_000);
    vi.stubEnv("OLLAMA_TIMEOUT_MS", "99999999");
    expect(ollamaTimeoutMs()).toBe(600_000); // begrenzt
    vi.stubEnv("OLLAMA_TIMEOUT_MS", "unsinn");
    expect(ollamaTimeoutMs()).toBe(120_000); // Default
  });
});
