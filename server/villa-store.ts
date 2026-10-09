import { sanitizeVillaExport } from "./villa-export";
import { templateToVillaInput } from "./templates";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { LimitConfig, Villa, VillaEvent, VillaMessage } from "../drizzle/schema";
import { getDb } from "./db";
import { limitConfigs, villaEvents, villaMessages, villas } from "../drizzle/schema";

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

type VillaTx = Parameters<Parameters<NonNullable<Awaited<ReturnType<typeof getDb>>>["transaction"]>[0]>[0];

/** Sprint 017 — Villa-Limit überschritten (wird zu FORBIDDEN gemappt). */
export class VillaLimitError extends Error {
  constructor(public readonly maxVillas: number) {
    super(`VILLA_LIMIT_REACHED:${maxVillas}`);
  }
}

/**
 * Sprint 017 — Limit-Konfiguration des Nutzers lesen (lazy, Standard 20).
 */
export async function getLimitConfig(userId: number, tx?: VillaTx): Promise<{ maxVillas: number }> {
  if (tx) {
    const [rowTx] = await tx.select().from(limitConfigs)
      .where(eq(limitConfigs.userId, userId))
      .limit(1);
    return rowTx ? { maxVillas: rowTx.maxVillas } : { maxVillas: 20 };
  }
  const db = await requireDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  const [row] = await db.select().from(limitConfigs)
    .where(eq(limitConfigs.userId, userId))
    .limit(1);
  return row ? { maxVillas: row.maxVillas } : { maxVillas: 20 };
}

/**
 * Sprint 017 — Limit-Konfiguration setzen (Upsert, Admin-gesteuert).
 */
export async function setLimitConfig(userId: number, maxVillas: number): Promise<LimitConfig> {
  const db = await requireDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  const [row] = await db
    .insert(limitConfigs)
    .values({ userId, maxVillas })
    .onConflictDoUpdate({
      target: limitConfigs.userId,
      set: { maxVillas },
    })
    .returning();
  return row;
}

/**
 * Sprint 017 — Aktive Villa-Anzahl inkl. erzwingtem Limit.
 * Wirft VillaLimitError, wenn das Limit erreicht ist.
 */
export async function assertVillaCapacity(userId: number, tx: VillaTx): Promise<void> {
  const config = await getLimitConfig(userId, tx);
  const owned = await tx.select({ id: villas.id }).from(villas)
    .where(eq(villas.createdBy, userId));
  if (owned.length >= config.maxVillas) {
    throw new VillaLimitError(config.maxVillas);
  }
}

export async function createVilla(input: {
  createdBy: number;
  name: string;
  specialty: string;
  icon: "villa" | "bot";
  projectBrief?: string | null;
  description?: string | null;
  capacity?: number;
  repository?: string | null;
}): Promise<Villa> {
  const db = await requireDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  return db.transaction(async tx => {
    await assertVillaCapacity(input.createdBy, tx);
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
 * Default workspace for a user who has none yet, so the chat is usable
 * immediately after sign-in. It is a normal villa (same limits and audit
 * trail) preconfigured for project development with the superagent.
 */
export const STARTER_VILLA = {
  name: "Projekt-Villa",
  specialty: "Projektentwicklung",
  icon: "villa" as const,
  capacity: 8,
  description: "Start-Villa für die Projektentwicklung mit dem Superagenten.",
  projectBrief:
    "Entwickle ein neues Softwareprojekt Schritt für Schritt: analysiere die Anforderungen, entwirf eine Architektur, implementiere die Kernfunktionen und liefere Tests sowie Dokumentation.",
} as const;

export async function ensureStarterVilla(userId: number): Promise<Villa> {
  return createVilla({ createdBy: userId, ...STARTER_VILLA });
}


/**
 * Sprint 091 — Villa aus einer Projektvorlage anlegen.
 * Nutzt dieselbe createVilla-Funktion, sodass Limits und Audit-Spur
 * identisch sind wie bei manuell angelegten Villen.
 */
export async function createVillaFromTemplate(
  userId: number,
  templateId: string,
): Promise<Villa> {
  const input = templateToVillaInput(templateId);
  return createVilla({ createdBy: userId, ...input });
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
    repository?: string | null;
  }
): Promise<Villa | undefined> {
  const db = await requireDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  const set: Record<string, string | number | null> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.specialty !== undefined) set.specialty = patch.specialty;
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.capacity !== undefined) set.capacity = patch.capacity;
  if (patch.repository !== undefined) set.repository = patch.repository;
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

/**
 * Sprint 014 — Villa archivieren bzw. wiederherstellen. Archivierte Villen
 * starten keine neuen Läufe und nehmen keine neuen Nachrichten an.
 */
export async function setVillaArchived(
  villaId: number,
  userId: number,
  archived: boolean
): Promise<Villa | undefined> {
  const db = await requireDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  return db.transaction(async tx => {
    const owned = await tx.select({ id: villas.id }).from(villas)
      .where(and(eq(villas.id, villaId), eq(villas.createdBy, userId)))
      .for("update");
    if (owned.length === 0) return undefined;
    const rows = await tx
      .update(villas)
      .set(archived ? { archivedAt: new Date() } : { archivedAt: null })
      .where(eq(villas.id, villaId))
      .returning();
    await recordVillaEvent(tx, villaId, userId, archived ? "archived" : "unarchived", { archived });
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

/**
 * Sprint 018 — Villa als portables JSON exportieren (villa + Verlauf,
 * ohne sensible Metadaten).
 */
export type VillaActivity = {
  villaId: number;
  name: string;
  archived: boolean;
  capacity: number;
  messageCount: number;
  lastActiveAt: Date | null;
};

/**
 * Sprint 019 — Aktivitätsübersicht aller Villen des Nutzers: nur
 * aggregierte Zähler und Zeitstempel, kein Nachrichteninhalt.
 */
export async function villaActivity(userId: number): Promise<VillaActivity[]> {
  const db = await requireDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  const rows = await db
    .select({
      villaId: villas.id,
      name: villas.name,
      archivedAt: villas.archivedAt,
      capacity: villas.capacity,
      messageCount: sql<number>`count(${villaMessages.id})::int`,
      lastActiveAt: sql<Date | null>`max(${villaMessages.createdAt})`,
    })
    .from(villas)
    .leftJoin(villaMessages, eq(villaMessages.villaId, villas.id))
    .where(eq(villas.createdBy, userId))
    .groupBy(villas.id, villas.name, villas.archivedAt, villas.capacity)
    .orderBy(desc(sql`max(${villaMessages.createdAt})`));
  return rows.map(row => ({
    villaId: row.villaId,
    name: row.name,
    archived: row.archivedAt !== null,
    capacity: row.capacity,
    messageCount: row.messageCount,
    lastActiveAt: row.lastActiveAt ? new Date(row.lastActiveAt) : null,
  }));
}

export async function exportVilla(
  villaId: number,
  userId: number
): Promise<{
  name: string;
  specialty: string;
  icon: "villa" | "bot";
  projectBrief: string | null;
  description: string | null;
  capacity: number;
  messages: { role: "user" | "assistant"; content: string; createdAt: Date }[];
  exportedAt: Date;
  version: 1;
} | undefined> {
  const db = await requireDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  if (!(await isOwnedVilla(db, villaId, userId))) return undefined;
  const [villa] = await db.select().from(villas).where(eq(villas.id, villaId)).limit(1);
  if (!villa) return undefined;
  const messages = await db.select().from(villaMessages)
    .where(eq(villaMessages.villaId, villaId))
    .orderBy(asc(villaMessages.id));
  // Sprint 057 — Export-Schutz: versionierte Whitelist-Redaktion vor der
  // Rueckgabe; interne Felder koennen den Server nicht verlassen.
  return sanitizeVillaExport({
    name: villa.name,
    specialty: villa.specialty,
    icon: villa.icon,
    projectBrief: villa.projectBrief,
    description: villa.description,
    capacity: villa.capacity,
    messages: messages.map(m => ({
      role: m.role as string,
      content: m.content,
      createdAt: m.createdAt,
    })),
    exportedAt: new Date(),
    version: 1,
  });
}

/**
 * Sprint 018 — Villa aus einem Export anlegen: Kapazität erzwingen,
 * Nachrichten übernehmen und Audit-Eintrag schreiben.
 */
export async function importVilla(
  userId: number,
  payload: {
    name: string;
    specialty: string;
    icon: "villa" | "bot";
    projectBrief?: string | null;
    description?: string | null;
    capacity: number;
    messages: { role: "user" | "assistant"; content: string }[];
  }
): Promise<Villa | undefined> {
  const db = await requireDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  return db.transaction(async tx => {
    await assertVillaCapacity(userId, tx);
    const [created] = await tx.insert(villas).values({
      createdBy: userId,
      name: payload.name,
      specialty: payload.specialty,
      icon: payload.icon,
      ...(payload.projectBrief ? { projectBrief: payload.projectBrief } : {}),
      ...(payload.description ? { description: payload.description } : {}),
      capacity: payload.capacity,
    }).returning();
    if (payload.messages.length > 0) {
      await tx.insert(villaMessages).values(
        payload.messages.map(m => ({
          villaId: created.id,
          role: m.role,
          content: m.content,
        }))
      );
    }
    await recordVillaEvent(tx, created.id, userId, "imported", {
      messages: payload.messages.length,
    });
    return created;
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
