import { and, desc, eq } from "drizzle-orm";
import type { RunPhase, VillaTestRun } from "../drizzle/schema";
import { getDb } from "./db";
import { villaRunEvents, villaTestRuns, villas } from "../drizzle/schema";
import type { VillaRunEvent } from "../drizzle/schema";

/** Sprint 021/022 — Lebenszyklus eines begrenzten Villa-Testlaufs. */
export type TestRunStatus = "running" | "succeeded" | "failed" | "cancelled";

/** Technische Gründe, die ein Store-Ergebnis verhindern; der Router mappt sie auf tRPC-Codes. */
export class TestRunError extends Error {
  constructor(
    readonly reason: "NOT_FOUND" | "ARCHIVED" | "STATUS_MISMATCH" | "PHASE_MISMATCH"
  ) {
    super(`TEST_RUN_${reason}`);
  }
}

/**
 * Sprint 023 — Phasenmodell: sichtbare Reihenfolge eines Laufs. „result" wird
 * nur vom Abschluss (finishTestRun) gesetzt; Anwender schalten nur vorwärts.
 */
export const RUN_PHASE_ORDER: readonly Exclude<RunPhase, "result">[] = [
  "preparation",
  "planning",
  "execution",
  "review",
];

/**
 * Sprint 024 — Zeitgrenzen für Testläufe. Fortschritt und Countdown ergeben
 * sich deterministisch aus startedAt + timeLimitSeconds, nie aus einzelnen
 * Ticker-Updates.
 */
export const RUN_TIME_LIMIT_MIN_SECONDS = 60;
export const RUN_TIME_LIMIT_MAX_SECONDS = 3600;
export const RUN_TIME_LIMIT_DEFAULT_SECONDS = 600;

export function clampRunTimeLimitSeconds(value: number | undefined): number {
  if (value === undefined) return RUN_TIME_LIMIT_DEFAULT_SECONDS;
  if (!Number.isFinite(value)) return RUN_TIME_LIMIT_DEFAULT_SECONDS;
  return Math.min(
    RUN_TIME_LIMIT_MAX_SECONDS,
    Math.max(RUN_TIME_LIMIT_MIN_SECONDS, Math.round(value))
  );
}

/**
 * Sprint 024 — deterministische Fortschritts-Projektion eines Laufs:
 * abgeschlossene Läufe sind immer vollstaendig; laufende Läufe berechnen
 * Countdown und Fortschritt ausschliesslich aus der Zeitgrenze.
 */
export function projectRunProgress(
  run: VillaTestRun,
  now: Date = new Date()
): {
  phase: RunPhase;
  status: TestRunStatus;
  progressPercent: number;
  remainingSeconds: number | null;
  expired: boolean;
} {
  if (run.status !== "running") {
    return {
      phase: run.phase as RunPhase,
      status: run.status,
      progressPercent: 100,
      remainingSeconds: null,
      expired: false,
    };
  }
  const limit = clampRunTimeLimitSeconds(run.timeLimitSeconds ?? undefined);
  const elapsedSeconds = Math.max(
    0,
    Math.floor((now.getTime() - run.startedAt.getTime()) / 1000)
  );
  const remainingSeconds = Math.max(0, limit - elapsedSeconds);
  return {
    phase: run.phase as RunPhase,
    status: run.status,
    progressPercent: Math.min(100, Math.floor((elapsedSeconds / limit) * 100)),
    remainingSeconds,
    expired: remainingSeconds === 0,
  };
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  return db;
}

const RUN_PAGE_SIZE_MAX = 50;

/** Sprint 025 — Grenzen des Live-Aktivitätsprotokolls je Lauf. */
export const RUN_EVENT_MESSAGE_MAX = 400;
export const RUN_EVENT_PAGE_SIZE_MAX = 50;
export type RunEventLevel = "info" | "warn" | "error";

/**
 * Sprint 021 — Läufe des Aufrufers, neueste zuerst. Ownership läuft über die
 * Villa: nur Läufe auf eigenen Villen sind sichtbar. Ohne villaId über alle
 * eigenen Villen, ansonsten gefiltert.
 */
export async function listTestRuns(
  userId: number,
  villaId?: number,
  limit?: number
): Promise<VillaTestRun[]> {
  const db = await requireDb();
  const boundedLimit = Math.max(
    1,
    Math.min(limit ?? RUN_PAGE_SIZE_MAX, RUN_PAGE_SIZE_MAX)
  );
  const ownership = eq(villas.createdBy, userId);
  const filter = villaId
    ? and(ownership, eq(villaTestRuns.villaId, villaId))
    : ownership;
  return db
    .select({ run: villaTestRuns })
    .from(villaTestRuns)
    .innerJoin(villas, eq(villaTestRuns.villaId, villas.id))
    .where(filter)
    .orderBy(desc(villaTestRuns.createdAt))
    .limit(boundedLimit)
    .then(rows => rows.map(row => row.run));
}

/** Sprint 021 — Einzelnen Lauf lesen, nur auf eigenen Villen. */
export async function getTestRun(
  runId: number,
  userId: number
): Promise<VillaTestRun | undefined> {
  const db = await requireDb();
  const rows = await db
    .select({ run: villaTestRuns })
    .from(villaTestRuns)
    .innerJoin(villas, eq(villaTestRuns.villaId, villas.id))
    .where(and(eq(villaTestRuns.id, runId), eq(villas.createdBy, userId)))
    .limit(1);
  return rows[0]?.run;
}

/**
 * Sprint 021/022 — Begrenzten Testlauf starten, idempotent: Läuft bereits ein
 * Lauf auf der Villa, wird genau dieser zurückgegeben und kein zweiter erzeugt
 * (kein inkonsistenter Zustand bei wiederholtem Start). Archivierte Villen
 * starten keine Läufe. Villa und Lauf werden transaktional gesperrt.
 */
export async function startTestRun(
  villaId: number,
  userId: number,
  timeLimitSeconds?: number
): Promise<VillaTestRun> {
  const db = await requireDb();
  return db.transaction(async tx => {
    const [villa] = await tx
      .select()
      .from(villas)
      .where(and(eq(villas.id, villaId), eq(villas.createdBy, userId)))
      .for("update");
    if (!villa) throw new TestRunError("NOT_FOUND");
    if (villa.archivedAt) throw new TestRunError("ARCHIVED");

    const [active] = await tx
      .select()
      .from(villaTestRuns)
      .where(
        and(
          eq(villaTestRuns.villaId, villaId),
          eq(villaTestRuns.status, "running")
        )
      )
      .limit(1)
      .for("update");
    if (active) return active;

    const [created] = await tx
      .insert(villaTestRuns)
      .values({
        villaId,
        actorId: userId,
        status: "running",
        phase: "preparation",
        timeLimitSeconds: clampRunTimeLimitSeconds(timeLimitSeconds),
      })
      .returning();
    return created;
  });
}

/**
 * Sprint 021/022 — Lauf abschließen, idempotent: Ein bereits abgeschlossener
 * Lauf mit demselben Zielstatus wird unverändert zurückgegeben (wiederholtes
 * Stoppen ändert nichts, erstes Ergebnis gewinnt). Ein abgeschlossener Lauf
 * mit abweichendem Zielstatus bleibt konsistent und wirft STATUS_MISMATCH —
 * Historie wird nie umgeschrieben. Nur laufende Läufe werden beendet.
 */
export async function finishTestRun(input: {
  runId: number;
  userId: number;
  status: Extract<TestRunStatus, "succeeded" | "failed" | "cancelled">;
  result?: unknown;
  errorCode?: string | null;
}): Promise<VillaTestRun> {
  const db = await requireDb();
  return db.transaction(async tx => {
    const [run] = await tx
      .select()
      .from(villaTestRuns)
      .where(
        and(
          eq(villaTestRuns.id, input.runId),
          eq(villaTestRuns.actorId, input.userId)
        )
      )
      .for("update");
    if (!run) throw new TestRunError("NOT_FOUND");

    if (run.status !== "running") {
      if (run.status === input.status) return run;
      throw new TestRunError("STATUS_MISMATCH");
    }

    const rows = await tx
      .update(villaTestRuns)
      .set({
        status: input.status,
        phase: "result",
        endedAt: new Date(),
        result: input.result === undefined ? null : input.result,
        errorCode: input.errorCode ?? null,
      })
      .where(eq(villaTestRuns.id, run.id))
      .returning();
    return rows[0];
  });
}

/**
 * Sprint 023 — Phase eines laufenden Testlaufs sichtbar weiterschalten. Nur
 * vorwärts entlang RUN_PHASE_ORDER, nie auf „result" (setzt nur finishTestRun)
 * und nie zurück. Aktuelle Phase erneut setzen ist idempotent. Abgeschlossene
 * Läufe sind historisch gesperrt (PHASE_MISMATCH), Historie wird nie umgeschrieben.
 */
export async function setRunPhase(input: {
  runId: number;
  userId: number;
  phase: Exclude<RunPhase, "result">;
}): Promise<VillaTestRun> {
  const db = await requireDb();
  return db.transaction(async tx => {
    const [run] = await tx
      .select()
      .from(villaTestRuns)
      .where(
        and(
          eq(villaTestRuns.id, input.runId),
          eq(villaTestRuns.actorId, input.userId)
        )
      )
      .for("update");
    if (!run) throw new TestRunError("NOT_FOUND");

    if (run.status !== "running") throw new TestRunError("PHASE_MISMATCH");

    const current = run.phase as RunPhase;
    if (current === "result") throw new TestRunError("PHASE_MISMATCH");
    if (current === input.phase) return run;

    const vonIndex = RUN_PHASE_ORDER.indexOf(
      current as Exclude<RunPhase, "result">
    );
    const nachIndex = RUN_PHASE_ORDER.indexOf(input.phase);
    if (vonIndex < 0 || nachIndex < 0 || nachIndex !== vonIndex + 1) {
      throw new TestRunError("PHASE_MISMATCH");
    }

    const rows = await tx
      .update(villaTestRuns)
      .set({ phase: input.phase })
      .where(eq(villaTestRuns.id, run.id))
      .returning();
    return rows[0];
  });
}

/**
 * Sprint 025 — Ereignis an das Live-Protokoll eines LAUFENDEN Testlaufs
 * anhängen. Abgeschlossene Läufe nehmen keine Ereignisse mehr auf
 * (STATUS_MISMATCH) — die Historie bleibt unverändert. Ownership läuft über
 * die Villa; fremde Läufe sind NOT_FOUND.
 */
export async function appendRunEvent(input: {
  runId: number;
  userId: number;
  level: RunEventLevel;
  message: string;
}): Promise<VillaRunEvent> {
  const db = await requireDb();
  return db.transaction(async tx => {
    const rows = await tx
      .select({ run: villaTestRuns })
      .from(villaTestRuns)
      .innerJoin(villas, eq(villaTestRuns.villaId, villas.id))
      .where(
        and(
          eq(villaTestRuns.id, input.runId),
          eq(villas.createdBy, input.userId)
        )
      )
      .limit(1)
      .for("update");
    const run = rows[0]?.run;
    if (!run) throw new TestRunError("NOT_FOUND");
    if (run.status !== "running") throw new TestRunError("STATUS_MISMATCH");

    const [event] = await tx
      .insert(villaRunEvents)
      .values({
        runId: run.id,
        level: input.level,
        message: input.message,
      })
      .returning();
    return event;
  });
}

/**
 * Sprint 025 — Live-Protokoll eines Laufs lesen: die letzten lokalen
 * Ereignisse, neueste zuerst, begrenzt. Nur eigene Läufe (Ownership über die
 * Villa); abgeschlossene Läufe bleiben lesbar.
 */
export async function listRunEvents(
  runId: number,
  userId: number,
  limit?: number
): Promise<VillaRunEvent[]> {
  const db = await requireDb();
  const boundedLimit = Math.max(
    1,
    Math.min(limit ?? RUN_EVENT_PAGE_SIZE_MAX, RUN_EVENT_PAGE_SIZE_MAX)
  );
  const rows = await db
    .select({ event: villaRunEvents })
    .from(villaRunEvents)
    .innerJoin(villaTestRuns, eq(villaRunEvents.runId, villaTestRuns.id))
    .innerJoin(villas, eq(villaTestRuns.villaId, villas.id))
    .where(
      and(
        eq(villaRunEvents.runId, runId),
        eq(villas.createdBy, userId)
      )
    )
    .orderBy(desc(villaRunEvents.createdAt))
    .limit(boundedLimit)
    .then(rows => rows.map(row => row.event));
  return rows;
}
