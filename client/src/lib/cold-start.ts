/**
 * Cold-Start-Resilienz fuer die Render-Free-Instanz (Client).
 *
 * Render Free schlaeft nach ~15 Minuten Inaktivitaet ein; der erste Aufruf
 * nach dem Aufwachen dauert real 30-60+ Sekunden (Spin-up + Boot). Vorher
 * hatte weder der tRPC-Client noch der native Login-Fetch ein Timeout oder
 * Wiederholungslogik — die App zeigte beim Start endlos "Anmeldung wird
 * geprüft …" und der Login wirkte kaputt, obwohl der Server nur aufwachte.
 *
 * Reine Logik hier (testbar ohne Browser):
 *  - shouldRetryFetch: Netzwerkfehler/Timeout/5xx sind transitiv → Retry
 *    lohnt sich (der Server ist meist beim zweiten Versuch wach). 4xx sind
 *    fachliche Fehler (kein Retry).
 *  - fetchWithResilience: fetch-Wrapper mit hartem Timeout + N Wieder-
 *    holungen und Kleingeld-Backoff.
 *  - prewarmServer: feuert /api/health ohne Erwartung einer Antwort ab,
 *    damit der Server waehrend des Splash-Screens bereits aufwaermt.
 */

export const FETCH_TIMEOUT_MS = 60_000;
export const FETCH_RETRIES = 2;
const RETRY_DELAY_MS = 1_500;

/** TypeError = Netzwerkfehler/Timeout im Browser-Fetch; 5xx = transient. */
export function shouldRetryFetch(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (error instanceof DOMException && error.name === "TimeoutError") return true;
  if (error instanceof DOMException && error.name === "AbortError") return true;
  return false;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * fetch mit hartem Timeout und Wiederholung bei transienten Fehlern.
 * Bei Erschoepfung der Versuche fliegt der letzte Fehler weiter — harter
 * Fehler bleibt sichtbar, wird nie still schluckt.
 */
export async function fetchWithResilience(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  options: { timeoutMs?: number; retries?: number } = {},
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
  const retries = options.retries ?? FETCH_RETRIES;
  let lastError: unknown = new Error("fetch fehlgeschlagen");
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new DOMException("Zeitüberschreitung", "TimeoutError")), timeoutMs);
      // Extern mitgegebenes Signal weiterhin respektieren.
      if (init?.signal) {
        if (init.signal.aborted) {
          clearTimeout(timer);
          throw new DOMException("Abgebrochen", "AbortError");
        }
        init.signal.addEventListener("abort", () => controller.abort(new DOMException("Abgebrochen", "AbortError")), { once: true });
      }
      try {
        return await fetch(input, { ...(init ?? {}), signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      lastError = error;
      if (attempt === retries || !shouldRetryFetch(error)) throw error;
      await sleep(RETRY_DELAY_MS);
    }
  }
  throw lastError;
}

/**
 * Server unauffaellig vorwaermen (fire-and-forget): weckt die schlafende
 * Render-Free-Instanz, waehrend der Nutzer noch den Splash liest. Fehler
 * sind bewusst egal — das eigentliche Request-Handling macht den Rest.
 */
export function prewarmServer(apiBase: string): void {
  try {
    void fetch(`${apiBase.replace(/\/+$/, "")}/api/health`, { keepalive: true }).catch(() => undefined);
  } catch {
    // noexcept by design
  }
}
