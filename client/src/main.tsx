import { trpc } from "@/lib/trpc";
import { COOKIE_NAME, UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, splitLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { fetchWithResilience, prewarmServer } from "@/lib/cold-start";
import { startLogin } from "./const";
import "./index.css";
import "./styles/themes.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Sprint 064 — Offline-Chatcache: Cache darf offline weiter
      // angezeigt werden, Verlauf bleibt 30 Minuten lesbar.
      networkMode: "offlineFirst",
      staleTime: 60_000,
      gcTime: 30 * 60_000,
      retry: 1,
    },
  },
});

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;

  if (!isUnauthorized) return;

  startLogin();
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Mutation Error]", error);
  }
});

/**
 * Bearer-Fallback-Header: Wenn die Laufzeit die Session in den
 * sessionStorage gespiegelt hat (Preview-Login, nativer Login, Admin-
 * Bootstrap-Build), wird sie als Authorization-Token mitgeschickt —
 * der regulre Cookie-Flow bleibt funktionsfaehig und hat serverseitig
 * Vorrang.
 */
function authHeaders(): Record<string, string> {
  try {
    const raw = sessionStorage.getItem("manus-cookie");
    if (raw) {
      const prefix = `${COOKIE_NAME}=`;
      const pair = raw.split(";").find((s) => s.trim().startsWith(prefix));
      const token = pair?.trim().slice(prefix.length);
      if (token) {
        return { Authorization: `Bearer ${token}` };
      }
    }
  } catch {
    // sessionStorage unavailable
  }
  return {};
}

/**
 * Zwei Link-Ketten mit getrennten Zeitlimiten:
 *  - agent.* (Agenten-Turns): Die kostenlose Primaerroute ist Ollama auf
 *    der Oracle-Free-VM — CPU-Inferenz grosser Modelle braucht real
 *    Minuten. 600 s deckt auch qwen3.6:27b ab (serverseitiges
 *    OLLAMA_TIMEOUT_MS=600s). Ohne Trennung wuerde der 60s-Standard
 *    Agenten-Turns auf der kostenlosen Route IMMER abwuergen, bevor das
 *    Modell fertig ist.
 *  - alles andere (auth.me, Listen, Mutierungen): 60 s + Retry — genug
 *    fuer Render-Cold-Starts, schnell genug fuer klare Fehlermeldung.
 */
const longTimeoutFetch: typeof globalThis.fetch = (input, init) =>
  fetchWithResilience(input, { ...(init ?? {}), credentials: "include" }, { timeoutMs: 600_000 });
const defaultTimeoutFetch: typeof globalThis.fetch = (input, init) =>
  fetchWithResilience(input, { ...(init ?? {}), credentials: "include" });

const trpcClient = trpc.createClient({
  links: [
    splitLink({
      condition: (op) => op.path.startsWith("agent."),
      true: httpBatchLink({
        url: `${import.meta.env.VITE_API_URL ?? ""}/api/trpc`,
        transformer: superjson,
        headers: () => authHeaders(),
        fetch: longTimeoutFetch,
      }),
      false: httpBatchLink({
        // Absolute Backend-Basis-URL via VITE_API_URL (z. B.
        // https://agenten-villa.onrender.com). Leer => relative URL (Web:
        // Same-Origin, Default in der lokalen Entwicklung). Der Produktions-
        // Build (Dockerfile) pint VITE_API_URL auf die Render-URL.
        url: `${import.meta.env.VITE_API_URL ?? ""}/api/trpc`,
        transformer: superjson,
        headers: () => authHeaders(),
        fetch: defaultTimeoutFetch,
      }),
    }),
  ],
});

// Server sofort vorwaermen (fire-and-forget): Weckt die schlafende Render-
// Instanz, waehrend der Nutzer noch den Splash sieht. Auf Web (Same-Origin)
// harmlos, auf nativ die entscheidende Startzeit-Ersparnis beim Login.
prewarmServer(import.meta.env.VITE_API_URL ?? "");

// Admin-Auto-Login-Build (v1.2.4-admin): Enthaelt der Build eine gepraegte
// Admin-Session (VITE_BOOTSTRAP_SESSION, nur im Admin-APK-Workflow via
// GitHub-Secret gesetzt — Web- und Dev-Builds bleiben unberuehrt), wird sie
// beim App-Start in den Session-Speicher geschrieben. Der tRPC-Client
// sendet sie als Bearer-Token (headers()-Callback unten), der Server
// erkennt den Administrator direkt — kein Google-Picker, kein Warten am
// Login. Widerrufbar ueber JWT_SECRET-Rotation auf Render oder einen
// Neubau ohne das Secret. Bestehende echte Sessions werden nicht
// ueberschrieben.
try {
  const bootstrapSession = import.meta.env.VITE_BOOTSTRAP_SESSION as string | undefined;
  if (bootstrapSession && !sessionStorage.getItem("manus-cookie")) {
    sessionStorage.setItem("manus-cookie", `app_session_id=${bootstrapSession}`);
  }
} catch {
  // sessionStorage nicht verfuegbar — normaler Google-Login-Flow greift.
}

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
