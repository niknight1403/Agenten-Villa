import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Agenten Villa – Capacitor (Android) Konfiguration
 * webDir: Output des Vite-Client-Builds (dist/public)
 * Server-URL für die App: VITE_API_URL beim Client-Build setzen
 * (siehe client/src/main.tsx, Standard: relative /api/trpc im Web).
 */
const config: CapacitorConfig = {
  appId: "de.niknight1403.agentenvilla",
  appName: "Agenten Villa",
  webDir: "dist/public",
  android: {
    allowMixedContent: false,
  },
};

export default config;
