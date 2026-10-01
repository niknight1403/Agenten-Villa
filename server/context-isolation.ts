/**
 * Sprint 044 — Aufgabenkontext isolieren: Missionskontexte sind gegeneinander
 * isoliert. Cache und Lauf-Deduplizierung werden pro Aufgabe/Mission
 * namespaced — eine Mission liest niemals die Cache-Einträge oder
 * Lauf-Ergebnisse einer anderen Mission und niemals die des allgemeinen
 * Chats. Innerhalb derselben Mission bleiben Cache und Dedupe intakt.
 */

export const CHAT_CACHE_SCOPE = "chat" as const;

/** Namespaced Cache-Schlüssel: Basis-Signatur + Aufgaben-Scope. */
export function scopedCacheKey(scope: string, baseKey: string): string {
  return `${scope}:${baseKey}`;
}

/** Missionsscope aus der Missions-ID; ohne Mission gilt der Chat-Scope. */
export function missionCacheScope(missionId?: string): string {
  const trimmed = missionId?.trim();
  return trimmed ? `mission:${trimmed}` : CHAT_CACHE_SCOPE;
}
