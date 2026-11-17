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
export async function probeDatabaseConnection(
  db: ExecutableDatabase | null,
): Promise<DatabaseHealthStatus> {
  if (!db) return "nicht_konfiguriert";
  try {
    await db.execute(sql`SELECT 1`);
    return "verbunden";
  } catch {
    return "fehler";
  }
}

/** Read the configured connection and probe it once. */
export async function checkDatabaseHealth(): Promise<DatabaseHealthReport> {
  const db = await getDb();
  const status = await probeDatabaseConnection(db);
  return { status, checkedAt: new Date().toISOString() };
}
