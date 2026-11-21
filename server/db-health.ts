import { sql, type SQL } from "drizzle-orm";
import { getDb } from "./db";

export type DatabaseHealthStatus = "verbunden" | "fehler" | "nicht_konfiguriert";

export type DatabaseHealthReport = {
  status: DatabaseHealthStatus;
  checkedAt: string;
};

/** Minimal Drizzle-compatible interface, kept injectable for unit tests. */
export interface ExecutableDatabase {
  execute(query: SQL): Promise<unknown>;
}

/** Run a harmless round-trip query to verify the actual database connection. */
export function databaseErrorSummary(error: unknown): string {
  const candidate = error as { code?: unknown; name?: unknown; message?: unknown };
  const code = typeof candidate?.code === "string" ? candidate.code : undefined;
  const name = typeof candidate?.name === "string" ? candidate.name : "Error";
  const rawMessage = typeof candidate?.message === "string" ? candidate.message : "Unbekannter Datenbankfehler";
  // Never write connection URLs, credentials, or query parameters to application logs.
  const message = rawMessage
    .replace(new RegExp("postgres(?:ql)?:\\/\\/[^\\s]+", "gi"), "[database-url-redacted]")
    .replace(/(password|passwd|pwd)=([^\s&]+)/gi, "$1=[redacted]")
    .slice(0, 240);
  return [code, name, message].filter(Boolean).join(": ");
}

export async function probeDatabaseConnection(
  db: ExecutableDatabase | null,
  onError?: (summary: string) => void,
): Promise<DatabaseHealthStatus> {
  if (!db) return "nicht_konfiguriert";
  try {
    await db.execute(sql`SELECT 1`);
    return "verbunden";
  } catch (error) {
    onError?.(databaseErrorSummary(error));
    return "fehler";
  }
}

/** Read the configured connection and probe it once. */
export async function checkDatabaseHealth(): Promise<DatabaseHealthReport> {
  const db = await getDb();
  const status = await probeDatabaseConnection(db, (summary) => {
    console.warn(`[Database] Probe-Fehler: ${summary}`);
  });
  return { status, checkedAt: new Date().toISOString() };
}
