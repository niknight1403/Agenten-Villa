import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowLeft,
  Bot,
  CheckCircle2,
  Loader2,
  LockKeyhole,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Square,
} from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { startLogin } from "@/const";
import { trpc } from "@/lib/trpc";
import { TokenBudgetWidget } from "@/components/TokenBudgetWidget";
import { RoutingPanel } from "@/components/RoutingPanel";
import { flowErrorMessage } from "@/lib/queryFlow";
import { toast } from "sonner";

function formatNumber(value: number | undefined) {
  return typeof value === "number" ? value.toLocaleString("de-DE") : "—";
}

type WatchdogTick = {
  at: string;
  tick: number;
  leaseSweep: "ok" | "error" | "skipped";
  database: { status: string; checkedAt: string } | null;
  providers: Array<{ name: string; status: string; cached: boolean }>;
  interruptedMissions: number | null;
  metrics: {
    totals: { completed: number; partial: number; failed: number };
    averageDurationMs: number;
    samples: number;
  } | null;
};

/**
 * 24/7-Watchdog: zeigt die echten Loop-Ticks des Controllers live über
 * SSE (/api/controller/stream) — Lease-Sweep, DB-Sonde, Provider-Status
 * und die Anzahl unterbrochener Missionen (nur Anzeige, kein Auto-Restart).
 */
function WatchdogPanel() {
  const [watchStatus, setWatchStatus] = useState<string | null>(null);
  const [tick, setTick] = useState<WatchdogTick | null>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const source = new EventSource("/api/controller/stream");
    source.onopen = () => setLive(true);
    source.onmessage = event => {
      try {
        const data = JSON.parse(event.data) as
          | { type: "state"; state: { status?: string } }
          | { type: "tick"; report: WatchdogTick };
        if (data.type === "state") setWatchStatus(data.state?.status ?? null);
        if (data.type === "tick") setTick(data.report);
      } catch {
        /* unvollständige Nachrichten ignorieren */
      }
    };
    source.onerror = () => setLive(false);
    return () => source.close();
  }, []);

  const lastTickAt = tick ? new Date(tick.at) : null;
  const runTotal = tick?.metrics?.samples ?? 0;
  const successRate =
    tick?.metrics && runTotal > 0
      ? Math.round((tick.metrics.totals.completed / runTotal) * 100)
      : null;

  return (
    <section className="mt-5 rounded-3xl border border-slate-800 bg-slate-900 p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Activity className={live ? "text-emerald-400" : "text-slate-500"} size={22} />
          <div>
            <h2 className="text-lg font-semibold">24/7-Watchdog</h2>
            <p className="text-xs text-slate-500">
              Lease-Sweep, DB-Sonde und Provider-Status — ein begrenzter Tick pro Minute
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span
            className={`h-2.5 w-2.5 rounded-full ${live ? "bg-emerald-400 shadow-[0_0_12px_#34d399]" : "bg-slate-600"}`}
          />
          <span className="text-slate-400">
            {live ? "Livestream verbunden" : "Verbinde …"}
          </span>
          {watchStatus ? (
            <span
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${watchStatus === "RUNNING" ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"}`}
            >
              Loop {watchStatus}
            </span>
          ) : null}
        </div>
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-2xl bg-slate-800/70 p-4">
          <dt className="text-xs text-slate-400">Ticks insgesamt</dt>
          <dd className="mt-1 text-2xl font-bold">{formatNumber(tick?.tick)}</dd>
        </div>
        <div className="rounded-2xl bg-slate-800/70 p-4">
          <dt className="text-xs text-slate-400">Letzter Tick</dt>
          <dd className="mt-1 text-2xl font-bold">
            {lastTickAt ? lastTickAt.toLocaleTimeString("de-DE") : "—"}
          </dd>
        </div>
        <div className="rounded-2xl bg-slate-800/70 p-4">
          <dt className="text-xs text-slate-400">Datenbank</dt>
          <dd
            className={`mt-1 text-2xl font-bold ${
              tick?.database?.status === "verbunden"
                ? "text-emerald-300"
                : tick?.database
                  ? "text-rose-300"
                  : "text-slate-400"
            }`}
          >
            {tick?.database?.status ?? "—"}
          </dd>
        </div>
        <div className="rounded-2xl bg-slate-800/70 p-4">
          <dt className="text-xs text-slate-400">Unterbrochene Missionen</dt>
          <dd
            className={`mt-1 text-2xl font-bold ${
              (tick?.interruptedMissions ?? 0) > 0 ? "text-amber-300" : ""
            }`}
          >
            {formatNumber(tick?.interruptedMissions ?? undefined)}
          </dd>
          {/* Sprint 066 — HITL: Der Watchdog zaehlt nur; die Pruefung und
              der freigabepflichtige Neustart passiert in Elite Mission
              Control, niemals automatisch. */}
          {(tick?.interruptedMissions ?? 0) > 0 ? (
            <a
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-amber-300 underline-offset-2 hover:underline"
              href="/core/elite"
            >
              Zur Prüfung und Freigabe
            </a>
          ) : null}
        </div>
      </dl>

      <div className="mt-5 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-400">Provider:</span>
        {tick?.providers.length ? (
          tick.providers.map(provider => (
            <span
              key={provider.name}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium ${
                provider.status === "valid"
                  ? "bg-emerald-500/15 text-emerald-300"
                  : provider.status === "consent_required"
                    ? "bg-slate-700/60 text-slate-300"
                    : "bg-rose-500/15 text-rose-300"
              }`}
            >
              {provider.name} · {provider.status}
            </span>
          ))
        ) : (
          <span className="text-xs text-slate-500">
            Status-Sonden laufen alle 5 Ticks
          </span>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-4 text-xs text-slate-500">
        <span>
          Lease-Sweep:{" "}
          <span
            className={
              tick?.leaseSweep === "error" ? "text-rose-300" : "text-emerald-300"
            }
          >
            {tick?.leaseSweep ?? "—"}
          </span>
        </span>
        <span>
          Elite-Läufe erfasst: {formatNumber(runTotal)}
        </span>
        <span>
          Erfolgsquote: {successRate === null ? "—" : `${successRate} %`}
        </span>
        <span className="text-slate-600">
          Mission-Neustarts bleiben freigabepflichtig (HITL)
        </span>
      </div>
    </section>
  );
}

export default function Controller() {
  const { isAuthenticated, loading } = useAuth({
    redirectOnUnauthenticated: true,
    redirectPath: "/login",
  });
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

  // Sprint 069 — kein Flow endet blockiert: Status-Fehler zeigt eine
  // lesbare Karte mit Retry statt einer still deaktivierten Seite.
  if (statusQuery.isError) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100 grid place-items-center p-6">
        <section className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-8 text-center shadow-2xl">
          <h1 className="text-2xl font-semibold">Controller-Status nicht verfügbar</h1>
          <p className="mt-3 text-sm text-slate-400">{flowErrorMessage(statusQuery.error)}</p>
          <button
            className="mt-6 rounded-xl bg-blue-500 px-5 py-3 font-medium text-white hover:bg-blue-400"
            onClick={() => statusQuery.refetch()}
          >
            Erneut laden
          </button>
        </section>
      </main>
    );
  }

  if (status && !status.canControl && !status.isAdmin) {
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
              Agentenplätze. Administrator Elite aktiviert autonome
              Idee-zu-Projekt-Missionen ohne lokales Chat- oder
              Token-Gesamtkontingent.
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

        <a
          href="/core/elite"
          className="mt-7 flex flex-col gap-4 rounded-3xl border border-violet-500/35 bg-violet-950/30 p-6 transition hover:border-violet-400 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-start gap-4">
            <span className="rounded-2xl bg-violet-500/15 p-3 text-violet-300">
              <Rocket size={26} />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-300">
                Administrator Elite
              </p>
              <h2 className="mt-1 text-xl font-bold">Elite Mission Control</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
                Idee eingeben, Repository analysieren, auf agent/* implementieren,
                Tests und Dokumentation ergänzen und als Draft-PR übergeben.
              </p>
            </div>
          </div>
          <span className="rounded-xl bg-violet-500 px-4 py-2 text-center text-sm font-semibold text-white">
            Mission starten
          </span>
        </a>
        <section className="mt-5 grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
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
                // Sprint 047 — Freigabepunkt: Anhalten nur nach Quittung.
                isRunning && !window.confirm("Den Agentenbetrieb für alle Konten anhalten?")
                  ? undefined
                  : controlMutation.mutate({
                      state: isRunning ? "STOPPED" : "RUNNING",
                      ...(isRunning ? { acknowledgeStop: true } : {}),
                    })
              }
              disabled={controlMutation.isPending || !status?.canControl}
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
            <h2 className="text-lg font-semibold">Kapazität & Elite</h2>
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
                <dt className="text-xs text-slate-400">Elite Aktionen</dt>
                <dd className="mt-1 text-2xl font-bold">
                  {status?.github.actionsPerEliteMission ?? "—"}
                </dd>
              </div>
              <div className="rounded-2xl bg-slate-800/70 p-4">
                <dt className="text-xs text-slate-400">Packs aktiv</dt>
                <dd className="mt-1 text-2xl font-bold">{enabledPacks}</dd>
              </div>
            </dl>
            <div className="mt-5 space-y-2 text-sm text-slate-400">
              <div className="flex items-center gap-2">
                <ShieldCheck size={16} className="text-emerald-400" />
                {status?.administrator.fullProductAccess
                  ? "Vollständiger Administratorzugriff"
                  : "Nicht berechtigt"}
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 size={16} className="text-emerald-400" />
                {status?.administrator.unlimitedLocalTurns
                  ? "Kein lokales Chat-Gesamtkontingent"
                  : "Lokales Chatlimit aktiv"}
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 size={16} className="text-emerald-400" />
                {status?.administrator.unlimitedLocalTokenQuota
                  ? "Kein lokales Token-Gesamtkontingent"
                  : "Lokales Tokenlimit aktiv"}
              </div>
            </div>
          </div>
        </section>

        <WatchdogPanel />\n      <TokenBudgetWidget />
      <RoutingPanel />

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
