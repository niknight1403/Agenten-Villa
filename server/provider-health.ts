/**
 * Sprint 036 — Provider-Gesundheitscheck: Checks verwenden ungefährliche,
 * begrenzte Anfragen.
 *
 * Jede Pruefung ist ein einzelner GET auf ein reines Status-/Liste-Endpunkt
 * (kein Completion-Endpunkt, kein Nutzdatenkörper, kein Kontingentverbrauch),
 * mit hartem Zeitlimit und ohne Geheimnisse im Ergebnis. Pro Anbieter und
 * Prozess gilt ein Mindestabstand zwischen zwei Pruefungen — Anfragen gegen
 * den Anbieter bleiben begrenzt, wiederholte Pruefungen lesen das letzte
 * Ergebnis (cached) statt erneut zu senden.
 */
import type { ProviderName } from "./provider-registry";
import { ollamaModelsUrl } from "./provider-endpoints";

export type ProviderHealthStatus =
  | "valid"
  | "invalid"
  | "unavailable"
  | "not_configured"
  | "consent_required";

export type ProviderHealthResult = {
  status: ProviderHealthStatus;
  /** Sprint 036 — true, wenn keine neue Anfrage gesendet wurde. */
  cached: boolean;
};

/** Ungefährlich: Zeitlimit einer einzelnen Pruefanfrage. */
export const PROVIDER_HEALTH_TIMEOUT_MS = 8_000;
/** Begrenzt: Mindestabstand zweier Pruefungen je Anbieter im Prozess. */
export const PROVIDER_HEALTH_MIN_INTERVAL_MS = 10_000;

type ProbeConfig = {
  /** Statisch oder (Ollama) aus der Umgebung berechnet. */
  url: string | (() => string);
  key: () => string | undefined;
  headerName: string;
};

const PROBES: Record<ProviderName, ProbeConfig> = {
  openrouter: {
    // Reiner Schlüssel-Status-Endpunkt; keine Completions, kein Verbrauch.
    url: "https://openrouter.ai/api/v1/key",
    key: () => process.env.OPENROUTER_API_KEY?.trim(),
    headerName: "Authorization",
  },
  groq: {
    url: "https://api.groq.com/openai/v1/models",
    key: () => process.env.GROQ_API_KEY?.trim(),
    headerName: "Authorization",
  },
  gemini: {
    url: "https://generativelanguage.googleapis.com/v1beta/models",
    key: () => process.env.GEMINI_API_KEY?.trim(),
    headerName: "x-goog-api-key",
  },
  huggingface: {
    url: "https://router.huggingface.co/v1/models",
    key: () => process.env.HF_TOKEN?.trim(),
    headerName: "Authorization",
  },
  // Sprint 080 — Ollama: OpenAI-kompatible Modelliste des eigenen Hosts;
  // ohne OLLAMA_BASE_URL gilt die Route als nicht konfiguriert, ein
  // API-Schluessel ist optional (nur fuer Reverse-Proxys).
  ollama: {
    url: () => ollamaModelsUrl(),
    key: () => process.env.OLLAMA_API_KEY?.trim(),
    headerName: "Authorization",
  },
};

const lastProbe = new Map<
  ProviderName,
  { at: number; result: ProviderHealthResult }
>();

export interface ProviderHealthOptions {
  fetcher?: typeof fetch;
  /** Hugging Face bleibt einwilligungsgated: Pruefung nur mit Consent. */
  consentHuggingFace?: boolean;
  /** Test-Hook: eingebbarer Mindestabstand und Zeituhr. */
  minIntervalMs?: number;
  now?: () => number;
}

export function resetProviderHealthForTests(): void {
  lastProbe.clear();
}

/**
 * Prueft einen Anbieter mit einer ungefährlichen, begrenzten Anfrage.
 * Ohne konfigurierten Schlüssel: "not_configured" ohne Netzwerkverkehr.
 * Hugging Face ohne ausdrückliche Einwilligung: "consent_required".
 */
export async function checkProviderHealth(
  name: ProviderName,
  options: ProviderHealthOptions = {}
): Promise<ProviderHealthResult> {
  const now = options.now ?? Date.now;
  const minInterval = options.minIntervalMs ?? PROVIDER_HEALTH_MIN_INTERVAL_MS;
  const previous = lastProbe.get(name);
  const at = now();
  if (previous && at - previous.at < minInterval)
    return { status: previous.result.status, cached: true };

  const probe = PROBES[name];
  const key = probe.key();
  // Sprint 080 — Ollama ist per Base-URL konfiguriert, nicht per Schluessel.
  const configured =
    name === "ollama"
      ? Boolean(process.env.OLLAMA_BASE_URL?.trim())
      : Boolean(key);
  // Netzfreie Ergebnisse werden nicht gecacht: eine spätere Konfiguration
  // oder Einwilligung wirkt sofort — der Begrenzer schützt nur echte Anfragen.
  if (!configured) return { status: "not_configured", cached: false };
  if (name === "huggingface" && options.consentHuggingFace !== true)
    return { status: "consent_required", cached: false };

  let status: ProviderHealthStatus;
  try {
    const probeUrl = typeof probe.url === "function" ? probe.url() : probe.url;
    const response = await (options.fetcher ?? fetch)(probeUrl, {
      method: "GET",
      // Ohne Schluessel (Ollama lokal) kein Authorization-Kopf.
      headers: key
        ? { [probe.headerName]: probe.headerName === "Authorization" ? `Bearer ${key}` : key }
        : undefined,
      signal: AbortSignal.timeout(PROVIDER_HEALTH_TIMEOUT_MS),
    });
    if (response.status === 200) status = "valid";
    else if (response.status === 401 || response.status === 403)
      status = "invalid";
    else status = "unavailable";
  } catch {
    status = "unavailable";
  }
  const result: ProviderHealthResult = { status, cached: false };
  lastProbe.set(name, { at, result });
  return result;
}
