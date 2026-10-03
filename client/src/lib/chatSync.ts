/**
 * Sprint 067 — Synchronisationskonflikte (Roadmap 066).
 *
 * Der Chatverlauf lebt lokal im Zustand und wird nach jedem Zug gegen den
 * Server abgeglichen. Zwei Konfliktfälle müssen nachvollziehbar bleiben,
 * statt still zu divergieren:
 *
 *  1. Gescheiterte Sendung (offline, Provider-Fehler): die Nutzer-Nachricht
 *     bleibt mit ihrem Text im Verlauf sichtbar und kann per „Erneut senden“
 *     wiederholt werden — der eingegebene Text geht nie verloren.
 *  2. Gescheiterte Persistenz (Antwort da, Datenbank weg): der Zug bleibt
 *     lesbar, wird aber als „nur lokal“ markiert. Beim nächsten Abgleich
 *     gewinnt der Server — der Nutzer weiß vorher, dass der Zug beim Laden
 *     verschwindet.
 */

export type SyncState = "failed" | "local-only";

export interface SyncableMessage {
  role: "assistant" | "user";
  text: string;
  syncState?: SyncState;
}

/**
 * Markiert die letzte unmarkierte Nutzer-Nachricht mit genau diesem Text
 * als „failed“ — sie bleibt damit wiederholbar (retry-fähig).
 * Bereits abgeschlossene (markierte) Nachrichten bleiben unverändert.
 */
export function markLastUserMessageFailed<T extends SyncableMessage>(
  messages: T[],
  text: string
): T[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user" && message.text === text && !message.syncState) {
      const next = messages.slice();
      next[index] = { ...message, syncState: "failed" };
      return next;
    }
  }
  return messages;
}

/**
 * Markiert die letzten n Nachrichten als „nur lokal“ — der Zug bleibt
 * lesbar, ist aber beim nächsten Serverabgleich weg. n wird auf die
 * tatsächlich vorhandenen Nachrichten begrenzt.
 */
export function markTailLocalOnly<T extends SyncableMessage>(
  messages: T[],
  count: number
): T[] {
  if (messages.length === 0 || count <= 0) return messages;
  const limit = Math.min(count, messages.length);
  const start = messages.length - limit;
  return messages.map((message, index) =>
    index >= start && !message.syncState ? { ...message, syncState: "local-only" as const } : message
  );
}

/**
 * Findet die letzte als „failed“ markierte Nutzer-Nachricht mit diesem
 * Text. -1, wenn kein passender Konflikt existiert.
 */
export function findFailedUserIndex(messages: SyncableMessage[], text: string): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user" && message.syncState === "failed" && message.text === text) {
      return index;
    }
  }
  return -1;
}

/**
 * Entfernt den gescheiterten Zug an exakt dieser Position: die markierte
 * Nutzer-Nachricht und die direkt darauffolgenden Assistenten-Antworten
 * desselben Fehlerversuchs (ebenfalls „failed“). Andere Nachrichten — auch
 * weitere gescheiterte Züge mit gleichem Text — bleiben unberührt.
 * Kein Konflikt an dieser Position: Array bleibt identisch.
 */
export function removeFailedExchangeAt<T extends SyncableMessage>(
  messages: T[],
  index: number
): T[] {
  if (index < 0 || index >= messages.length) return messages;
  const failedUser = messages[index];
  if (failedUser.role !== "user" || failedUser.syncState !== "failed") {
    return messages;
  }
  let end = index + 1;
  while (end < messages.length && messages[end].syncState === "failed") {
    end += 1;
  }
  return [...messages.slice(0, index), ...messages.slice(end)];
}

/**
 * Sichtbarer, nutzerlesbarer Hinweis für einen Synchronisationskonflikt.
 * null, wenn die Nachricht keinen Konflikt trägt.
 */
export function syncNotice(message: SyncableMessage): string | null {
  if (message.role === "user" && message.syncState === "failed") {
    return "Nicht gesendet — du kannst es erneut versuchen.";
  }
  if (message.syncState === "local-only") {
    return "Nur auf diesem Gerät — beim nächsten Laden nicht mehr verfügbar.";
  }
  if (message.role === "assistant" && message.syncState === "failed") {
    return "Sendung fehlgeschlagen — der Text oben bleibt wiederholbar.";
  }
  return null;
}
