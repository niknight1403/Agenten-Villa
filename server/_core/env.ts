function readEnvFromProcess() {
  return {
    // VITE_APP_ID fehlt im Render-Deployment; ohne Fallback waere appId ein
    // Leerstring und verifySession() wuerde jede Session ablehnen (appId muss
    // non-empty sein). Der Wert ist fuer den Google-Flow rein deklarativ.
    appId: process.env.VITE_APP_ID ?? "agenten-villa",
    cookieSecret: process.env.JWT_SECRET ?? "",
    databaseUrl: process.env.DATABASE_URL ?? "",
    oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
    ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
    isProduction: process.env.NODE_ENV === "production",
    forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
    forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
    googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    openrouterApiKey: process.env.OPENROUTER_API_KEY ?? "",
    groqApiKey: process.env.GROQ_API_KEY ?? "",
    geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  };
}

/**
 * ENV ist ein Import-Zeit-Snapshot von process.env. Das ist produktiv
 * gewollt (stabil, keine Ueberraschungen zur Laufzeit), macht Tests aber
 * abhaengig davon, WELCHE Keys zum Import-Zeitpunkt gesetzt waren:
 * Lief die Suite in einer Umgebung mit gesetzten Provider-Keys, sahen
 * Router-Tests wie "kein Key konfiguriert" den gecachten Key.
 *
 * Test-Erweiterungspunkt (analog resetLLMProvidersForTests): ließt den
 * Snapshot neu aus process.env, nachdem ein Test process.env umgestellt
 * hat. Produktionscode ruft das NIE — nur beforeEach in Tests.
 */
export function resetEnvForTests(): void {
  Object.assign(ENV, readEnvFromProcess());
}

export const ENV = readEnvFromProcess();
