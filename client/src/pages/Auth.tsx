import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { LogIn } from "lucide-react";
import { COOKIE_NAME } from "@shared/const";

function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" className="google-mark">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.39-4.55H24v9.02h12.88c-.58 2.96-2.26 5.48-4.76 7.18l7.73 6C44.36 38.09 46.98 31.85 46.98 24.55Z" />
      <path fill="#FBBC05" d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.27-3.13.76-4.59l-7.98-6.2A23.9 23.9 0 0 0 0 24c0 3.87.93 7.52 2.57 10.78l7.96-6.19Z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.9-5.8l-7.73-6c-2.14 1.44-4.88 2.3-8.17 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z" />
    </svg>
  );
}

const errorMessages: Record<string, string> = {
  access_denied: "Anmeldung abgebrochen.",
  token_exchange_failed: "Die Anmeldung bei Google ist fehlgeschlagen. Bitte erneut versuchen.",
  userinfo_failed: "Das Nutzerprofil konnte nicht geladen werden. Bitte erneut versuchen.",
  server_error: "Ein Serverfehler ist aufgetreten. Bitte später erneut versuchen.",
  native_failed: "Die Anmeldung ist fehlgeschlagen. Bitte erneut versuchen.",
};

/**
 * Single sign-in screen. The account system is Google OAuth 2.0 (see
 * server/_core/googleAuth.ts) — no separate register/reset screens, since
 * there is no password to create or reset. Old /register and
 * /forgot-password links land here too.
 *
 * Web: classic redirect flow (/api/auth/google/start).
 * Native (Capacitor/Android): Google blocks OAuth inside embedded WebViews —
 * instead the @codetrix-studio/capacitor-google-auth plugin uses Google Play
 * Services to obtain an ID token, which we send to /api/auth/google/native.
 * The returned session token is stored in sessionStorage in the format the
 * trpc client already forwards as a Bearer fallback (see client/src/main.tsx),
 * so the session survives even if the WebView drops cross-site cookies.
 */
export default function Auth() {
  const [pending, setPending] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get("error")
  );
  const isNative = Capacitor.isNativePlatform();
  const apiBase = (import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");

  useEffect(() => {
    if (window.location.pathname !== "/login") {
      window.history.replaceState(null, "", "/login" + window.location.search);
    }
  }, []);

  async function nativeSignIn() {
    setPending(true);
    try {
      const { GoogleAuth } = await import("@codetrix-studio/capacitor-google-auth");
      await GoogleAuth.initialize();
      const result = await GoogleAuth.signIn();
      const idToken = result.authentication?.idToken;
      if (!idToken) throw new Error("missing id token");

      const res = await fetch(`${apiBase}/api/auth/google/native`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      if (!res.ok) throw new Error(`native login failed (${res.status})`);
      const data = (await res.json()) as { sessionToken?: string };

      if (data.sessionToken) {
        try {
          sessionStorage.setItem("manus-cookie", `${COOKIE_NAME}=${data.sessionToken}`);
        } catch {
          // sessionStorage nicht verfuegbar — Cookie-Flow greift dann.
        }
      }
      window.location.assign("/");
    } catch (err) {
      console.error("[NativeLogin] failed", err);
      setErrorCode("native_failed");
    } finally {
      setPending(false);
    }
  }

  const errorMessage = errorCode
    ? errorMessages[errorCode] ?? "Anmeldung fehlgeschlagen. Bitte erneut versuchen."
    : null;

  return (
    <main className="auth-shell">
      <section className="auth-stack" aria-labelledby="auth-title">
        <header className="auth-heading">
          <div className="brand-icon" aria-hidden="true"><LogIn size={20} strokeWidth={1.8} /></div>
          <h1 id="auth-title">Willkommen zurück</h1>
          <p>Melde dich mit deinem Google-Konto an</p>
        </header>

        <div className="auth-card">
          {isNative ? (
            <button
              type="button"
              className="google-button"
              onClick={nativeSignIn}
              disabled={pending}
            >
              <GoogleMark />
              <span>{pending ? "Anmeldung läuft…" : "Mit Google anmelden"}</span>
            </button>
          ) : (
            <a className="google-button" href="/api/auth/google/start">
              <GoogleMark />
              <span>Mit Google anmelden</span>
            </a>
          )}
          {errorMessage && (
            <p className="form-notice info" role="status">{errorMessage}</p>
          )}
        </div>
      </section>
      <span className="sr-only">Agenten-Villa Pro</span>
    </main>
  );
}
