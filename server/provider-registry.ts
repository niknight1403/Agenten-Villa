/**
 * Sprint 031 — Providerregister: zentraler Katalog der LLM-Anbieter.
 * Jeder Anbieter besitzt hier dokumentierte Faehigkeiten und ein
 * Statusfeld. Der Status kann ohne Codeaenderung ueber die Umgebung
 * gesetzt werden (PROVIDER_STATUS_<NAME>=active|maintenance|retired);
 * ungültige Werte fallen auf den dokumentierten Standard zurueck.
 */
import {
  GEMINI_CHAT_URL,
  GROQ_CHAT_URL,
  HUGGINGFACE_CHAT_URL,
  geminiModels,
  groqModels,
  hfModel,
  ollamaChatUrl,
  ollamaModels,
  openRouterChatUrl,
} from "./provider-endpoints";
import { guardianChain } from "./provider-guardian";

export type ProviderName =
  | "ollama"
  | "openrouter"
  | "groq"
  | "gemini"
  | "huggingface";
export type ProviderStatus = "active" | "maintenance" | "retired";
export type ProviderCapability = "chat" | "tools";

/** Dokumentierter Eintrag eines Anbieters im Register. */
export interface ProviderCatalogEntry {
  name: ProviderName;
  status: ProviderStatus;
  /** Faehigkeiten, die der Anbieter im Villasystem nachweislich erbringt. */
  capabilities: ProviderCapability[];
  /** Hugging Face wird erst nach ausdruecklicher Einwilligung genutzt. */
  consentRequired: boolean;
  /** Aktuell konfigurierte Modellkette (Env-Overrides bleiben verbindlich). */
  models(): string[];
  /** Chat-Completions-Endpunkt des Anbieters. */
  chatUrl(): string;
  /** Offizielle Dokumentation des Anbieters. */
  docsUrl: string;
}

const STATUSES: readonly ProviderStatus[] = ["active", "maintenance", "retired"];

function statusFromEnv(name: ProviderName, fallback: ProviderStatus): ProviderStatus {
  const raw = process.env[`PROVIDER_STATUS_${name.toUpperCase()}`]?.trim();
  return STATUSES.includes(raw as ProviderStatus) ? (raw as ProviderStatus) : fallback;
}

/** Das Providerregister — dokumentierte Faehigkeiten und Status je Anbieter. */
export function listProviderCatalog(): ProviderCatalogEntry[] {
  return [
    {
      // Sprint 080 — lokale, kostenfreie Route; nur nutzbar, wenn
      // OLLAMA_BASE_URL gesetzt ist (siehe Agent-Engine-Registry).
      name: "ollama",
      status: statusFromEnv("ollama", "active"),
      capabilities: ["chat", "tools"],
      consentRequired: false,
      models: ollamaModels,
      chatUrl: ollamaChatUrl,
      docsUrl: "https://ollama.com",
    },
    {
      name: "openrouter",
      status: statusFromEnv("openrouter", "active"),
      capabilities: ["chat", "tools"],
      consentRequired: false,
      models: guardianChain,
      chatUrl: openRouterChatUrl,
      docsUrl: "https://openrouter.ai/docs",
    },
    {
      name: "groq",
      status: statusFromEnv("groq", "active"),
      capabilities: ["chat", "tools"],
      consentRequired: false,
      models: groqModels,
      chatUrl: () => GROQ_CHAT_URL,
      docsUrl: "https://console.groq.com/docs",
    },
    {
      name: "gemini",
      status: statusFromEnv("gemini", "active"),
      capabilities: ["chat", "tools"],
      consentRequired: false,
      models: geminiModels,
      chatUrl: () => GEMINI_CHAT_URL,
      docsUrl: "https://ai.google.dev/gemini-api/docs",
    },
    {
      name: "huggingface",
      status: statusFromEnv("huggingface", "active"),
      capabilities: ["chat", "tools"],
      consentRequired: true,
      models: () => [hfModel()],
      chatUrl: () => HUGGINGFACE_CHAT_URL,
      docsUrl: "https://huggingface.co/docs",
    },
  ];
}

/** Registereintrag eines Anbieters oder undefined fuer unbekannte Namen. */
export function getProviderCatalogEntry(
  name: string
): ProviderCatalogEntry | undefined {
  return listProviderCatalog().find(entry => entry.name === name);
}

/**
 * Sprint 032 — dokumentierte Fallback-Reihenfolge: OpenRouter -> Groq ->
 * Gemini; Hugging Face nur nach ausdruecklicher Einwilligung (der Consent-
 * Filter bleibt im Engine verbindlich und kann durch die Reihenfolge nicht
 * umgangen werden). Sprint 080 — Ollama (lokal, kostenlos) steht zuerst:
 * ist eine eigene Instanz konfiguriert, hat sie Vorrang vor jeder
 * Cloud-Route; unkonfiguriert existiert sie in der Kette nicht.
 */
export const DOCUMENTED_FALLBACK_ORDER: readonly ProviderName[] = [
  "ollama",
  "openrouter",
  "groq",
  "gemini",
  "huggingface",
];

/**
 * Sprint 032 — deterministisch konfigurierbare Fallback-Reihenfolge.
 * PROVIDER_FALLBACK_ORDER="gemini,openrouter" setzt die genannten Anbieter
 * in genau dieser Reihenfolge nach vorn; ungenannte folgen in dokumentierter
 * Ordnung. Unbekannte Namen und Duplikate werden verworfen. Ohne gueltige
 * Konfiguration gilt die dokumentierte Reihenfolge — niemals Zufall.
 */
export function fallbackOrder(): ProviderName[] {
  const seen = new Set<ProviderName>();
  const configured: ProviderName[] = [];
  for (const raw of (process.env.PROVIDER_FALLBACK_ORDER ?? "").split(",")) {
    const name = raw.trim().toLowerCase();
    const known = DOCUMENTED_FALLBACK_ORDER.find(entry => entry === name);
    if (known && !seen.has(known)) {
      seen.add(known);
      configured.push(known);
    }
  }
  if (configured.length === 0) return [...DOCUMENTED_FALLBACK_ORDER];
  return [
    ...configured,
    ...DOCUMENTED_FALLBACK_ORDER.filter(name => !configured.includes(name)),
  ];
}

/**
 * Ein Anbieter ist waehlbar, solange sein Registerstatus "active" ist.
 * "maintenance" und "retired" werden aus der Failover-Kette genommen —
 * die Kette bleibt fail-closed: ist kein aktiver Anbieter konfiguriert,
 * scheitert der Aufruf ehrlich statt heimlich einen gesperrten zu nutzen.
 */
export function isProviderActive(name: ProviderName): boolean {
  return statusFromEnv(name, "active") === "active";
}
