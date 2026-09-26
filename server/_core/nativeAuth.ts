import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { createLocalJWKSet, createRemoteJWKSet, jwtVerify } from "jose";
import type { JSONWebKeySet } from "jose";
import type { Express, Request, Response } from "express";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { ENV } from "./env";
import { sdk } from "./sdk";

const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

export type GoogleIdTokenProfile = {
  sub: string;
  email: string | null;
  name: string | null;
};

// Remote-JWKS-Set wird lazy und singleton-gebunden (jose cached intern die Keys).
let remoteJwks: ReturnType<typeof createRemoteJWKSet> | null = null;

export type VerifyGoogleIdTokenOptions = {
  /** Pflicht: erwartete audience (der Web-Client-ID). */
  audience: string;
  /** Test-Hook: fertiges JWKS statt Google-Remote-Keys. */
  jwks?: JSONWebKeySet;
  /** Test-Hook: Toleranz beim exp-Check (Sekunden). Default 0. */
  clockToleranceSeconds?: number;
};

/**
 * Verifiziert ein Google-ID-Token (signierter RS256-JWT) gegen die
 * oeffentlichen Google-JWKS. Prueft Signatur, issuer und audience.
 * Wirft bei ungueltigem Token; Caller behandelt den Fehler.
 */
export async function verifyGoogleIdToken(
  idToken: string,
  options: VerifyGoogleIdTokenOptions
): Promise<GoogleIdTokenProfile> {
  if (!options.audience) {
    throw new Error("audience (GOOGLE_CLIENT_ID) is required");
  }
  const verifyOptions = {
    algorithms: ["RS256"],
    issuer: GOOGLE_ISSUERS,
    audience: options.audience,
    clockTolerance: options.clockToleranceSeconds ?? 0,
  };

  const { payload } = options.jwks
    ? await jwtVerify(idToken, createLocalJWKSet(options.jwks), verifyOptions)
    : await jwtVerify(
        idToken,
        (remoteJwks ??= createRemoteJWKSet(new URL(GOOGLE_JWKS_URL))),
        verifyOptions
      );

  const sub = typeof payload.sub === "string" ? payload.sub : "";
  if (!sub) {
    throw new Error("sub missing from Google ID token");
  }

  const email =
    typeof payload.email === "string" && payload.email.trim()
      ? payload.email.trim().toLowerCase()
      : null;

  return {
    sub,
    email,
    name: typeof payload.name === "string" && payload.name.trim() ? payload.name : null,
  };
}

/**
 * Session-Anlage fuer Google-Nutzer (identisch zum Web-Callback):
 * upsert + Session-Cookie + Session-Token als Rueckgabewert.
 * Von Web-Callback und nativem Login gemeinsam genutzt.
 */
export async function establishGoogleSession(
  req: Request,
  res: Response,
  profile: GoogleIdTokenProfile,
  isAdmin: boolean
): Promise<string> {
  const openId = `google:${profile.sub}`;

  await db.upsertUser({
    openId,
    name: profile.name,
    email: profile.email,
    loginMethod: "google",
    lastSignedIn: new Date(),
    ...(isAdmin ? { role: "admin" as const } : {}),
  });

  const sessionToken = await sdk.createSessionToken(openId, {
    name: profile.name || "",
    expiresInMs: ONE_YEAR_MS,
  });

  const cookieOptions = getSessionCookieOptions(req);
  res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

  return sessionToken;
}

function isAdminEmail(email: string | null): boolean {
  const allowlisted = process.env.AGENT_ADMIN_EMAIL?.trim().toLowerCase();
  return Boolean(allowlisted && email && email === allowlisted);
}

/**
 * Nativer Google-Login (Android/iOS via Capacitor-Plugin):
 * Die App holt per Google-Play-Services-Sign-In ein ID-Token und sendet es
 * hierher. Wir verifizieren es serverseitig gegen die Google-JWKS und legen
 * die gleiche Session an wie der Web-Callback. Rueckgabe enthaelt das
 * Session-Token, damit die WebView es als Bearer-Fallback speichern kann
 * (manche WebViews verwerfen Cross-Site-Cookies).
 */
export function registerNativeGoogleAuthRoutes(app: Express) {
  app.post("/api/auth/google/native", async (req: Request, res: Response) => {
    const idToken =
      typeof req.body?.idToken === "string" ? req.body.idToken.trim() : "";

    if (!idToken) {
      res.status(400).json({ error: "idToken is required" });
      return;
    }
    if (!ENV.googleClientId) {
      res.status(500).json({ error: "Google login is not configured" });
      return;
    }

    try {
      const profile = await verifyGoogleIdToken(idToken, {
        audience: ENV.googleClientId,
      });
      const sessionToken = await establishGoogleSession(
        req,
        res,
        profile,
        isAdminEmail(profile.email)
      );
      res.json({ ok: true, sessionToken });
    } catch (err) {
      console.warn("[NativeGoogleAuth] ID token verification failed", String(err));
      res.status(401).json({ error: "invalid_token" });
    }
  });
}
