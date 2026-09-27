import { and, desc, eq, ne, sql } from "drizzle-orm";
import { demoContactOptOuts, demoRequests, type DemoRequest } from "../drizzle/schema";
import { getDb } from "./db";
import { DEMO_CONTACT_CONSENT_TEXT, DEMO_CONTACT_CONSENT_VERSION } from "../shared/demo-consent";

async function requiredDb() {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  return db;
}

export async function createDemoRequest(input: {
  name: string;
  company: string;
  email: string;
  projectIdea: string;
}): Promise<void> {
  const db = await requiredDb();
  const email = input.email.trim().toLowerCase();
  await db.transaction(async tx => {
    // The same transaction-level lock is taken when opting out. Whichever
    // request wins first determines whether it is saved, and an opt-out then
    // marks all previously saved requests. Lock collisions only serialize.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${email}))`);
    const [blocked] = await tx.select({ email: demoContactOptOuts.email })
      .from(demoContactOptOuts).where(eq(demoContactOptOuts.email, email)).limit(1);
    if (blocked) return;
    await tx.insert(demoRequests).values({
      ...input,
      email,
      consentedAt: new Date(),
      consentVersion: DEMO_CONTACT_CONSENT_VERSION,
      consentText: DEMO_CONTACT_CONSENT_TEXT,
    });
  });
}

export async function listDemoRequests(): Promise<DemoRequest[]> {
  const db = await requiredDb();
  return db.select().from(demoRequests).orderBy(desc(demoRequests.createdAt)).limit(100);
}

export async function setDemoRequestStatus(
  id: number,
  status: DemoRequest["status"]
): Promise<DemoRequest | undefined> {
  const db = await requiredDb();
  if (status === "opted_out") {
    return db.transaction(async tx => {
      const [lead] = await tx.select({ email: demoRequests.email }).from(demoRequests)
        .where(eq(demoRequests.id, id)).limit(1);
      if (!lead) return undefined;
      const email = lead.email.trim().toLowerCase();
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${email}))`);
      const now = new Date();
      await tx.insert(demoContactOptOuts).values({ email, optedOutAt: now }).onConflictDoNothing();
      await tx.update(demoRequests).set({ status: "opted_out", optedOutAt: now, updatedAt: now })
        .where(and(eq(demoRequests.email, email), ne(demoRequests.status, "opted_out")));
      const [updated] = await tx.select().from(demoRequests).where(eq(demoRequests.id, id)).limit(1);
      return updated;
    });
  }
  // A previously suppressed row cannot be reactivated through a status edit.
  const [updated] = await db.update(demoRequests).set({
    status,
    updatedAt: new Date(),
  }).where(and(eq(demoRequests.id, id), ne(demoRequests.status, "opted_out"))).returning();
  return updated;
}
