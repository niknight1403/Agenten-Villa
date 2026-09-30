import { and, desc, eq } from "drizzle-orm";
import type { VillaTestRun } from "../drizzle/schema";
import { getDb } from "./db";
import { villaTestRuns, villas } from "../drizzle/schema";

/** Sprint 021 — Lebenszyklus eines begrenzten Villa-Testlaufs. */
export type TestRunStatus = "running" | "succeeded" | "failed" | "cancelled";

/** Technische Gründe, die ein Store-Ergebnis verhindern; der Router mappt sie auf tRPC-Codes. */
export class TestRunError extends Error {
  constructor(
    readonly reason:
      "NOT_FOUND" | "ARCHIVED" | "ACTIVE_RUN_EXISTS" | "NOT_ACTIVE"
  ) {
    super(`TEST_RUN_${reason}`);
  }
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  return db;
}

const RUN_PAGE_SIZE_MAX = 50;

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
 * Sprint 021 — Begrenzten Testlauf starten: maximal EIN aktiver Lauf pro Villa,
 * archivierte Villen starten keine Läufe. Status und Startzeit werden sofort
 * persistiert, damit der Lauf Neustarts überlebt.
 */
export async function startTestRun(
  villaId: number,
  userId: number
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
      .select({ id: villaTestRuns.id })
      .from(villaTestRuns)
      .where(
        and(
          eq(villaTestRuns.villaId, villaId),
          eq(villaTestRuns.status, "running")
        )
      )
      .limit(1);
    if (active) throw new TestRunError("ACTIVE_RUN_EXISTS");

    const [created] = await tx
      .insert(villaTestRuns)
      .values({
        villaId,
        actorId: userId,
        status: "running",
      })
      .returning();
    return created;
  });
}

/**
 * Sprint 021 — Lauf abschließen: Status, Endzeit und Ergebnis persistieren.
 * Nur laufende Läufe können abgeschlossen werden; wiederholte Abschlüsse
 * bleiben konsistent (NOT_ACTIVE, kein Überschreiben).
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
    if (run.status !== "running") throw new TestRunError("NOT_ACTIVE");

    const rows = await tx
      .update(villaTestRuns)
      .set({
        status: input.status,
        endedAt: new Date(),
        result: input.result === undefined ? null : input.result,
        errorCode: input.errorCode ?? null,
      })
      .where(eq(villaTestRuns.id, run.id))
      .returning();
    return rows[0];
  });
}
