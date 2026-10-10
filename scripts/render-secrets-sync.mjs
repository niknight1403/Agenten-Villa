#!/usr/bin/env node
/**
 * Sprint 102 — Sync GitHub-Provided Secrets nach Render (Agenten Villa).
 *
 * Liest die Werte aus der Umgebung (der GitHub-Workflow uebergibt sie aus
 * den Repo-Secrets), sucht den Render-Service per Name und setzt/aktualisiert
 * die Umgebungsvariablen. Vorhandene Werte werden ueberschrieben, fehlende
 * erstellt. Render loest bei Aenderung automatisch einen Deploy aus.
 *
 * Nutzung (im Workflow): node scripts/render-secrets-sync.mjs
 */

const RENDER_API = "https://api.render.com/v1";
const SERVICE_NAME = process.env.RENDER_SERVICE_NAME || "agenten-villa";

/** Env-Keys, die gesyncct werden — Werte kommen ausschliesslich aus Secrets. */
const SYNC_KEYS = [
  "DATABASE_URL",
  "JWT_SECRET",
  "AGENT_ADMIN_EMAIL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "OPENROUTER_API_KEY",
  "GEMINI_API_KEY",
  "GROQ_API_KEY",
  "HF_TOKEN",
  "GITHUB_TOKEN",
  "OLLAMA_BASE_URL",
  "OLLAMA_API_KEY",
  "OLLAMA_TIMEOUT_MS",
];

async function render(pathname, init) {
  const response = await fetch(`${RENDER_API}${pathname}`, {
    ...init,
    headers: {
      authorization: `Bearer ${process.env.RENDER_API_KEY}`,
      "content-type": "application/json",
      accept: "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Render ${response.status} ${pathname}: ${text.slice(0, 400)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function main() {
  if (!process.env.RENDER_API_KEY) {
    throw new Error("RENDER_API_KEY fehlt (GitHub-Secret RENDER_API_KEY)");
  }

  // Service per ID (bevorzugt) oder Name suchen (Render listet nur die eigenen).
  const serviceId = process.env.RENDER_SERVICE_ID;
  let service;
  if (serviceId) {
    service = await render(`/services/${serviceId}`, { method: "GET" });
  } else {
    const services = await render("/services?limit=100", { method: "GET" });
    service = (Array.isArray(services) ? services : []).find(
      (candidate) => candidate.name === SERVICE_NAME,
    );
  }
  if (!service) {
    throw new Error(`Render-Service '${SERVICE_NAME}' nicht gefunden — Render-Dashboard pruefen`);
  }
  console.log(`[render-secrets-sync] Service: ${service.name} (${service.id})`);

  const existing = await render(`/services/${service.id}/env-vars`, { method: "GET" });
  const byKey = new Map(existing.map((variable) => [variable.key, variable]));

  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (const key of SYNC_KEYS) {
    const value = process.env[key];
    if (!value || !value.trim()) {
      skipped += 1;
      console.log(`[render-secrets-sync] ueberspringe ${key} (nicht gesetzt)`);
      continue;
    }
    const variable = byKey.get(key);
    if (variable) {
      await render(`/services/${service.id}/env-vars/${variable.id}`, {
        method: "PATCH",
        body: JSON.stringify({ value }),
      });
      updated += 1;
    } else {
      await render(`/services/${service.id}/env-vars`, {
        method: "POST",
        body: JSON.stringify({ key, value }),
      });
      created += 1;
    }
    console.log(`[render-secrets-sync] ${key}: ${variable ? "aktualisiert" : "erstellt"}`);
  }

  console.log(
    `[render-secrets-sync] Fertig — ${created} erstellt, ${updated} aktualisiert, ${skipped} uebersprungen.`,
  );
  console.log("[render-secrets-sync] Render deployet den Service automatisch neu.");
}

main().catch((error) => {
  console.error(`[render-secrets-sync] FEHLER: ${error.message}`);
  process.exit(1);
});
