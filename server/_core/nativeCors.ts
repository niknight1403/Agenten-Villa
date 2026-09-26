import type { Request, RequestHandler } from "express";

/**
 * CORS fuer native Capacitor-Urspruenge (Android-WebView: https/http://localhost,
 * iOS: capacitor://localhost). Nur explizit erlaubte Origins bekommen
 * Allow-Credentials — Wildcards sind bei credentialed Requests unzulaessig.
 * Optional per CAPACITOR_ORIGINS erweiterbar (Komma-separiert).
 */
export function nativeCors(): RequestHandler {
  const defaults = [
    "https://localhost",
    "http://localhost",
    "capacitor://localhost",
    "ionic://localhost",
  ];
  const extra = (process.env.CAPACITOR_ORIGINS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const allowed = new Set([...defaults, ...extra]);

  return (req: Request, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowed.has(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader(
        "Access-Control-Max-Age",
        "86400"
      );
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  };
}
