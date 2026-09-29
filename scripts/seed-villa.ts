/**
 * Seed a project-development villa for a user, so the chat can be tested
 * end-to-end without clicking through the UI. Uses the same store functions
 * as the API, so limits and the audit trail apply identically.
 *
 * Usage:
 *   pnpm seed:villa -- --user <users.id>
 *   pnpm seed:villa -- --email you@example.com
 *
 * Requires DATABASE_URL.
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { users } from "../drizzle/schema";
import { ensureStarterVilla, listVillas } from "../server/villa-store";

function readArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

async function main() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    console.error("DATABASE_URL ist nicht gesetzt.");
    process.exitCode = 1;
    return;
  }

  const email = readArg("--email");
  const userIdArg = readArg("--user");

  let userId: number | undefined;
  if (userIdArg) {
    userId = Number(userIdArg);
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      console.error("--user muss eine positive Ganzzahl sein.");
      process.exitCode = 1;
      return;
    }
  } else if (email) {
    const db = drizzle(postgres(connectionString, { max: 1 }));
    const [row] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email.trim().toLowerCase()))
      .limit(1);
    await db.$client.end();
    if (!row) {
      console.error(`Kein Nutzer mit E-Mail ${email} gefunden. Bitte zuerst anmelden.`);
      process.exitCode = 1;
      return;
    }
    userId = row.id;
  } else {
    console.error("Bitte --user <id> oder --email <adresse> angeben.");
    process.exitCode = 1;
    return;
  }

  const villa = await ensureStarterVilla(userId);
  const all = await listVillas(userId);
  console.log(
    `Projekt-Villa „${villa.name}" (id=${villa.id}, Spezialisierung: ${villa.specialty}) für Nutzer ${userId} angelegt.`
  );
  console.log(`Villen dieses Nutzers: ${all.length}.`);
}

main().catch(error => {
  console.error("Seed fehlgeschlagen:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
