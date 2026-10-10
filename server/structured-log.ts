/**
 * Sprint 078 — Strukturierte Logs: Jede Logzeile ist eine einzige
 * JSON-Zeile mit Zeitstempel, Level, Event, Korrelations-ID, Status und
 * Dauer. So bleiben Logs maschinell filter- und korrelierbar (Persistenz-,
 * Health- und Logpfade grün, siehe Roadmap 078/080).
 *
 * Sicherheitsinvarianten:
 * - Felder mit geheimnisverdächtigen Namen (key, token, secret, password,
 *   authorization) werden verworfen — niemals Werte mitloggen.
 * - Lange Werte werden gekürzt: keine Prompts oder Nutzdaten in Logs.
 * - Keine personenbezogenen Daten: der Logger kennt nur, was ihm explizit
 *   übergeben wird.
 */
export type StructuredLogLevel = "info" | "warn" | "error";

export type StructuredLogFields = Record<string, unknown>;

/** Maximale Länge eines einzelnen Feldwerts in der Logzeile. */
export const LOG_FIELD_MAX_CHARS = 500;

/** Geheimnisverdächtige Feldnamen werden grundsätzlich nicht geloggt. */
const SECRET_KEY_PATTERN =
  /(secret|token|key|password|authorization|cookie)/i;

export interface StructuredLine {
  ts: string;
  level: StructuredLogLevel;
  event: string;
  [field: string]: unknown;
}

/** Kompakte, nicht vorhersagbare Korrelations-ID (12 Hex-Zeichen). */
export function newCorrelationId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === "string" && value.length > LOG_FIELD_MAX_CHARS)
    return `${value.slice(0, LOG_FIELD_MAX_CHARS)}…[gekürzt ${value.length - LOG_FIELD_MAX_CHARS}]`;
  return value;
}

/**
 * Schreibt eine strukturierte JSON-Logzeile. Felder mit
 * geheimnisverdächtigen Namen werden verworfen; unbekannte Werte werden
 * gekürzt. `logger` ist injizierbar für Tests.
 */
export function structuredLog(
  level: StructuredLogLevel,
  event: string,
  fields: StructuredLogFields = {},
  logger: Pick<Console, "log" | "warn" | "error"> = console
): StructuredLine {
  const line: StructuredLine = {
    ts: new Date().toISOString(),
    level,
    event,
  };
  for (const [key, value] of Object.entries(fields)) {
    if (SECRET_KEY_PATTERN.test(key)) continue;
    line[key] = sanitizeValue(value);
  }
  const serialized = JSON.stringify(line);
  if (level === "error") logger.error(serialized);
  else if (level === "warn") logger.warn(serialized);
  else logger.log(serialized);
  return line;
}

/** Laufende Zeitmessung mit eigener Korrelations-ID (HTTP-Requests). */
export function startCorrelation(): {
  correlationId: string;
  elapsedMs(): number;
} {
  const correlationId = newCorrelationId();
  const start = Date.now();
  return { correlationId, elapsedMs: () => Date.now() - start };
}
