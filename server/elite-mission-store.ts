import { randomUUID } from "node:crypto";
import { and, desc, eq, lt, notInArray, sql } from "drizzle-orm";
import { eliteMissionRuns, type EliteMissionRun } from "../drizzle/schema";
import { getDb } from "./db";

export type SavedMissionInput = {
  prompt: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  mode: "workshop";
  specialty: string;
  systemOverride?: string | null;
};

const activeRuns = new Set<number>();
const LEASE_MS = 90_000;

async function requiredDb() {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  return db;
}

export async function interruptExpiredRuns(): Promise<void> {
  const db = await requiredDb();
  const now = new Date();
  await db.update(eliteMissionRuns).set({ status: "interrupted", updatedAt: now })
    .where(and(eq(eliteMissionRuns.status, "running"), lt(eliteMissionRuns.leaseUntil, now),
      activeRuns.size ? notInArray(eliteMissionRuns.id, Array.from(activeRuns)) : undefined));
}

export async function reserveMission(input: {
  userId: number;
  idempotencyKey: string;
  requestHash: string;
  missionInput: SavedMissionInput;
}): Promise<{ run: EliteMissionRun; created: boolean }> {
  const db = await requiredDb();
  const [created] = await db.insert(eliteMissionRuns).values({
    userId: input.userId,
    idempotencyKey: input.idempotencyKey,
    requestHash: input.requestHash,
    input: input.missionInput,
    status: "running",
    ownerId: randomUUID(),
    leaseUntil: new Date(Date.now() + LEASE_MS),
  }).onConflictDoNothing().returning();
  if (created) {
    activeRuns.add(created.id);
    return { run: created, created: true };
  }
  await interruptExpiredRuns();
  const [existing] = await db.select().from(eliteMissionRuns)
    .where(and(eq(eliteMissionRuns.userId, input.userId), eq(eliteMissionRuns.idempotencyKey, input.idempotencyKey))).limit(1);
  if (!existing) throw new Error("MISSION_RESERVATION_UNAVAILABLE");
  return { run: existing, created: false };
}

export async function listMissionRuns(userId: number): Promise<EliteMissionRun[]> {
  await interruptExpiredRuns();
  const db = await requiredDb();
  return db.select().from(eliteMissionRuns).where(eq(eliteMissionRuns.userId, userId))
    .orderBy(desc(eliteMissionRuns.createdAt)).limit(30);
}

export async function getMissionRun(id: number, userId: number): Promise<EliteMissionRun | undefined> {
  await interruptExpiredRuns();
  const db = await requiredDb();
  const [run] = await db.select().from(eliteMissionRuns)
    .where(and(eq(eliteMissionRuns.id, id), eq(eliteMissionRuns.userId, userId))).limit(1);
  return run;
}

export async function findMissionByKey(userId: number, idempotencyKey: string): Promise<EliteMissionRun | undefined> {
  await interruptExpiredRuns();
  const db = await requiredDb();
  const [run] = await db.select().from(eliteMissionRuns)
    .where(and(eq(eliteMissionRuns.userId, userId), eq(eliteMissionRuns.idempotencyKey, idempotencyKey))).limit(1);
  return run;
}

export async function restartInterruptedMission(id: number, userId: number): Promise<EliteMissionRun | undefined> {
  await interruptExpiredRuns();
  if (activeRuns.has(id)) return undefined;
  const db = await requiredDb();
  const now = new Date();
  const [run] = await db.update(eliteMissionRuns).set({
    status: "running", ownerId: randomUUID(), leaseUntil: new Date(now.getTime() + LEASE_MS),
    attempt: sql`${eliteMissionRuns.attempt} + 1`,
    updatedAt: now, errorCode: null, result: null, finishedAt: null,
  }).where(and(eq(eliteMissionRuns.id, id), eq(eliteMissionRuns.userId, userId), eq(eliteMissionRuns.status, "interrupted"))).returning();
  if (!run) return undefined;
  activeRuns.add(run.id);
  return run;
}

export async function renewMissionLease(run: EliteMissionRun): Promise<boolean> {
  const db = await requiredDb();
  const [updated] = await db.update(eliteMissionRuns).set({ leaseUntil: new Date(Date.now() + LEASE_MS), updatedAt: new Date() })
    .where(and(eq(eliteMissionRuns.id, run.id), eq(eliteMissionRuns.ownerId, run.ownerId), eq(eliteMissionRuns.status, "running")))
    .returning({ id: eliteMissionRuns.id });
  return Boolean(updated);
}

export async function finishMission(run: EliteMissionRun, result: unknown, errorCode?: string): Promise<void> {
  try {
    const db = await requiredDb();
    const [updated] = await db.update(eliteMissionRuns).set({
      status: errorCode ? "failed" : "completed",
      result: errorCode ? null : result,
      errorCode: errorCode ?? null,
      updatedAt: new Date(), finishedAt: new Date(),
    }).where(and(eq(eliteMissionRuns.id, run.id), eq(eliteMissionRuns.ownerId, run.ownerId), eq(eliteMissionRuns.status, "running")))
      .returning({ id: eliteMissionRuns.id });
    if (!updated) throw new Error("MISSION_OWNERSHIP_LOST");
  } finally {
    activeRuns.delete(run.id);
  }
}

export function releaseActiveMission(id: number) {
  activeRuns.delete(id);
}

export function missionLeaseIntervalMs() { return 20_000; }
