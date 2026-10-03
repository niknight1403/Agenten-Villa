import { useCallback, useEffect, useState } from "react";
import { Route, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

type ProviderSummary = {
  name: string;
  configured: boolean;
  cooldown: boolean;
  cooldownKind?: "auth" | "limit" | "timeout";
  cooldownSecLeft?: number;
};

type HealthPayload = {
  providers?: ProviderSummary[];
  routing?: { pinned: string | null; pinnedBy: string | null; activeRoute: string | null };
};

const COOLDOWN_LABEL: Record<string, string> = {
  auth: "Schlüssel ungültig",
  limit: "Kontingent-Fenster",
  timeout: "kurzer Ausfall",
};

/**
 * Sprint 079 — Admin-Routing: zeigt transparent, welche kostenlose Route
 * gerade bedient, und erlaubt Admins den Pin auf EINEN Anbieter (oder
 * Rueckkehr zur automatischen Kette). Nicht-Admins sehen nur den Status.
 */
export function RoutingPanel() {
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const load = useCallback(async () => {
    try {
      const healthResponse = await fetch("/api/health");
      const healthData = (await healthResponse.json()) as HealthPayload;
      setHealth(healthData);
      const statusResponse = await fetch(
        "/api/trpc/system.routingStatus?input=" +
          encodeURIComponent(JSON.stringify({ json: {} }))
      );
      const statusData = (await statusResponse.json()) as {
        result?: { data?: { pinned: string | null } };
      };
      setPinned(statusData.result?.data?.pinned ?? null);
    } catch {
      /* Statusanzeige ist optional; das Panel wirft nie */
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = setInterval(load, 15_000);
    return () => clearInterval(interval);
  }, [load]);

  const setOverride = useCallback(
    async (provider: string | null) => {
      if (isPending) return;
      setIsPending(true);
      try {
        const response = await fetch("/api/trpc/system.routingOverride", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ json: { provider } }),
        });
        if (!response.ok) {
          toast.error(
            response.status === 401 || response.status === 403
              ? "Nur Admins dürfen das Routing festlegen."
              : "Routing konnte nicht gesetzt werden."
          );
        } else {
          toast.success(
            provider
              ? `Kette auf ${provider} gepinnt.`
              : "Zurück zur automatischen Kette."
          );
        }
        await load();
      } catch {
        toast.error("Routing konnte nicht gesetzt werden.");
      } finally {
        setIsPending(false);
      }
    },
    [isPending, load]
  );

  const routing = health?.routing;
  const providers = health?.providers ?? [];

  return (
    <section className="mt-5 rounded-3xl border border-slate-800 bg-slate-900 p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Route className="text-cyan-400" size={22} />
          <div>
            <h2 className="text-lg font-semibold">Kostenloses Routing</h2>
            <p className="text-xs text-slate-500">
              Auto-Kette über alle freien Anbieter — Pin nur für Admins
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <ShieldCheck size={16} className="text-emerald-400" />
          <span className="text-slate-400">
            Aktiv:{" "}
            <span className="font-mono font-semibold text-slate-100">
              {routing?.activeRoute ?? "—"}
            </span>
            {routing?.pinned ? (
              <span className="ml-2 rounded-lg bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-300">
                Pin: {routing.pinned}
              </span>
            ) : null}
          </span>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {providers.map(provider => {
          const isPinned = pinned === provider.name;
          return (
            <div
              key={provider.name}
              className={`rounded-2xl border p-4 ${
                isPinned
                  ? "border-amber-500/50 bg-amber-500/10"
                  : "border-slate-800 bg-slate-950/40"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{provider.name}</span>
                <span
                  className={`text-xs font-semibold ${
                    provider.cooldown ? "text-amber-300" : "text-emerald-400"
                  }`}
                >
                  {provider.cooldown
                    ? COOLDOWN_LABEL[provider.cooldownKind ?? ""] ?? "gesperrt"
                    : "bereit"}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {provider.configured
                  ? provider.cooldown && provider.cooldownSecLeft
                    ? `frei in ~${provider.cooldownSecLeft} s`
                    : "konfiguriert"
                  : "kein Schlüssel konfiguriert"}
              </p>
              <button
                onClick={() => void setOverride(isPinned ? null : provider.name)}
                disabled={isPending || !provider.configured}
                className={`mt-3 w-full rounded-lg px-3 py-2 text-xs font-bold transition-all disabled:opacity-50 ${
                  isPinned
                    ? "bg-amber-500/15 border border-amber-500/40 text-amber-300 hover:bg-amber-500/25"
                    : "bg-slate-800/60 border border-slate-700 text-slate-300 hover:bg-slate-700/60"
                }`}
              >
                {isPinned ? "Pin aufheben" : "Kette festsetzen"}
              </button>
            </div>
          );
        })}
      </div>

      {pinned ? (
        <button
          onClick={() => void setOverride(null)}
          disabled={isPending}
          className="mt-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-xs font-bold text-emerald-300 transition-all hover:bg-emerald-500/20 disabled:opacity-50"
        >
          Zurück zur automatischen Kette (alle freien Anbieter)
        </button>
      ) : null}
    </section>
  );
}
