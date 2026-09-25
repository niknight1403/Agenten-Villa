import { useMemo } from "react";
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  Loader2,
  LockKeyhole,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  ShieldCheck,
  Square,
} from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { startLogin } from "@/const";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

function formatNumber(value: number | undefined) {
  return typeof value === "number" ? value.toLocaleString("de-DE") : "—";
}

export default function Controller() {
  const { isAuthenticated, loading } = useAuth();
  const statusQuery = trpc.agent.status.useQuery(undefined, {
    enabled: isAuthenticated,
    refetchInterval: 5_000,
    refetchOnWindowFocus: true,
  });
  const controlMutation = trpc.agent.setState.useMutation({
    onSuccess: async result => {
      await statusQuery.refetch();
      toast.success(
        result.state === "RUNNING"
          ? "Mastervillage gestartet"
          : "Mastervillage gestoppt"
      );
    },
    onError: error => toast.error(error.message),
  });

  const status = statusQuery.data;
  const isRunning = status?.state === "RUNNING";
  const villa = status?.villa;
  const enabledPacks = useMemo(
    () => villa?.packs.filter(pack => pack.enabled).length ?? 0,
    [villa?.packs]
  );

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100 grid place-items-center">
        <Loader2 className="animate-spin" aria-label="Lade Controller" />
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100 grid place-items-center p-6">
        <section className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-8 text-center shadow-2xl">
          <LockKeyhole className="mx-auto mb-4 text-amber-400" size={40} />
          <h1 className="text-2xl font-semibold">Mastervillage Controller</h1>
          <p className="mt-3 text-sm text-slate-400">
            Melde dich an, um den globalen Controller zu öffnen.
          </p>
          <button
            className="mt-6 rounded-xl bg-blue-500 px-5 py-3 font-medium text-white hover:bg-blue-400"
            onClick={() => startLogin()}
          >
            Anmelden
          </button>
        </section>
      </main>
    );
  }

  if (status && !status.isAdmin) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100 grid place-items-center p-6">
        <section className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-8 text-center shadow-2xl">
          <ShieldCheck className="mx-auto mb-4 text-rose-400" size={40} />
          <h1 className="text-2xl font-semibold">
            Administratorzugriff erforderlich
          </h1>
          <p className="mt-3 text-sm text-slate-400">
            Der globale Start/Stop-Controller ist ausschließlich für den
            konfigurierten Administrator verfügbar.
          </p>
          <a
            className="mt-6 inline-flex items-center gap-2 rounded-xl border border-slate-700 px-5 py-3 font-medium hover:bg-slate-800"
            href="/"
          >
            {" "}
            <ArrowLeft size={17} /> Zur Agenten-Villa
          </a>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-8">
      <div className="mx-auto max-w-5xl">
        <header className="flex flex-col gap-5 border-b border-slate-800 pb-7 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <a
              className="mb-4 inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white"
              href="/"
            >
              <ArrowLeft size={16} /> Zur Agenten-Villa
            </a>
            <div className="flex items-center gap-3">
              <Bot className="text-blue-400" size={30} />
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-400">
                  /core/controller
                </p>
                <h1 className="text-3xl font-bold tracking-tight">
                  Mastervillage Controller
                </h1>
              </div>
            </div>
            <p className="mt-3 max-w-2xl text-slate-400">
              Globaler Betriebsstatus für die logisch provisionierten
              Agentenplätze. Agenten werden nur bei Bedarf aktiviert; der
              Controller startet keine 10.000 kostenpflichtigen Prozesse.
            </p>
          </div>
          <button
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-50"
            onClick={() => statusQuery.refetch()}
            disabled={statusQuery.isFetching}
          >
            <RefreshCw
              className={statusQuery.isFetching ? "animate-spin" : ""}
              size={16}
            />{" "}
            Aktualisieren
          </button>
        </header>

        <section className="mt-8 grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
          <div
            className={`rounded-3xl border p-7 shadow-2xl ${isRunning ? "border-emerald-500/40 bg-emerald-950/30" : "border-amber-500/30 bg-slate-900"}`}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm text-slate-400">Globaler Zustand</p>
                <div className="mt-2 flex items-center gap-3">
                  <span
                    className={`h-3 w-3 rounded-full ${isRunning ? "bg-emerald-400 shadow-[0_0_18px_#34d399]" : "bg-amber-400"}`}
                  />
                  <h2 className="text-4xl font-bold">{status?.state ?? "—"}</h2>
                </div>
              </div>
              {isRunning ? (
                <CheckCircle2 className="text-emerald-400" size={34} />
              ) : (
                <PauseCircle className="text-amber-400" size={34} />
              )}
            </div>
            <p className="mt-5 text-sm leading-6 text-slate-300">
              {isRunning
                ? "Das Mastervillage darf neue Arbeitszyklen annehmen. Anbieterlimits, Sicherheitsgrenzen und die explizite Fallback-Freigabe bleiben aktiv."
                : "Das Mastervillage nimmt keine neuen Agentenzyklen an. Bereits abgeschlossene Zustände bleiben erhalten."}
            </p>
            <button
              className={`mt-7 inline-flex w-full items-center justify-center gap-3 rounded-2xl px-5 py-4 text-lg font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${isRunning ? "bg-rose-500 text-white hover:bg-rose-400" : "bg-emerald-500 text-slate-950 hover:bg-emerald-400"}`}
              onClick={() =>
                controlMutation.mutate({
                  state: isRunning ? "STOPPED" : "RUNNING",
                })
              }
              disabled={controlMutation.isPending || !status?.isAdmin}
            >
              {controlMutation.isPending ? (
                <Loader2 className="animate-spin" size={22} />
              ) : isRunning ? (
                <Square size={20} />
              ) : (
                <PlayCircle size={22} />
              )}
              {controlMutation.isPending
                ? "Status wird gespeichert …"
                : isRunning
                  ? "Mastervillage stoppen"
                  : "Mastervillage starten"}
            </button>
          </div>

          <div className="rounded-3xl border border-slate-800 bg-slate-900 p-7">
            <h2 className="text-lg font-semibold">Kapazität & Packs</h2>
            <dl className="mt-5 grid grid-cols-2 gap-4">
              <div className="rounded-2xl bg-slate-800/70 p-4">
                <dt className="text-xs text-slate-400">Logische Plätze</dt>
                <dd className="mt-1 text-2xl font-bold">
                  {formatNumber(villa?.logicalAgentCapacity)}
                </dd>
              </div>
              <div className="rounded-2xl bg-slate-800/70 p-4">
                <dt className="text-xs text-slate-400">Aktiv provisioniert</dt>
                <dd className="mt-1 text-2xl font-bold">
                  {formatNumber(villa?.activeLogicalAgents)}
                </dd>
              </div>
              <div className="rounded-2xl bg-slate-800/70 p-4">
                <dt className="text-xs text-slate-400">Verfügbar</dt>
                <dd className="mt-1 text-2xl font-bold">
                  {formatNumber(villa?.availableLogicalAgents)}
                </dd>
              </div>
              <div className="rounded-2xl bg-slate-800/70 p-4">
                <dt className="text-xs text-slate-400">Packs aktiv</dt>
                <dd className="mt-1 text-2xl font-bold">{enabledPacks}</dd>
              </div>
            </dl>
            <div className="mt-5 flex items-center gap-2 text-sm text-slate-400">
              <ShieldCheck size={16} className="text-emerald-400" /> Admin:{" "}
              {status?.administrator.fullProductAccess
                ? "vollständiger Produktzugriff"
                : "nicht berechtigt"}
            </div>
          </div>
        </section>

        <section className="mt-5 rounded-3xl border border-slate-800 bg-slate-900 p-7">
          <div className="flex items-center gap-3">
            <ShieldCheck className="text-emerald-400" size={22} />
            <h2 className="text-lg font-semibold">Sicherheitsregeln</h2>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Providerlimits", villa?.policy.providerLimitsRespected],
              [
                "Keine bezahlte Rotation",
                villa?.policy.noPaidOrRotatingFallback,
              ],
              ["Lazy-Provisionierung", villa?.provisioning === "lazy"],
              [
                "Tool-Schutzregeln",
                villa?.policy.externalToolWritesRequireExistingSafetyGuards,
              ],
            ].map(([label, enabled]) => (
              <div
                className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-sm"
                key={String(label)}
              >
                <CheckCircle2
                  className={enabled ? "text-emerald-400" : "text-rose-400"}
                  size={17}
                />
                {label}
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
