import type { Request, RequestHandler } from "express";

/**
 * Sprint 055 — CSRF-Schutz fuer cookie-basierte Mutationen.
 *
 * Das Session-Cookie ist in Produktion SameSite=None (erforderlich fuer
 * die native Capacitor-WebView, die von einem anderen Origin aus gegen
 * die Render-API arbeitet). SameSite=None nimmt dem Cookie jede
 * browserseitige CSRF-Abwehr — deshalb prueft dieser Guard fuer alle
 * unmethodischen Requests (POST/PUT/PATCH/DELETE), dass der Origin des
 * Aufrufers erlaubt ist:
 *
 *   1. Origin-Header passt zum Host der Anfrage (same-origin), oder
 *   2. Origin ist ein explizit erlaubter nativer Ursprung (Capacitor),
 *   3. fehlender Origin wird ueber den Referer geprueft,
 *   4. fehlen Origin UND Referer, geht die Anfrage durch
 *      (nicht-browser Clients wie curl/SDK; Browser senden bei
 *      Cross-Site-POSTs immer Origin oder Referer).
 *
 * Ein Angreifer von einem fremden Origin erhaelt 403, bevor eine
 * authentifizierte Mutation ausgefuehrt wird.
 */

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const NATIVE_ORIGINS = new Set([
  "https://localhost",
  "http://localhost",
  "capacitor://localhost",
  "ionic://localhost",
]);

function extraOrigins(): Set<string> {
  const extra = (process.env.CAPACITOR_ORIGINS ?? "")
    .split(",")
    .map(entry => entry.trim().toLowerCase())
    .filter(Boolean);
  return new Set(extra);
}

function hostOf(req: Request): string {
  const forwarded = req.headers["x-forwarded-host"];
  const raw = Array.isArray(forwarded)
    ? forwarded[0]
    : forwarded ?? req.headers.host ?? "";
  return String(raw).split(",")[0].trim().toLowerCase();
}

/** Origin/Referer-URL normalisiert — '' wenn nicht lesbar. */
function originFromHeader(value: string | undefined): string {
  if (!value) return "";
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return "";
  }
}

export function isAllowedOrigin(
  originHost: string,
  req: Request,
  nativeSet: Set<string> = NATIVE_ORIGINS
): boolean {
  if (!originHost) return false;
  if (hostOf(req) && originHost === hostOf(req)) return true;
  if (nativeSet.has(`https://${originHost}`) || nativeSet.has(`http://${originHost}`)) return true;
  // Native Origins duerfen auch im raw-Format (schema://host) gelistet sein.
  return false;
}

export function csrfGuard(options?: { nativeOrigins?: Set<string> }): RequestHandler {
  const merged: string[] = options?.nativeOrigins
    ? Array.from(NATIVE_ORIGINS).concat(Array.from(options.nativeOrigins), Array.from(extraOrigins()))
    : Array.from(NATIVE_ORIGINS).concat(Array.from(extraOrigins()));
  const nativeOrigins = new Set(merged);

  return (req, res, next) => {
    if (!UNSAFE_METHODS.has(req.method)) {
      next();
      return;
    }

    const originHeader = Array.isArray(req.headers.origin)
      ? req.headers.origin[0]
      : req.headers.origin;
    const originHost = originFromHeader(originHeader);

    if (originHost) {
      // Natives Schema (capacitor://localhost) direkt am Set pruefen.
      if (
        isAllowedOrigin(originHost, req, nativeOrigins) ||
        nativeOrigins.has(String(originHeader).toLowerCase())
      ) {
        next();
        return;
      }
      res.status(403).json({ error: "Cross-site request blocked (CSRF guard)" });
      return;
    }

    // Ohne Origin: Referer als Rueckfallebene (Browser ohne Origin-Policy).
    const referer = Array.isArray(req.headers.referer)
      ? req.headers.referer[0]
      : req.headers.referer;
    const refererHost = originFromHeader(referer);
    if (refererHost) {
      if (isAllowedOrigin(refererHost, req, nativeOrigins)) {
        next();
        return;
      }
      res.status(403).json({ error: "Cross-site request blocked (CSRF guard)" });
      return;
    }

    // Weder Origin noch Referer: kein Browser-CSRF-Szenario — durchlassen.
    next();
  };
}
