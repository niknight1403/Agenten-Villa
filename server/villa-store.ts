import { and, asc, desc, eq } from "drizzle-orm";
import type { Villa, VillaMessage } from "../drizzle/schema";
import { getDb } from "./db";
import { villaMessages, villas } from "../drizzle/schema";

function requireDb() {
  return getDb();
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
}): Promise<Villa> {
  const db = await requireDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  const result = await db.insert(villas).values(input);
  const insertId = Number((result as unknown as { insertId: number | bigint }).insertId);
  const created = await db.select().from(villas).where(eq(villas.id, insertId)).limit(1);
  return created[0];
}

export async function updateVilla(
  villaId: number,
  userId: number,
  patch: { name?: string; specialty?: string }
): Promise<Villa | undefined> {
  const db = await requireDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  const set: Record<string, string> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.specialty !== undefined) set.specialty = patch.specialty;
  if (Object.keys(set).length === 0) return undefined;
  const result = await db
    .update(villas)
    .set(set)
    .where(and(eq(villas.id, villaId), eq(villas.createdBy, userId)));
  if (Number((result as unknown as { rowsAffected: number | bigint }).rowsAffected) === 0) {
    return undefined;
  }
  const rows = await db.select().from(villas).where(eq(villas.id, villaId)).limit(1);
  return rows[0];
}

export async function deleteVilla(villaId: number, userId: number): Promise<boolean> {
  const db = await requireDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  const result = await db
    .delete(villas)
    .where(and(eq(villas.id, villaId), eq(villas.createdBy, userId)));
  const affected = Number((result as unknown as { rowsAffected: number | bigint }).rowsAffected);
  if (affected > 0) {
    await db.delete(villaMessages).where(eq(villaMessages.villaId, villaId));
  }
  return affected > 0;
}

export async function listMessages(villaId: number, userId: number, limit = 200): Promise<VillaMessage[]> {
  const db = await requireDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  const owned = await db
    .select({ id: villas.id })
    .from(villas)
    .where(and(eq(villas.id, villaId), eq(villas.createdBy, userId)))
    .limit(1);
  if (owned.length === 0) return [];
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
  const owned = await db
    .select({ id: villas.id })
    .from(villas)
    .where(and(eq(villas.id, villaId), eq(villas.createdBy, userId)))
    .limit(1);
  if (owned.length === 0) return [];
  if (entries.length === 0) return [];
  const inserted = await db
    .insert(villaMessages)
    .values(entries.map((entry) => ({ ...entry, villaId })));
  const insertId = Number((inserted as unknown as { insertId: number | bigint }).insertId);
  const rows = await db
    .select()
    .from(villaMessages)
    .where(and(eq(villaMessages.villaId, villaId), eq(villaMessages.id, insertId)))
    .limit(entries.length);
  return rows.sort((a, b) => a.id - b.id);
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
