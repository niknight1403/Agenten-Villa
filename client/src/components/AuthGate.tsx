import { Loader2 } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import Auth from "@/pages/Auth";
import { DashboardThemeProvider } from "@/contexts/DashboardThemeContext";

/**
 * Gate in front of the whole app: while the session is loading we show a
 * splash, and an unauthenticated visitor always sees the sign-in screen —
 * never the dashboard. `/demo` stays public (handled in App.tsx) so the
 * marketing/lead page keeps working without an account.
 */
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuth();

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
