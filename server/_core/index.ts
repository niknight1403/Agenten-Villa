import "dotenv/config";
import compression from "compression";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerHealthRoute, setDatabaseHealthReport, setControllerStateSource } from "./health";
import { validateProductionEnv } from "./env-validation";
import { startProviderGuardian } from "../provider-guardian";
import { checkDatabaseHealth } from "../db-health";
import { runRotationTick } from "../route-rotator";
import { haaraTick } from "../haara";
import { rateLimit } from "./rate-limit";
import { demoSubmitRateLimit } from "./demoRateLimit";
import { jsonErrorHandler, requestLogger } from "./request-logger";
import { logStartupDiagnostics } from "./diagnostics";
import { registerGoogleAuthRoutes, resolveTrustProxy } from "./googleAuth";
import { registerNativeGoogleAuthRoutes } from "./nativeAuth";
import { csrfGuard } from "./csrf";
import { securityHeaders } from "./security-headers";
import { nativeCors } from "./nativeCors";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { villaController } from "../controller";
import { controllerSseRouter } from "../controller-sse";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";

/**
 * Sprint 076 — strenge Produktions-Validierung: unvollstaendige
 * Konfiguration bricht den Start sofort mit klarer Meldung ab.
 * Entwicklungsmodus bleibt bewusst tolerannt (siehe env-validation.ts).
 */
const productionEnvCheck = validateProductionEnv(
  process.env,
  process.env.NODE_ENV
);
if (!productionEnvCheck.ok) {
  console.error(productionEnvCheck.message);
  process.exit(1);
}

// Sprint 076 — Health-Endpoint liest den Controller-Live-Status ab.
setControllerStateSource(() => villaController.getState());

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

/**
 * Sprint 011: DB-Verfuegbarkeit beim Start pruefen und im Hintergrund
 * periodisch aktualisieren (60 s, unref — blockiert kein Test-/Tool-Ende).
 * Nur im Produktionsmodus wird beim Fehlschlag laut gewarnt; lokal ohne
 * DATABASE_URL ist der Zustand bewusst erlaubt.
 */
function startDatabaseHealthWatch(): void {
  const runCheck = async () => {
    try {
      const report = await checkDatabaseHealth();
      setDatabaseHealthReport(report);
      if (report.status !== "verbunden") {
        const message = `[Database] Status: ${report.status} — ${
          process.env.DATABASE_URL
            ? "Verbindung fehlgeschlagen; Anmeldung/Chat-Persistenz sind ggf. eingeschraenkt."
            : "DATABASE_URL ist nicht gesetzt (lokal erlaubt, in Produktion ein Blocker)."
        }`;
        if (process.env.NODE_ENV === "production") console.warn(message);
        else console.log(message);
      } else {
        console.log("[Database] Status: verbunden");
      }
    } catch (error) {
      console.warn("[Database] Health-Check fehlgeschlagen:", error);
    }
  };
  void runCheck();
  const timer = setInterval(() => void runCheck(), 60_000);
  timer.unref?.();
}

/**
 * Sprint 102 — API-Routen-Rotator im Hintergrund (5 min, unref):
 * Probiert alle freien Routen (unkritisch, kein Token-Verbrauch),
 * rangiert Ollama-first und uebernimmt die Reihenfolge in den
 * Fallback-Router. Fehler stoeren den Betrieb nicht.
 */
function startRouteRotationWatch(): void {
  const runTick = async () => {
    try {
      const status = await runRotationTick();
      if (status.activeRoute) {
        console.log(`[Route-Rotator] Aktiv: ${status.activeRoute} (Rangfolge: ${status.rankedRoutes.join(" > ")})`);
      } else {
        console.warn("[Route-Rotator] Keine konfigurierte Route aktiv (OLLAMA_BASE_URL/OPENROUTER_API_KEY/... fehlen?)");
      }
    } catch (error) {
      console.warn("[Route-Rotator] Tick fehlgeschlagen:", error);
    }
  };
  void runTick();
  const timer = setInterval(() => void runTick(), 5 * 60_000);
  timer.unref?.();
}

/**
 * Sprint 103 — HAARA im Hintergrund: alle 5 Minuten Systemzustand
 * bewerten und Selbstheilung anwenden (Route-Wechsel, Cooldown-Probe,
 * DB-Reconnect). Fehler stoeren den Betrieb nie.
 */
function startHaaraWatch(): void {
  let lastLevel = "";
  const runTick = async () => {
    try {
      const status = await haaraTick();
      if (status.level !== lastLevel) {
        lastLevel = status.level;
        const line = `[HAARA] Stufe: ${status.level}${status.reasons.length ? " — " + status.reasons.join("; ") : ""}`;
        if (status.level === "healthy") console.log(line);
        else console.warn(line);
      }
    } catch (error) {
      console.warn("[HAARA] Tick fehlgeschlagen:", error);
    }
  };
  void runTick();
  const timer = setInterval(() => void runTick(), 5 * 60_000);
  timer.unref?.();
}

async function startServer() {
  const app = express();
  // Render (und jeder andere Reverse-Proxy) beendet TLS vor dem Prozess.
  // Ohne Proxy-Vertrauen liest Express die Proxy-IP als req.ip — dann teilen
  // sich ALLE Besucher einen einzigen Rate-Limit-Bucket (der 21. Loginversuch
  // pro Minute wird fuer jeden blockiert) — und req.protocol bleibt "http",
  // was das Secure-Attribut des Sitzungs-Cookies verhindern kann. Ausserhalb
  // der Produktion bleibt das Vertrauen aus (siehe resolveTrustProxy).
  app.set("trust proxy", resolveTrustProxy());
  const server = createServer(app);
  startDatabaseHealthWatch();
  // Sprint 102 — Routen-Rotation im Hintergrund starten.
  startRouteRotationWatch();
  // Sprint 103 — HAARA-Selbstheilung im Hintergrund starten.
  startHaaraWatch();
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  app.use(compression());
  // Sprint 058 — Browser-Sicherheitsheader (CSP/HSTS nur Produktion).
  app.use(securityHeaders());
  app.use(requestLogger());
  // Native auth preflights must reach CORS before the auth rate limiter.
  app.use("/api", nativeCors());
  // CSRF-Schutz (Sprint 055): SameSite=None-Cookies erfordern eine
  // Origin-Pruefung fuer alle Mutationen unter /api.
  app.use("/api", csrfGuard());
  // Brute-Force-Schutz fuer Login-/OAuth-Endpunkte (20 Anfragen/Minute/IP)
  app.use(
    "/api/auth",
    rateLimit({ windowMs: 60_000, max: 20, keyPrefix: "auth" })
  );
  app.use("/api/trpc", demoSubmitRateLimit);
  registerHealthRoute(app);
  registerStorageProxy(app);
  // 24/7-Watchdog: Live-Status der Worker-Loops per SSE.
  app.use("/api/controller", controllerSseRouter);
  registerOAuthRoutes(app);
  registerGoogleAuthRoutes(app);
  registerNativeGoogleAuthRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // LetzterFallback fuer unbehandelte Fehler
  app.use(jsonErrorHandler());

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
    logStartupDiagnostics();
    // Autonomer Provider-Waechter: haelt die kostenlosen Routen funktionsfaehig.
    startProviderGuardian();
    // 24/7-Watchdog: letzte Loop-Status beim Start wieder aufnehmen.
    void villaController.init().catch(() => { /* Startup bleibt nie daran haengen */ });
  });
}

startServer().catch(console.error);
