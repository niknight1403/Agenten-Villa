import { TRPCError } from "@trpc/server";

/**
 * Sprint 056 — Rate-Limit fuer Admin-Mutationen.
 *
 * Der IP-basierte Login-Limiter schuetzt nur die Auth-Endpunkte.
 * Authentifizierte Admin-Mutationen (Systemprompt, Provider-Config,
 * Elite-Missionen, Rollbacks) hatten kein per-Nutzer-Limit — ein
 * kompromittierter Client oder eine Endlosschleife koennte Mutationen
 * unbeschraenkt wiederholen (Provider-Kontingente, GitHub-Nebenwirkungen,
 * Audit-Rauschen). Dieser Limiter begrenzt ADMIN-Mutationen pro Nutzer
 * in einem gleitenden Fenster und ist prozesslokal (kein Redis noetig).
 */

const windows = new Map<number, { start: number; count: number }>();

const ADMIN_MUTATION_WINDOW_MS = 60_000;
const ADMIN_MUTATION_MAX = 30;

/** Nur fuer Tests/Diagnose: wirksame Grenze abfragen. */
export function adminMutationLimit(): { max: number; windowMs: number } {
  return { max: ADMIN_MUTATION_MAX, windowMs: ADMIN_MUTATION_WINDOW_MS };
}

/**
 * Verbraucht ein Admin-Mutation-Budget des Nutzers; wirft TOO_MANY_REQUESTS,
 * wenn das Fenster ueberschritten ist. Muss NACH der Rollenpruefung laufen,
 * damit fremde Nutzer kein Budget verbrennen koennen.
 */
export function consumeAdminMutation(userId: number): void {
  const now = Date.now();
  const current = windows.get(userId);
  if (!current || now - current.start >= ADMIN_MUTATION_WINDOW_MS) {
    windows.set(userId, { start: now, count: 1 });
    return;
  }
  current.count += 1;
  if (current.count > ADMIN_MUTATION_MAX) {
    const retryInSeconds = Math.ceil(
      (current.start + ADMIN_MUTATION_WINDOW_MS - now) / 1_000
    );
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `Zu viele Administrator-Aktionen. Bitte in ${retryInSeconds} Sekunde(n) erneut versuchen.`,
    });
  }
}

/** Nur fuer Tests: Zustand zuruecksetzen. */
export function resetAdminRateLimiterForTests(): void {
  windows.clear();
}
