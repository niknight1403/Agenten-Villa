import { cacheEnabled } from "../free-tier";

export type IntegrationStatus = {
  name: string;
  configured: boolean;
};

/**
 * Startup-Diagnose: listet OHNE Geheimniswerte, welche Integrationen
 * konfiguriert sind. Fehlt etwas, steht im Render-Log eine klare Zeile
 * statt eines spaeten, verwirrenden Laufzeitfehlers.
 */
export function integrationStatus(
  env: Record<string, string | undefined> = process.env
): IntegrationStatus[] {
  return [
    {
      name: "MySQL-Datenbank (DATABASE_URL)",
      configured: Boolean(env.DATABASE_URL?.trim()),
    },
    {
      name: "Google-Anmeldung (GOOGLE_CLIENT_ID)",
      configured: Boolean(env.GOOGLE_CLIENT_ID?.trim()),
    },
    {
      name: "Modellanbieter (OPENROUTER_API_KEY)",
      configured: Boolean(env.OPENROUTER_API_KEY?.trim()),
    },
    {
      name: "Hugging-Face-Fallback (HF_TOKEN, optional)",
      configured: Boolean(env.HF_TOKEN?.trim()),
    },
    {
      name: "GitHub-Werkzeuge (GITHUB_TOKEN, optional)",
      configured: Boolean(env.GITHUB_TOKEN?.trim()),
    },
    {
      name: "Administrator-Allowlist (AGENT_ADMIN_EMAIL)",
      configured: Boolean(env.AGENT_ADMIN_EMAIL?.trim()),
    },
    {
      name: "Free-Tier-Antwortcache",
      configured: cacheEnabled(),
    },
  ];
}

export function logStartupDiagnostics(): void {
  console.log("[start] Integrationen:");
  for (const row of integrationStatus()) {
    console.log(
      `  ${row.configured ? "ok" : "--"} ${row.name}${
        row.configured ? "" : " – nicht konfiguriert (Render-Dashboard: Environment)"
      }`
    );
  }
}
