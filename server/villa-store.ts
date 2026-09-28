import { and, asc, desc, eq } from "drizzle-orm";
import type { Villa, VillaEvent, VillaMessage } from "../drizzle/schema";
import { getDb } from "./db";
import { villaEvents, villaMessages, villas } from "../drizzle/schema";

function requireDb() {
  return getDb();
}

/**
 * Sprint 011 — zentraler Ownership-Guard: Jede villa-bezogene Operation
 * muss diesen Check durchlaufen, damit Nutzer ausschließlich berechtigte
 * Villen lesen oder ändern können.
 */
async function isOwnedVilla(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  villaId: number,
  userId: number
): Promise<boolean> {
  const rows = await db
    .select({ id: villas.id })
    .from(villas)
    .where(and(eq(villas.id, villaId), eq(villas.createdBy, userId)))
    .limit(1);
  return rows.length > 0;
}

export async function listVillas(userId: number): Promise<Villa[]> {
  const db = await requireDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  return db.select().from(villas).where(eq(villas.createdBy, userId)).orderBy(asc(villas.createdAt));
}

export async function createVilla(input: {
  createdBy: number;
  name: string;
  specialty: string;
  icon: "villa" | "bot";
  projectBrief?: string | null;
  description?: string | null;
  capacity?: number;
}): Promise<Villa> {
  const db = await requireDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  return db.transaction(async tx => {
    const [created] = await tx.insert(villas).values(input).returning();
    await tx.insert(villaEvents).values({
      villaId: created.id,
      actorId: input.createdBy,
      action: "created",
      detail: JSON.stringify({ name: created.name, icon: created.icon }),
    });
    return created;
  });
}

/**
 * Sprint 013 — Audit-Eintrag innerhalb derselben Transaktion wie die Änderung.
 */
async function recordVillaEvent(
  tx: Parameters<Parameters<NonNullable<Awaited<ReturnType<typeof getDb>>>["transaction"]>[0]>[0] extends infer T ? T : never,
  villaId: number,
  actorId: number,
  action: string,
  detail: Record<string, unknown>
): Promise<void> {
  await tx.insert(villaEvents).values({
    villaId,
    actorId,
    action,
    detail: JSON.stringify(detail),
  });
}

export async function getVilla(villaId: number, userId: number): Promise<Villa | undefined> {
  const db = await requireDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  if (!(await isOwnedVilla(db, villaId, userId))) return undefined;
  const [villa] = await db.select().from(villas)
    .where(eq(villas.id, villaId)).limit(1);
  return villa;
}

export async function updateVilla(
  villaId: number,
  userId: number,
  patch: {
    name?: string;
    specialty?: string;
    description?: string | null;
    capacity?: number;
  }
): Promise<Villa | undefined> {
  const db = await requireDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  const set: Record<string, string | number | null> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.specialty !== undefined) set.specialty = patch.specialty;
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.capacity !== undefined) set.capacity = patch.capacity;
  if (Object.keys(set).length === 0) return undefined;
  return db.transaction(async tx => {
    const owned = await tx.select().from(villas)
      .where(and(eq(villas.id, villaId), eq(villas.createdBy, userId)))
      .for("update");
    if (owned.length === 0) return undefined;
    const rows = await tx.update(villas).set(set).where(eq(villas.id, villaId)).returning();
    await recordVillaEvent(tx, villaId, userId, "updated", { fields: Object.keys(set), values: set });
    return rows[0];
  });
}

export async function deleteVilla(villaId: number, userId: number): Promise<boolean> {
  const db = await requireDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  // A single transaction keeps the workspace and its history together if a
  // delete fails. Lock the owned villa so messages cannot be appended midway.
  return db.transaction(async tx => {
    const owned = await tx.select({ id: villas.id }).from(villas)
      .where(and(eq(villas.id, villaId), eq(villas.createdBy, userId)))
      .for("update");
    if (!owned.length) return false;
    await recordVillaEvent(tx, villaId, userId, "deleted", { messagesRemoved: true });
    await tx.delete(villaMessages).where(eq(villaMessages.villaId, villaId));
    const deleted = await tx.delete(villas)
      .where(and(eq(villas.id, villaId), eq(villas.createdBy, userId))).returning({ id: villas.id });
    return deleted.length > 0;
  });
}

export async function listVillaEvents(
  villaId: number,
  userId: number,
  limit = 50
): Promise<VillaEvent[]> {
  const db = await requireDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  if (!(await isOwnedVilla(db, villaId, userId))) return [];
  return db.select().from(villaEvents)
    .where(eq(villaEvents.villaId, villaId))
    .orderBy(desc(villaEvents.id))
    .limit(limit);
}

export async function listMessages(villaId: number, userId: number, limit = 200): Promise<VillaMessage[]> {
  const db = await requireDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  if (!(await isOwnedVilla(db, villaId, userId))) return [];
  return db
    .select()
    .from(villaMessages)
    .where(eq(villaMessages.villaId, villaId))
    .orderBy(desc(villaMessages.id))
    .limit(limit);
}

export async function appendMessages(
  villaId: number,
  userId: number,
  entries: {
    role: "user" | "assistant";
    content: string;
    provider?: string | null;
    model?: string | null;
  }[]
): Promise<VillaMessage[]> {
  const db = await requireDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  if (entries.length === 0) return [];
  if (!(await isOwnedVilla(db, villaId, userId))) return [];
  return db
    .insert(villaMessages)
    .values(entries.map((entry) => ({ ...entry, villaId })))
    .returning();
}

export async function rateMessage(
  messageId: number,
  userId: number,
  rating: -1 | 1
): Promise<VillaMessage | undefined> {
  const db = await requireDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  const rows = await db
    .select({ message: villaMessages, ownerId: villas.createdBy })
    .from(villaMessages)
    .innerJoin(villas, eq(villaMessages.villaId, villas.id))
    .where(eq(villaMessages.id, messageId))
    .limit(1);
  const row = rows[0];
  if (!row || row.ownerId !== userId || row.message.role !== "assistant") return undefined;
  await db.update(villaMessages).set({ rating }).where(eq(villaMessages.id, messageId));
  return { ...row.message, rating };
}
