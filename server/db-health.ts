import { getDb } from "./db";

/**
 * Sprint 011-Betriebshaerte: Datenbank-Verfuegbarkeit beim Start sichtbar
 * machen (Sprint-Status-Regel: nie still scheitern).
 *
 * - Ohne DATABASE_URL oder ohne laehige Verbindung: "nicht_konfiguriert"
 *   (bewusst erlaubt, damit lokale Werkzeuge ohne DB laufen koennen).
 * - Produktionsmodus loggt den Status beim Start UND aktualisiert den
 *   oeffentlichen Health-Endpoint (siehe _core/health.ts), damit ein
 *   "scheinbar erfolgreicher" Deploy sofort erkennbar ist.
 *
 * Der Health-Endpoint bleibt bewusst schnell und ohne Blockieren:
 * das Ergebnis wird gecacht und nur im Hintergrund aktualisiert.
 */

export type DatabaseHealthStatus = "verbunden" | "fehler" | "nicht_konfiguriert";

export type DatabaseHealthReport = {
  status: DatabaseHealthStatus;
  checkedAt: string;
};

/** Minimal-Interface fuer Tests: jede Drizzle-aehnliche Instanz mit execute(). */
export interface ExecutableDatabase {
  execute(sql: string): Promise<unknown>;
}

/** Reine Pruefung: eine ungefaehrliche, begrenzte Anfrage (SELECT 1). */
export async function probeDatabaseConnection(
  db: ExecutableDatabase | null,
): Promise<DatabaseHealthStatus> {
  if (!db) return "nicht_konfiguriert";
  try {
    await db.execute("SELECT 1");
    return "verbunden";
  } catch {
    return "fehler";
  }
}

/** Liest die konfigurierte Verbindung und prueft sie einmal. */
export async function checkDatabaseHealth(): Promise<DatabaseHealthReport> {
  const db = await getDb();
  const status = await probeDatabaseConnection(db as ExecutableDatabase | null);
  return { status, checkedAt: new Date().toISOString() };
}
