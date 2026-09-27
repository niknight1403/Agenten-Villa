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
  plugins: {
    GoogleAuth: {
      // Oeffentliche Web-Client-ID aus der Google Cloud Console — Ziel von
      // requestIdToken im nativen Google-Sign-In. Die Android-Client-ID mit
      // SHA-1-Fingerprint muss im selben Google-Cloud-Projekt existieren.
      clientId: "656137332727-2i47bqt2fk359nj48tc0kdfl3mhjmoo1.apps.googleusercontent.com",
    },
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
