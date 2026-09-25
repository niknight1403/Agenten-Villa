import type { ErrorRequestHandler, RequestHandler } from "express";

/**
 * Minimaler HTTP-Zugriffs-Logger ohne personenbezogene Daten:
 * Methode, Pfad (ohne Query), Status, Dauer. Health-Checks bleiben still,
 * damit die Render-Logs nicht mit Pruefzyklen volllaufen.
 */
export function requestLogger(): RequestHandler {
  return (req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      const pathname = (req.originalUrl ?? req.url ?? "").split("?")[0];
      if (pathname === "/api/health") return;
      const durationMs = Date.now() - start;
      console.log(
        `[http] ${req.method} ${pathname} -> ${res.statusCode} (${durationMs}ms)`
      );
    });
    next();
  };
}

/**
 * LetzterFallback fuer unbehandelte Fehler: loggt den Stack serverseitig
 * und antwortet mit einem JSON-500 ohne Interna nach aussen.
 */
export function jsonErrorHandler(): ErrorRequestHandler {
  return (err, _req, res, _next) => {
    if (res.headersSent) return;
    console.error(
      "[http] Unbehandelter Fehler:",
      err instanceof Error ? err.stack ?? err.message : err
    );
    res.status(500).json({ error: "Interner Serverfehler." });
  };
}
