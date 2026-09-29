import { and, asc, eq } from "drizzle-orm";
import type { AgentProfile, Villa } from "../drizzle/schema";
import { getDb } from "./db";
import { agentProfiles, villas } from "../drizzle/schema";

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  return db;
}

/** Sprint 016 — Profile des Aufrufers. */
export async function listProfiles(userId: number): Promise<AgentProfile[]> {
  const db = await requireDb();
  return db.select().from(agentProfiles)
    .where(eq(agentProfiles.createdBy, userId))
    .orderBy(asc(agentProfiles.createdAt));
}

export async function createProfile(input: {
  createdBy: number;
  name: string;
  role: "strategie" | "entwicklung" | "review" | "support";
  taskProfile?: string | null;
}): Promise<AgentProfile> {
  const db = await requireDb();
  const [created] = await db.insert(agentProfiles).values(input).returning();
  return created;
}

export async function updateProfile(
  profileId: number,
  userId: number,
  patch: {
    name?: string;
    role?: "strategie" | "entwicklung" | "review" | "support";
    taskProfile?: string | null;
  }
): Promise<AgentProfile | undefined> {
  const db = await requireDb();
  const set: Record<string, string | null> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.role !== undefined) set.role = patch.role;
  if (patch.taskProfile !== undefined) set.taskProfile = patch.taskProfile;
  if (Object.keys(set).length === 0) return undefined;
  const rows = await db.update(agentProfiles)
    .set(set)
    .where(and(eq(agentProfiles.id, profileId), eq(agentProfiles.createdBy, userId)))
    .returning();
  return rows[0];
}

export async function deleteProfile(profileId: number, userId: number): Promise<boolean> {
  const db = await requireDb();
  const deleted = await db.delete(agentProfiles)
    .where(and(eq(agentProfiles.id, profileId), eq(agentProfiles.createdBy, userId)))
    .returning({ id: agentProfiles.id });
  return deleted.length > 0;
}

/**
 * Sprint 016 — Profil einer eigenen Villa zuordnen. Gehört das Profil einem
 * anderen Nutzer, wird die Zuordnung abgelehnt (kein stiller Zugriff).
 */
export async function assignProfileToVilla(
  villaId: number,
  profileId: number | null,
  userId: number
): Promise<Villa | undefined> {
  const db = await requireDb();
  return db.transaction(async tx => {
    const [villa] = await tx.select().from(villas)
      .where(and(eq(villas.id, villaId), eq(villas.createdBy, userId)))
      .for("update");
    if (!villa) return undefined;
    if (profileId !== null) {
      const [profile] = await tx.select({ id: agentProfiles.id }).from(agentProfiles)
        .where(and(eq(agentProfiles.id, profileId), eq(agentProfiles.createdBy, userId)))
        .limit(1);
      if (!profile) return undefined;
    }
    const rows = await tx.update(villas)
      .set({ profileId })
      .where(eq(villas.id, villaId))
      .returning();
    return rows[0];
  });
}
