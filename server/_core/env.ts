export const ENV = {
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
