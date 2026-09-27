import { ONE_YEAR_MS, COOKIE_NAME } from "@shared/const";
import { parse as parseCookieHeader } from "cookie";
import type { Express, Request, Response } from "express";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { ENV } from "./env";
import { sdk } from "./sdk";

const GOOGLE_STATE_COOKIE = "__Host-google_oauth_state";
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

function getRedirectUri(req: Request): string {
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}/api/auth/google/callback`;
}

function isAdminEmail(email: string | null | undefined): boolean {
  const allowlisted = process.env.AGENT_ADMIN_EMAIL?.trim().toLowerCase();
  return Boolean(allowlisted && email && email.trim().toLowerCase() === allowlisted);
}

/**
 * Real Google OAuth 2.0 (Authorization Code flow), independent of the
 * platform-specific "Manus" OAuth portal used by ./oauth.ts. Requires
 * GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (Google Cloud Console credentials,
 * Authorized redirect URI: <server-url>/api/auth/google/callback).
 *
 * Session cookie format is shared with the existing flow (sdk.createSessionToken /
 * verifySession, HS256 JWT signed with JWT_SECRET) so both flows interoperate.
 */
export function registerGoogleAuthRoutes(app: Express) {
  app.get("/api/auth/google/start", (req: Request, res: Response) => {
    if (!ENV.googleClientId) {
      res.status(500).json({ error: "Google login is not configured (GOOGLE_CLIENT_ID missing)" });
      return;
    }

    const nonce = crypto.randomUUID();
    res.cookie(GOOGLE_STATE_COOKIE, nonce, {
      path: "/",
      maxAge: 10 * 60 * 1000,
      httpOnly: true,
      sameSite: "lax",
      secure: getSessionCookieOptions(req).secure,
    });

    const url = new URL(GOOGLE_AUTH_URL);
    url.searchParams.set("client_id", ENV.googleClientId);
    url.searchParams.set("redirect_uri", getRedirectUri(req));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", nonce);
    url.searchParams.set("access_type", "online");
    url.searchParams.set("prompt", "select_account");

    res.redirect(302, url.toString());
  });

  app.get("/api/auth/google/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");
    const error = getQueryParam(req, "error");

    if (error) {
      res.redirect(302, `/login?error=${encodeURIComponent(error)}`);
      return;
    }
    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }

    const expectedNonce = parseCookieHeader(req.headers.cookie ?? "")[GOOGLE_STATE_COOKIE];
    if (!expectedNonce || state !== expectedNonce) {
      res.status(403).json({ error: "invalid oauth state" });
      return;
    }
    res.clearCookie(GOOGLE_STATE_COOKIE, { path: "/" });

    if (!ENV.googleClientId || !ENV.googleClientSecret) {
      res.status(500).json({ error: "Google login is not configured" });
      return;
    }

    try {
      const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: ENV.googleClientId,
          client_secret: ENV.googleClientSecret,
          code,
          grant_type: "authorization_code",
          redirect_uri: getRedirectUri(req),
        }),
      });
      if (!tokenResponse.ok) {
        console.error("[GoogleAuth] Token exchange failed", await tokenResponse.text());
        res.redirect(302, "/login?error=token_exchange_failed");
        return;
      }
      const tokenData = (await tokenResponse.json()) as { access_token: string };

      const userInfoResponse = await fetch(GOOGLE_USERINFO_URL, {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      if (!userInfoResponse.ok) {
        console.error("[GoogleAuth] Userinfo fetch failed", await userInfoResponse.text());
        res.redirect(302, "/login?error=userinfo_failed");
        return;
      }
      const profile = (await userInfoResponse.json()) as {
        sub: string;
        email?: string;
        name?: string;
        email_verified?: boolean;
      };

      if (!profile.sub) {
        res.status(400).json({ error: "sub missing from Google user info" });
        return;
      }

      // Prefix to avoid colliding with openIds from the other auth flow.
      const openId = `google:${profile.sub}`;
      const role = isAdminEmail(profile.email) ? "admin" : undefined;

      await db.upsertUser({
        openId,
        name: profile.name || null,
        email: profile.email ?? null,
        loginMethod: "google",
        lastSignedIn: new Date(),
        ...(role ? { role } : {}),
      });

      const sessionToken = await sdk.createSessionToken(openId, {
        name: profile.name || "",
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      res.redirect(302, "/");
    } catch (err) {
      console.error("[GoogleAuth] Callback failed", err);
      res.redirect(302, "/login?error=server_error");
    }
  });
}
