/**
 * Sprint 103 / Master-Prompt Abschnitt 3.1 — Persona-Store (DB-Layer).
 *
 * DB-Funktionen nach dem villa-store-Muster: Transparenz-Pflicht wird beim
 * Schreiben erzwungen (validatePersona), nicht erst beim Lesen. Seed legt
 * die drei Start-Personas einmalig an (idempotent).
 */

import { eq, and, desc } from "drizzle-orm";
import { getDb } from "./db";
import {
  personas,
  personaAssets,
  contentSlots,
  type Persona,
  type PersonaAsset,
  type ContentSlot,
} from "../drizzle/schema";
import {
  validatePersona,
  PersonaDisclosureError,
  seedPersonas,
} from "./persona-dossier";

/** Aktiviert DB-Zugriff; wirft, wenn die DB nicht verfuegbar ist. */
async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("Datenbank nicht verfuegbar.");
  return db;
}

/** Alle aktiven Personas (fuer Scheduler und API). */
export async function listPersonas(): Promise<Persona[]> {
  const db = await requireDb();
  return db.select().from(personas).orderBy(personas.id);
}

/** Persona nach Handle. */
export async function getPersonaByHandle(handle: string): Promise<Persona | null> {
  const db = await requireDb();
  const rows = await db.select().from(personas).where(eq(personas.handle, handle)).limit(1);
  return rows[0] ?? null;
}

/** Persona anlegen — mit erzwungener AI-Kennzeichnung. */
export async function createPersona(input: {
  handle: string;
  displayName: string;
  tagline?: string;
  styleguide?: string;
  characterSheet?: Record<string, unknown>;
  systemPrompt: string;
  themes: string[];
  channels: string[];
}): Promise<Persona> {
  validatePersona({
    handle: input.handle.toLowerCase(),
    displayName: input.displayName,
    systemPrompt: input.systemPrompt,
    aiDisclosure: true,
    themes: input.themes,
    channels: input.channels,
  });
  const db = await requireDb();
  const [row] = await db
    .insert(personas)
    .values({
      handle: input.handle.toLowerCase(),
      displayName: input.displayName,
      tagline: input.tagline ?? "",
      styleguide: input.styleguide ?? "",
      characterSheet: input.characterSheet ?? {},
      systemPrompt: input.systemPrompt,
      themes: input.themes,
      channels: input.channels,
      aiDisclosure: true, // strukturell, nicht abschaltbar
    })
    .returning();
  return row;
}

/** Persona aktualisieren — System-Prompt-Aenderung wird erneut geprueft. */
export async function updatePersona(
  id: number,
  patch: Partial<Pick<Persona, "displayName" | "tagline" | "styleguide" | "systemPrompt" | "themes" | "channels" | "active">>
): Promise<Persona | null> {
  const db = await requireDb();
  const current = (await db.select().from(personas).where(eq(personas.id, id)).limit(1))[0];
  if (!current) return null;
  const next = { ...current, ...patch };
  validatePersona({
    handle: current.handle,
    displayName: next.displayName,
    systemPrompt: next.systemPrompt,
    aiDisclosure: true,
    themes: next.themes,
    channels: next.channels,
  });
  const [row] = await db.update(personas).set(patch).where(eq(personas.id, id)).returning();
  return row ?? null;
}

/** Idempotenter Seed der drei Start-Personas (nur fehlende anlegen). */
export async function seedPersonasIfMissing(): Promise<{ seeded: number; existing: number }> {
  const db = await requireDb();
  const existing = await db.select({ handle: personas.handle }).from(personas);
  const known = new Set(existing.map((row) => row.handle));
  const missing = seedPersonas().filter((p) => !known.has(p.handle));
  if (missing.length > 0) {
    await db.insert(personas).values(missing);
  }
  return { seeded: missing.length, existing: known.size };
}

/* ------------------------------------------------------------------ */
/* Asset-Pipeline                                                      */
/* ------------------------------------------------------------------ */

export async function listAssets(personaId?: number): Promise<PersonaAsset[]> {
  const db = await requireDb();
  const query = db.select().from(personaAssets);
  const rows = personaId
    ? await query.where(eq(personaAssets.personaId, personaId)).orderBy(personaAssets.id)
    : await query.orderBy(personaAssets.id);
  return rows;
}

/** Asset-Job anlegen (Status 'pending'). */
export async function createAssetJob(input: {
  personaId: number;
  kind: "image" | "text" | "style";
  prompt: string;
}): Promise<PersonaAsset> {
  const db = await requireDb();
  const [row] = await db
    .insert(personaAssets)
    .values({ personaId: input.personaId, kind: input.kind, prompt: input.prompt, status: "pending" })
    .returning();
  return row;
}

/** Asset-Status ueber die geprueften Uebergaenge aus persona-dossier.ts. */
export async function advanceAsset(
  id: number,
  success: boolean,
  url?: string
): Promise<PersonaAsset | null> {
  const db = await requireDb();
  const current = (await db.select().from(personaAssets).where(eq(personaAssets.id, id)).limit(1))[0];
  if (!current) return null;
  const { nextAssetStatus } = await import("./persona-dossier");
  const next = nextAssetStatus(current.status, success);
  const [row] = await db
    .update(personaAssets)
    .set({ status: next, ...(url && next === "ready" ? { url } : {}) })
    .where(eq(personaAssets.id, id))
    .returning();
  return row ?? null;
}

/* ------------------------------------------------------------------ */
/* Content-Slots                                                       */
/* ------------------------------------------------------------------ */

export async function listSlots(personaId?: number): Promise<ContentSlot[]> {
  const db = await requireDb();
  const query = db.select().from(contentSlots);
  const rows = personaId
    ? await query.where(eq(contentSlots.personaId, personaId)).orderBy(desc(contentSlots.scheduledFor))
    : await query.orderBy(desc(contentSlots.scheduledFor));
  return rows;
}

/** Slots planen (deterministisch) und 'planned'-Slots speichern. */
export async function persistPlannedSlots(
  slots: { personaId: number; channel: string; theme: string; scheduledFor: Date }[]
): Promise<ContentSlot[]> {
  const db = await requireDb();
  if (slots.length === 0) return [];
  return db
    .insert(contentSlots)
    .values(slots.map((s) => ({ ...s, status: "planned" as const })))
    .returning();
}

/** Draft eines Slots setzen (Autonom erlaubt: planned → drafted). */
export async function setSlotDraft(id: number, draft: string): Promise<ContentSlot | null> {
  const db = await requireDb();
  const current = (await db.select().from(contentSlots).where(eq(contentSlots.id, id)).limit(1))[0];
  if (!current) return null;
  if (current.status !== "planned") {
    throw new TRPCSlotError(`Draft nur fuer geplante Slots zulaessig (Status: ${current.status}).`);
  }
  const [row] = await db
    .update(contentSlots)
    .set({ draft, status: "drafted" })
    .where(eq(contentSlots.id, id))
    .returning();
  return row ?? null;
}

/**
 * Admin-Review: approve/reject/publish NUR mit Admin-User-ID.
 * 'published' erfordert vorherige Freigabe — Autonomie hat keinen Pfad hierher.
 */
export async function reviewSlot(
  id: number,
  adminUserId: number,
  decision: "approve" | "reject" | "publish"
): Promise<ContentSlot | null> {
  const db = await requireDb();
  const current = (await db.select().from(contentSlots).where(eq(contentSlots.id, id)).limit(1))[0];
  if (!current) return null;
  const { nextSlotStatus } = await import("./content-scheduler");
  let next: ContentSlot["status"];
  try {
    next = nextSlotStatus(current.status, decision);
  } catch {
    throw new TRPCSlotError(`Übergang ${current.status} → ${decision} ist nicht zulaessig.`);
  }
  const [row] = await db
    .update(contentSlots)
    .set({ status: next, reviewedBy: adminUserId })
    .where(and(eq(contentSlots.id, id)))
    .returning();
  return row ?? null;
}

/** Fehlerklasse fuer unzulaessige Slot-Übergaenge (Router mapped auf TRPC). */
export class TRPCSlotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TRPCSlotError";
  }
}

export { PersonaDisclosureError };
