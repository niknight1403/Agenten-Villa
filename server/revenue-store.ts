/**
 * Sprint 103 / Master-Prompt Abschnitt 4 — Revenue- & Loop-Store (DB-Layer).
 *
 * DB-Funktionen nach dem villa-store-Muster. Der Master-Loop protokolliert
 * jeden Phasenlauf in executive_loop_runs; Revenue-Discovery speichert
 * Signale und Hypothesen. Freigabe-Übergänge (approve/reject/deploy/scale)
 * laufen ausschliesslich über die Admin-Router-Endpunkte.
 */

import { eq, desc, and } from "drizzle-orm";
import { getDb } from "./db";
import {
  revenueSignals,
  revenueHypotheses,
  executiveLoopRuns,
  type RevenueSignal,
  type RevenueHypothesis,
  type ExecutiveLoopRun,
} from "../drizzle/schema";
import {
  validSignal,
  discoveryPeriod,
  deriveHypotheses,
  summarizeSignals,
  nextHypothesisStatus,
  type SignalSource,
  type HypothesisDraft,
} from "./revenue-discovery";
import { runPhase, type LoopPhase, type PhaseContext } from "./executive-loop";

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("Datenbank nicht verfuegbar.");
  return db;
}

/* ---------------- Signale ---------------- */

/** Signale der aktuellen Periode erfassen (ungueltige werden abgewiesen). */
export async function recordSignals(
  inputs: { source: SignalSource; key: string; value: number; period?: string }[]
): Promise<number> {
  const db = await requireDb();
  const period = discoveryPeriod();
  const valid = inputs.filter((i) =>
    validSignal({ source: i.source, key: i.key, value: i.value, period: i.period ?? period })
  );
  if (valid.length === 0) return 0;
  await db.insert(revenueSignals).values(
    valid.map((i) => ({ source: i.source, key: i.key, value: i.value, period: i.period ?? period }))
  );
  return valid.length;
}

/** Signale einer Periode abrufen (Default: aktuelle). */
export async function listSignals(period = discoveryPeriod()): Promise<RevenueSignal[]> {
  const db = await requireDb();
  return db.select().from(revenueSignals).where(eq(revenueSignals.period, period));
}

/* ---------------- Hypothesen ---------------- */

export async function listHypotheses(status?: RevenueHypothesis["status"]): Promise<RevenueHypothesis[]> {
  const db = await requireDb();
  const rows = status
    ? await db.select().from(revenueHypotheses).where(eq(revenueHypotheses.status, status)).orderBy(desc(revenueHypotheses.score))
    : await db.select().from(revenueHypotheses).orderBy(desc(revenueHypotheses.score));
  return rows;
}

/** Offene Draft-Zaehler (fuer Loop-Phase 'hypothesize'). */
export async function countDraftHypotheses(): Promise<number> {
  const db = await requireDb();
  const rows = await db.select({ id: revenueHypotheses.id }).from(revenueHypotheses).where(eq(revenueHypotheses.status, "draft"));
  return rows.length;
}

/**
 * Hypothesen aus dem aktuellen Quellenbild ableiten und als Drafts anlegen.
 * Duplikate (gleicher Titel) werden uebersprungen — idempotent pro Titel.
 */
export async function generateHypotheses(options: {
  tradingSimGatePassed?: boolean;
}): Promise<{ created: HypothesisDraft[]; skipped: number }> {
  const db = await requireDb();
  const signals = await listSignals();
  const summary = summarizeSignals(signals);
  const drafts = deriveHypotheses(summary, {
    tradingSimGatePassed: options.tradingSimGatePassed,
  });
  const existing = await db.select({ title: revenueHypotheses.title }).from(revenueHypotheses);
  const known = new Set(existing.map((r) => r.title));
  const fresh = drafts.filter((d) => !known.has(d.title));
  if (fresh.length > 0) {
    await db.insert(revenueHypotheses).values(fresh.map((d) => ({ ...d, status: "draft" as const })));
  }
  return { created: fresh, skipped: drafts.length - fresh.length };
}

/** Admin-Entscheidung: approve/reject/deploy/scale/park mit Statusmaschine. */
export async function decideHypothesis(
  id: number,
  adminUserId: number,
  event: "approve" | "reject" | "deploy" | "scale" | "park"
): Promise<RevenueHypothesis | null> {
  const db = await requireDb();
  const current = (await db.select().from(revenueHypotheses).where(eq(revenueHypotheses.id, id)).limit(1))[0];
  if (!current) return null;
  let next: RevenueHypothesis["status"];
  try {
    next = nextHypothesisStatus(current.status, event);
  } catch (error) {
    throw new Error((error as Error).message);
  }
  const [row] = await db
    .update(revenueHypotheses)
    .set({ status: next, reviewedBy: adminUserId })
    .where(eq(revenueHypotheses.id, id))
    .returning();
  return row ?? null;
}

/* ---------------- Loop-Protokoll ---------------- */

export async function listLoopRuns(limit = 50): Promise<ExecutiveLoopRun[]> {
  const db = await requireDb();
  const rows = await db.select().from(executiveLoopRuns).orderBy(desc(executiveLoopRuns.startedAt)).limit(Math.min(limit, 200));
  return rows;
}

/** Einen Phasenlauf protokollieren (ein Datensatz pro Tick und Phase). */
export async function logLoopRun(
  phase: LoopPhase,
  outcome: ExecutiveLoopRun["outcome"],
  note: string,
  hypothesisId?: number
): Promise<void> {
  const db = await requireDb();
  await db.insert(executiveLoopRuns).values({ phase, outcome, note, ...(hypothesisId ? { hypothesisId } : {}) });
}

/**
 * Ein autonomer Loop-Tick: fuehrt die Phase aus, protokolliert sie und
 * liefert das Ergebnis. Deploy-Phase wird autonom NIE ausgefuehrt —
 * sie wird als needs_admin protokolliert und wartet auf den Admin.
 */
export async function executiveLoopTick(
  ctx: PhaseContext,
  phase: LoopPhase
): Promise<{ phase: LoopPhase; outcome: ExecutiveLoopRun["outcome"]; note: string; next: LoopPhase }> {
  // Autonomie-Grenze: deploy nur via Admin-Endpunkt (authorized bleibt false).
  const result = phase === "deploy" ? runPhase("deploy", ctx, false) : runPhase(phase, ctx);
  await logLoopRun(result.phase, result.outcome, result.note);
  return { phase: result.phase, outcome: result.outcome, note: result.note, next: result.next };
}

export { and };
