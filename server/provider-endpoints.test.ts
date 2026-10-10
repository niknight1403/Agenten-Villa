import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ollamaChatUrl,
  ollamaKeepAlive,
  ollamaModels,
  ollamaModelsUrl,
  ollamaNativeChatUrl,
  ollamaNumCtx,
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

  it("baut die Native-Chat-URL korrekt (Sprint 103): /v1 wird entfernt, /api/chat angehaengt", () => {
    vi.stubEnv("OLLAMA_BASE_URL", "https://ollama.example.com/v1");
    expect(ollamaNativeChatUrl()).toBe("https://ollama.example.com/api/chat");
    vi.stubEnv("OLLAMA_BASE_URL", "http://host:11434");
    expect(ollamaNativeChatUrl()).toBe("http://host:11434/api/chat");
  });

  it("begrenzt OLLAMA_NUM_CTX ehrlich auf 512-8192 mit Default 2048 (Sprint 103)", () => {
    expect(ollamaNumCtx()).toBe(2048);
    vi.stubEnv("OLLAMA_NUM_CTX", "100");
    expect(ollamaNumCtx()).toBe(512);
    vi.stubEnv("OLLAMA_NUM_CTX", "999999");
    expect(ollamaNumCtx()).toBe(8192);
  });

  it("liefert keep_alive mit Default 30m, per Env ueberschreibbar (Sprint 103)", () => {
    expect(ollamaKeepAlive()).toBe("30m");
    vi.stubEnv("OLLAMA_KEEP_ALIVE", "2h");
    expect(ollamaKeepAlive()).toBe("2h");
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
