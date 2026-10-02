import type { Request, RequestHandler } from "express";

/**
 * Sprint 058 — Browser-Sicherheitsheader.
 *
 * Diagnose: Die Express-App setzte keinerlei Sicherheitsheader — die
 * Produktion war damit gegen Clickjacking (Einbetten in fremde Iframes),
 * MIME-Sniffing, Referrer-Lecks und uebervorsichtige Feature-Nutzung
 * ungeschaetzt. Der Native-Client (Capacitor) laedt gebuendelte Assets und
 * ist von diesen Headern unberuehrt; sie schuetzen die Web-Nutzer auf der
 * Produktions-Domain.
 *
 * CSP (nur Produktion; Dev laesst Vite-HMR zu):
 *   - Script nur same-origin, keine Inline-/Eval-Scripte (Vite emittiert
 *     externe Modul-Scripte, index.html enthaelt keine Inline-Scripte).
 *   - Styles same-origin + inline (React-Style-Attribute) + Google Fonts.
 *   - Bilder/Fonts/Media aus same-origin, data:, blob: und https: (Tiles,
 *     Avatare); Objekte komplett verboten.
 *   - Verbindungen nur same-origin (API liegt auf derselben Domain).
 *   - frame-ancestors 'none' + X-Frame-Options DENY gegen Clickjacking.
 *
 * HSTS nur in Produktion (hinter TLS-Terminierung des Reverse-Proxys).
 */

export const CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export function securityHeaders(options?: {
  nodeEnv?: string;
}): RequestHandler {
  const nodeEnv = options?.nodeEnv ?? process.env.NODE_ENV;
  const isProduction = nodeEnv === "production";

  return (req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=()"
    );
    if (isProduction) {
      res.setHeader("Content-Security-Policy", CSP_DIRECTIVES);
      res.setHeader(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains"
      );
    }
    next();
  };
}
