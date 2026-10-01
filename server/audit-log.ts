/**
 * Sprint 052 — Audit-Log: Kritische Änderungen besitzen Zeit, Nutzer
 * und Aktion. Jede geschützte Mutation (Systemprompt, Rollback,
 * Betriebszustand) wird mit Zeitstempel, Nutzer und Aktion in einem
 * begrenzten Ringpuffer aufgezeichnet und ist admin-only abfragbar.
 */

export type AuditEntry = {
  /** ISO-Zeitstempel der Änderung. */
  time: string;
  /** Nutzerkennung (id) und E-Mail des Ausführenden. */
  userId: number | null;
  userEmail: string | null;
  /** Kurzer, stabiler Aktionsname (z.B. system_prompt_set). */
  action: string;
  /** Kurze Klartext-Beschreibung der Änderung. */
  details: string;
};

const MAX_AUDIT_ENTRIES = 200;

const auditLog: AuditEntry[] = [];

/** Zeichnet eine kritische Änderung auf (neueste zuerst abrufbar). */
export function recordAuditEntry(entry: {
  userId: number | null;
  userEmail: string | null;
  action: string;
  details: string;
  time?: Date;
}): AuditEntry {
  const stored: AuditEntry = {
    time: (entry.time ?? new Date()).toISOString(),
    userId: entry.userId,
    userEmail: entry.userEmail,
    action: entry.action,
    details: entry.details,
  };
  auditLog.unshift(stored);
  if (auditLog.length > MAX_AUDIT_ENTRIES) auditLog.length = MAX_AUDIT_ENTRIES;
  return stored;
}

/** Liefert das Audit-Log newest-first (admin-only abgefragt). */
export function listAuditEntries(limit = 50): AuditEntry[] {
  return auditLog.slice(0, Math.max(1, Math.min(limit, MAX_AUDIT_ENTRIES)));
}

export function auditLogSize(): number {
  return auditLog.length;
}

export function resetAuditLogForTests(): void {
  auditLog.length = 0;
}
