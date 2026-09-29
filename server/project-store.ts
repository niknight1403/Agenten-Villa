import { and, asc, eq } from "drizzle-orm";
import type { Project, Villa } from "../drizzle/schema";
import { getDb } from "./db";
import { projects, villas } from "../drizzle/schema";

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  return db;
}

/** Sprint 015 — Projekte des Aufrufers, ältestes zuerst. */
export async function listProjects(userId: number): Promise<Project[]> {
  const db = await requireDb();
  return db.select().from(projects)
    .where(eq(projects.createdBy, userId))
    .orderBy(asc(projects.createdAt));
}

export async function createProject(input: {
  createdBy: number;
  name: string;
  brief?: string | null;
}): Promise<Project> {
  const db = await requireDb();
  const [created] = await db.insert(projects).values(input).returning();
  return created;
}

/**
 * Sprint 015 — Projekt einer (oder mehrerer) Villen des Aufrufers zuordnen.
 * Villa und Projekt müssen demselben Nutzer gehören; projectId null löst
 * die Zuordnung auf. Rückgabe: die aktualisierte Villa oder undefined.
 */
export async function assignProjectToVilla(
  villaId: number,
  projectId: number | null,
  userId: number
): Promise<Villa | undefined> {
  const db = await requireDb();
  return db.transaction(async tx => {
    const [villa] = await tx.select().from(villas)
      .where(and(eq(villas.id, villaId), eq(villas.createdBy, userId)))
      .for("update");
    if (!villa) return undefined;
    if (projectId !== null) {
      const [project] = await tx.select({ id: projects.id }).from(projects)
        .where(and(eq(projects.id, projectId), eq(projects.createdBy, userId)))
        .limit(1);
      if (!project) return undefined;
    }
    const rows = await tx.update(villas)
      .set({ projectId })
      .where(eq(villas.id, villaId))
      .returning();
    return rows[0];
  });
}
