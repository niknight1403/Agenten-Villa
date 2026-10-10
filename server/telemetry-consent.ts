/**
 * Sprint 098 — Produkt-Telemetrie: optionale, datenschutzkonforme Metriken.
 *
 * Einwilligung pro Nutzer, Standard AUS (opt-in). Persistiert in der
 * Tabelle telemetry_consents. Die Funktionen sind bewusst tolerant:
 * Ohne Datenbank gilt weiterhin "nicht eingewilligt" — Telemetrie faellt
 * im Zweifel AUS, nie an.
 */
import { eq } from "drizzle-orm";
import { telemetryConsents } from "../drizzle/schema";
import { getDb } from "./db";

/**
 * Ehrliche Beschreibung dessen, was bei Einwilligung erhoben wird —
 * und dessen, was niemals erhoben wird. Der Client zeigt diesen Text
 * unveraendert neben dem Schalter.
 */
export const TELEMETRY_PRIVACY_NOTICE =
  "Wenn du einwilligst, erfasst die Villa je Agentenlauf nur Zahlen: Ergebnisstatus, Dauer in Millisekunden, Fehlercode sowie Villa- und Projektlabel. Nie erhoben werden: Chatinhalte, Prompts, Antworten, personenbezogene Daten oder Geheimnisse. Speicherung: begrenzt im Prozessspeicher (max. 200 Eintraege), kein Export an Dritte, jederzeit abschaltbar.";

export interface TelemetryConsentState {
  optedIn: boolean;
  notice: string;
}

/** Liest die Einwilligung. Fehlt die Zeile oder die DB: nicht eingewilligt. */
export async function getTelemetryConsent(
  userId: number
): Promise<TelemetryConsentState> {
  const db = await getDb();
  if (!db) return { optedIn: false, notice: TELEMETRY_PRIVACY_NOTICE };
  try {
    const rows = await db
      .select({ optedIn: telemetryConsents.optedIn })
      .from(telemetryConsents)
      .where(eq(telemetryConsents.userId, userId))
      .limit(1);
    return {
      optedIn: rows[0]?.optedIn ?? false,
      notice: TELEMETRY_PRIVACY_NOTICE,
    };
  } catch {
    // Tabelle nicht migriert oder DB gestoert: konservativ AUS.
    return { optedIn: false, notice: TELEMETRY_PRIVACY_NOTICE };
  }
}

/** Setzt die Einwilligung (upsert). Rueckgabe: neuer Zustand. */
export async function setTelemetryConsent(
  userId: number,
  optedIn: boolean
): Promise<TelemetryConsentState> {
  const db = await getDb();
  if (!db) {
    throw new Error("DATABASE_UNAVAILABLE");
  }
  await db
    .insert(telemetryConsents)
    .values({ userId, optedIn })
    .onConflictDoUpdate({
      target: telemetryConsents.userId,
      set: { optedIn, updatedAt: new Date() },
    });
  return { optedIn, notice: TELEMETRY_PRIVACY_NOTICE };
}
