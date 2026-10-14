import { Loader2 } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import Auth from "@/pages/Auth";
import { DashboardThemeProvider } from "@/contexts/DashboardThemeContext";
import { useEffect, useState } from "react";

/** Ab wann der Splash zusaetzlich den Cold-Start-Hinweis zeigt (Sekunden). */
const COLD_START_HINT_AFTER_S = 4;

/**
 * Gate in front of the whole app: while the session is loading we show a
 * splash, and an unauthenticated visitor always sees the sign-in screen —
 * never the dashboard. `/demo` stays public (handled in App.tsx) so the
 * marketing/lead page keeps working without an account.
 *
 * Render-Free-Resilienz: Der Server schlaeft nach ~15 Min ein; der erste
 * Aufruf (auth.me) dauert dann real 30-60 s. Frueher stand hier endlos
 * "Anmeldung wird geprüft …" ohne erklaerung — jetzt gibt es ab 4 Sekunden
 * einen klaerenden Hinweis, und bei echtem Verbindungsfehler einen
 * sichtbaren Neuversuch-Button statt eines stillen Spinners.
 */
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading, error, retry } = useAuth();
  const [showHint, setShowHint] = useState(false);

  useEffect(() => {
    if (!loading) {
      setShowHint(false);
      return;
    }
    const timer = setTimeout(() => setShowHint(true), COLD_START_HINT_AFTER_S * 1000);
    return () => clearTimeout(timer);
  }, [loading]);

  const connectionFailed = Boolean(error) && !isAuthenticated;

  if (loading) {
    return (
      <DashboardThemeProvider>
        <main className="auth-shell">
          <section className="auth-stack" aria-label="Anmeldung wird geprüft">
            <div className="brand-icon" aria-hidden="true">
              <Loader2 className="spin" size={20} />
            </div>
            <div className="auth-heading">
              <h1>Agenten-Villa</h1>
              <p>Anmeldung wird geprüft …</p>
              {showHint && (
                <p className="text-sm text-muted-foreground" role="status">
                  Der Server wird gerade gestartet — der erste Aufruf kann bis zu
                  einer Minute dauern. Die Verbindung wird automatisch wiederholt.
                </p>
              )}
            </div>
          </section>
        </main>
      </DashboardThemeProvider>
    );
  }

  if (connectionFailed) {
    return (
      <DashboardThemeProvider>
        <main className="auth-shell">
          <section className="auth-stack" aria-label="Verbindung fehlgeschlagen">
            <div className="brand-icon" aria-hidden="true">
              <Loader2 size={20} strokeWidth={1.8} />
            </div>
            <div className="auth-heading">
              <h1>Agenten-Villa</h1>
              <p>Der Server ist gerade nicht erreichbar.</p>
              <p className="text-sm text-muted-foreground" role="status">
                Der Render-Free-Server wacht nach ~15 Minuten Ruhezeit auf und
                braucht beim ersten Aufruf bis zu einer Minute. Bitte kurz
                warten und es erneut versuchen.
              </p>
              <button
                type="button"
                className="google-button"
                onClick={() => void retry()}
              >
                <span>Erneut versuchen</span>
              </button>
            </div>
          </section>
        </main>
      </DashboardThemeProvider>
    );
  }

  if (!isAuthenticated) {
    return (
      <DashboardThemeProvider>
        <Auth />
      </DashboardThemeProvider>
    );
  }

  return <DashboardThemeProvider>{children}</DashboardThemeProvider>;
}
