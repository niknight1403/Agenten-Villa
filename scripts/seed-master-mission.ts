/**
 * 24/7-Master-Mission (CyberSarah-Control-Center) als startbare
 * Elite-Mission anlegen: Status 'interrupted', damit der Administrator sie
 * in der Villa-Oberflaeche ueber den Neustart-Button startet.
 * Idempotent ueber (userId, idempotencyKey). Aufruf:
 *   pnpm exec tsx scripts/seed-master-mission.ts
 */

import crypto from "node:crypto";
import postgres from "postgres";

const ADMIN_EMAIL = process.env.AGENT_ADMIN_EMAIL ?? "niko.oeben@gmail.com";
const IDEMPOTENCY_KEY = "master-24-7-csc-001";

const PROMPT = `24/7-Master-Mission: CyberSarah-Control-Center (GitHub: niknight1403/CyberSarah-Control-Center). Analysiere die App vollstaendig (Struktur, Module, APIs, Workflows, UX, Kosten) und entwickle sie autonom weiter, Schritt fuer Schritt, bis zum produktionsreifen, marktfaehigen Zustand:
1) Kernidee und Produktfokus praezise erkennen und dokumentieren.
2) Alles Sinnlose entfernen (toter Code, ungenutzte Abhaengigkeiten, redundante Module, verwirrende UI-Teile) — ein klar abgegrenzter Bereich je Zyklus.
3) Alles fehlende integrieren, was fuer ein marktreifes Produkt noetig ist (Stabilitaet, Performance, Sicherheit, Onboarding, Zahlungs-/Stripe-Flow, Analytics).
4) Die Umsatzmoeglichkeiten maximal autonom optimieren: Pricing, Paywalls, Upsells, automatisierte Revenue-Loops — jede Aenderung messbar begruenden.
5) Nach jedem Zyklus: Tests schreiben und gruen halten, Verifikation, dann den naechsten Zyklus planen.
Vorrang: funktionierendes Kernprodukt > Umsatz > Kosmetik. Arbeite ausschliesslich auf agent/*-Branches mit Draft-PRs, niemals direkt auf main. Missionsende erst, wenn der Zustand 'produktionsreif' verifiziert ist.`;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL fehlt");
  const sql = postgres(url, { ssl: "require" });

  const users = await sql`select id, email from users where lower(email) = ${ADMIN_EMAIL.toLowerCase()} limit 1`;
  let userId: number;
  if (users.length > 0) {
    userId = users[0].id;
  } else {
    const all = await sql`select id, email from users order by id asc`;
    console.log("WARNUNG: Admin-Email nicht gefunden. Vorhandene User:", JSON.stringify(all));
    if (all.length === 0) throw new Error("Keine User — bitte einmal in der Villa anmelden, dann erneut seeden.");
    userId = all[all.length - 1].id;
  }
  console.log("Nutze userId:", userId);

  const input = {
    prompt: PROMPT,
    history: [],
    specialty: "Autonomous Product Engineering",
    forge: { strategy: "OPTIMIZE", productReview: true, memory: [] },
  };
  const requestHash = crypto.createHash("sha256").update(PROMPT).digest("hex");

  const rows = await sql`
    insert into elite_mission_runs
      ("userId", "idempotencyKey", "requestHash", "input", "status", "attempt", "ownerId", "leaseUntil", "createdAt", "updatedAt")
    values
      (${userId}, ${IDEMPOTENCY_KEY}, ${requestHash}, ${sql.json(input)}, 'interrupted', 1,
       ${crypto.randomUUID()}, now() - interval '1 hour', now(), now())
    on conflict ("userId", "idempotencyKey") do nothing
    returning id`;

  const check = await sql`select id, status from elite_mission_runs
    where "userId" = ${userId} and "idempotencyKey" = ${IDEMPOTENCY_KEY}`;
  if (check.length !== 1) throw new Error("Mission nicht eindeutig angelegt");
  console.log(
    `MISSION-OK id=${check[0].id} status=${check[0].status}` +
      (rows.length ? " (neu angelegt)" : " (existierte bereits)")
  );
  await sql.end();
  process.exit(0);
}

main().catch((error) => {
  console.error("Seed fehlgeschlagen:", (error as Error).message);
  process.exit(1);
});
