/**
 * Sprint 090 — Rollback-Verifikation: deterministische Logik zum Pruefen
 * von Health-relevanten Invarianten eines gegebenen Commits/Tags.
 *
 * Dieses Modul ist bewusst frei von Netz-/Git-Seiten-Effekten: es
 * operiert auf uebergebenen Datenstrukturen, nicht auf echten Repos oder
 * Live-Endpunkten. Die Tests fuehren Fixtures ein; im Betrieb werden die
 * Daten von aussen (z. B. Health-JSON, Git-Log, Migrations-Liste) geliefert.
 */

/** Ein Checkpoint-Tag hat die Form release-NNN (z. B. release-089). */
export const CHECKPOINT_TAG_PATTERN = /^release-(\d{3,4})$/;

/** Health-Payload-Skeleton, das die Invarianten prueft. */
export interface HealthSnapshot {
  ok: boolean;
  version: string;
  database?: { status: string };
  routing?: { activeRoute: string | null };
  providers?: { name: string; configured: boolean; cooldown: boolean }[];
}

/** Migrations-Eintrag fuer Kompatibilitaetspruefung. */
export interface MigrationEntry {
  id: string;
  description: string;
  /** True, wenn die Migration nur additive oder nullable Aenderungen vornimmt. */
  additiveOnly: boolean;
}

/** Router-Config-Persistenz-Zustand. */
export interface RouterConfigState {
  /** Datei existiert und ist lesbar (z. B. data/route-override.json). */
  readable: boolean;
  /** Inhalt ist valides JSON mit erwarteten Feldern. */
  validJson: boolean;
  /** Override ist null = Auto-Kette, oder ein bekannter Provider. */
  override: string | null;
}

/** Ergebnis der Invarianten-Pruefung. */
export interface InvariantCheckResult {
  passed: boolean;
  failures: string[];
}

/** Parst eine Checkpoint-Tag-Bezeichnung und liefert die Sprint-Nummer. */
export function parseCheckpointTag(tag: string): number | null {
  const match = tag.match(CHECKPOINT_TAG_PATTERN);
  return match ? parseInt(match[1], 10) : null;
}

/** Prueft, ob ein Tag-Name ein gueltiger Checkpoint ist. */
export function isValidCheckpointTag(tag: string): boolean {
  return CHECKPOINT_TAG_PATTERN.test(tag);
}

/**
 * Vergleicht zwei Checkpoint-Nummern: ist `target` ein sicherer
 * Rollback-Ziel (kleiner als `current`, aber nicht aelter als den
 * letzten bekannten good-Stand `oldest`)?
 */
export function isSafeRollbackTarget(
  target: number,
  current: number,
  oldest: number
): boolean {
  if (target < 1) return false;
  if (target >= current) return false;
  if (target < oldest) return false;
  return true;
}

/**
 * Prueft Health-Invarianten eines Snapshots gegen erwartete Werte.
 *
 * Invarianten:
 * 1. ok === true
 * 2. version ist eine gueltige SemVer-Zeichenkette
 * 3. database.status === "verbunden" (wenn vorhanden)
 * 4. routing.activeRoute ist nicht null (wenn routing vorhanden)
 * 5. mindestens ein Provider ist configured und nicht im Cooldown
 */
export function verifyHealthInvariants(
  snapshot: HealthSnapshot
): InvariantCheckResult {
  const failures: string[] = [];

  if (!snapshot.ok) {
    failures.push("ok ist false");
  }

  if (!/^\d+\.\d+\.\d+/.test(snapshot.version)) {
    failures.push(`version "${snapshot.version}" ist keine gueltige SemVer`);
  }

  if (snapshot.database && snapshot.database.status !== "verbunden") {
    failures.push(
      `database.status ist "${snapshot.database.status}", erwartet "verbunden"`
    );
  }

  if (snapshot.routing && snapshot.routing.activeRoute === null) {
    failures.push("routing.activeRoute ist null — keine aktive Route");
  }

  if (snapshot.providers && snapshot.providers.length > 0) {
    const anyUsable = snapshot.providers.some(
      (p) => p.configured && !p.cooldown
    );
    if (!anyUsable) {
      failures.push("kein Provider ist konfiguriert und nicht im Cooldown");
    }
  }

  return { passed: failures.length === 0, failures };
}

/**
 * Prueft, ob alle Migrationen in `migrations` abwaertskompatibel sind.
 * Eine Migration gilt als abwaertskompatibel, wenn sie `additiveOnly: true`
 * hat (Spalten additiv oder nullable, kein hartes Drop).
 *
 * Wird eine nicht-additive Migration gefunden, muss sie explizit als
 * Ausnahme dokumentiert sein (`exceptions` enthaelt ihre ID).
 */
export function verifyMigrationsBackwardCompatible(
  migrations: MigrationEntry[],
  exceptions: string[] = []
): InvariantCheckResult {
  const failures: string[] = [];

  for (const m of migrations) {
    if (!m.additiveOnly && !exceptions.includes(m.id)) {
      failures.push(
        `Migration ${m.id} ("${m.description}") ist nicht abwaertskompatibel und nicht als Ausnahme dokumentiert`
      );
    }
  }

  return { passed: failures.length === 0, failures };
}

/**
 * Prueft die Router-Config-Persistenz: die Datei muss lesbar sein,
 * valides JSON enthalten und der Override muss entweder null (Auto-Kette)
 * oder ein nicht-leerer String sein.
 */
export function verifyRouterConfigPersistence(
  state: RouterConfigState
): InvariantCheckResult {
  const failures: string[] = [];

  if (!state.readable) {
    failures.push("Router-Config-Datei ist nicht lesbar");
  }

  if (!state.validJson) {
    failures.push("Router-Config-Datei ist kein valides JSON");
  }

  if (state.override !== null && state.override.trim() === "") {
    failures.push("Override ist ein leerer String — muss null oder ein Provider-Name sein");
  }

  return { passed: failures.length === 0, failures };
}

/**
 * Sammelt alle Invarianten fuer einen vollstaendigen Rollback-Check.
 * Liefert ein zusammengefasstes Ergebnis.
 */
export function fullRollbackCheck(params: {
  targetCheckpoint: number;
  currentCheckpoint: number;
  oldestGoodCheckpoint: number;
  health: HealthSnapshot;
  migrations: MigrationEntry[];
  routerConfig: RouterConfigState;
  migrationExceptions?: string[];
}): InvariantCheckResult {
  const failures: string[] = [];

  // 1. Checkpoint-Sicherheit
  if (
    !isSafeRollbackTarget(
      params.targetCheckpoint,
      params.currentCheckpoint,
      params.oldestGoodCheckpoint
    )
  ) {
    failures.push(
      `Checkpoint ${params.targetCheckpoint} ist kein sicherer Rollback-Ziel (current=${params.currentCheckpoint}, oldest=${params.oldestGoodCheckpoint})`
    );
  }

  // 2. Health-Invarianten
  const healthResult = verifyHealthInvariants(params.health);
  failures.push(...healthResult.failures);

  // 3. Migrationen
  const migrationResult = verifyMigrationsBackwardCompatible(
    params.migrations,
    params.migrationExceptions ?? []
  );
  failures.push(...migrationResult.failures);

  // 4. Router-Config
  const routerResult = verifyRouterConfigPersistence(params.routerConfig);
  failures.push(...routerResult.failures);

  return { passed: failures.length === 0, failures };
}
