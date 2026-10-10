/**
 * Sprint 103 / Master-Prompt Abschnitt 3.1 — Seed-Skript (Live-DB).
 *
 * Legt die drei Start-Personas (Nova Vale, Lumen Reed, Quark Monroe)
 * idempotent an. Aufruf z. B. im Seed-Workflow nach den Migrationen:
 *   pnpm exec tsx scripts/seed-personas.ts
 * Gibt am Ende die Anzahl der Personas aus (Verifikation im Log).
 */

import { seedPersonasIfMissing } from "../server/persona-store";

async function main() {
  const result = await seedPersonasIfMissing();
  console.log(`Seed fertig: ${result.seeded} neu angelegt, ${result.existing} bereits vorhanden.`);
  process.exit(0);
}

main().catch((error) => {
  console.error("Seed fehlgeschlagen:", (error as Error).message);
  process.exit(1);
});
