import { OAUTH_STATE_COOKIE, encodeOAuthState } from "@shared/const";

export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

/**
 * Navigate to this app's real sign-in screen (client/src/pages/Auth.tsx),
 * which runs Google OAuth 2.0 via server/_core/googleAuth.ts (web redirect
 * flow) or the native Capacitor Google Sign-In plugin (Android APK).
 *
 * IMPORTANT: this app never used the generic "Manus" OAuth portal
 * (VITE_OAUTH_PORTAL_URL / VITE_APP_ID). Those env vars are not set in
 * render.yaml or the Docker build args, so the previous implementation of
 * this function built `new URL(\`${undefined}/app-auth\`)` — i.e. literally
 * `new URL("undefined/app-auth")` — which always throws
 * "Failed to construct 'URL': Invalid URL". That crash fired on every
 * UNAUTHORIZED response (see client/src/main.tsx's query/mutation error
 * subscriber), which is exactly the toast seen when a session was invalid
 * (e.g. while the database was unreachable and every protected call came
 * back as "unauthorized"), instead of a clean redirect to /login.
 *
 * Call this from an event handler or effect at the moment you want to
 * navigate, e.g. `onClick={() => startLogin()}`. It has a side effect
 * (navigation) and returns void by design.
 */
export const startLogin = () => {
  if (typeof window === "undefined") return;
  // Keep minting the state nonce/cookie for parity with the previous
  // contract (some callers may still expect it to exist), even though the
  // actual /login screen's Google flow manages its own redirect state.
  try {
    const redirectUri = `${window.location.origin}/api/oauth/callback`;
    const nonce = crypto.randomUUID();
    document.cookie = `${OAUTH_STATE_COOKIE}=${nonce}; Path=/; Max-Age=600; SameSite=None; Secure`;
    encodeOAuthState({ redirectUri, nonce });
  } catch {
    // Non-fatal: proceed to /login regardless.
  }
  if (window.location.pathname !== "/login") {
    window.location.assign("/login");
  }
};
