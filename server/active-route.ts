/**
 * Sprint 103 — Gemeinsame, zustandslose Ermittlung der aktiven LLM-Route.
 *
 * Health-Endpoint und HAARA muessen dieselbe Quelle der Wahrheit haben:
 * die Route ergibt sich aus Konfiguration (Keys), Aktivierung und Cooldown —
 * NICHT aus probe-basiertem Rotator-State, der beim Kaltstart leer ist.
 * (Fix: HAARA meldete sonst fälschlich "critical" bei aktiver Route.)
 */

import { fallbackOrder, isProviderActive, type ProviderName } from "./provider-registry";
import { providerCooldownInfo } from "./provider-cooldown";

/** Env-Name des API-Keys je Anbieter (Key vorhanden = konfiguriert). */
export const PROVIDER_KEY_ENV: Record<ProviderName, string> = {
  // Sprint 080 — Ollama wird per Base-URL konfiguriert (kein Schluessel
  // noetig); die Eintragung hier bezeichnet "konfiguriert".
  ollama: "OLLAMA_BASE_URL",
  openrouter: "OPENROUTER_API_KEY",
  groq: "GROQ_API_KEY",
  gemini: "GEMINI_API_KEY",
  huggingface: "HF_TOKEN",
};

/**
 * Zustandslose, niemals werfende Ermittlung der Route, die als naechstes
 * bedient: Admin-Pin hat Vorrang, sonst erste aktive, konfigurierte und
 * nicht im Cooldown befindliche Route nach Fallback-Ordnung.
 */
export function activeRouteFromConfig(): ProviderName | null {
  // Bewusst identisch zu health.ts activeRouteName(): ein Admin-Pin wird
  // separat als "pinned" gemeldet und veraendert die bediente Route nicht.
  try {
    for (const name of fallbackOrder()) {
      if (!isProviderActive(name)) continue;
      if (!Boolean(process.env[PROVIDER_KEY_ENV[name]]?.trim())) continue;
      if (providerCooldownInfo(name) !== null) continue;
      return name;
    }
  } catch {
    /* Registrierung nicht verfuegbar — null melden (ehrlich). */
  }
  return null;
}
