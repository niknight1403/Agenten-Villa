import { FormEvent, useState } from "react";
import {
  ArrowLeft,
  Boxes,
  CheckCircle2,
  Github,
  Loader2,
  PlayCircle,
  PlugZap,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Sparkles,
  XCircle,
} from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { startLogin } from "@/const";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

export default function EliteMission() {
  const { isAuthenticated, loading } = useAuth();
  const requestedVillaId = Number(new URLSearchParams(window.location.search).get("villaId"));
  const villaId = Number.isSafeInteger(requestedVillaId) && requestedVillaId > 0 ? requestedVillaId : null;
  const villasQuery = trpc.villa.list.useQuery(undefined, { enabled: isAuthenticated });
  const selectedVilla = villasQuery.data?.find(villa => villa.id === villaId);
  const [prompt, setPrompt] = useState("");
  const [lastResult, setLastResult] = useState<{
    answer: string;
    completed: boolean;
    branch: string | null;
    githubActions: number;
    model: string;
    pullRequest:
      | { number?: number; url?: string; branch?: string }
      | null;
  } | null>(null);

  const statusQuery = trpc.agent.status.useQuery(undefined, {
    enabled: isAuthenticated,
    refetchOnWindowFocus: true,
  });
  const controlMutation = trpc.agent.setState.useMutation({
    onSuccess: () => statusQuery.refetch(),
    onError: error => toast.error(error.message),
  });
  const missionMutation = trpc.agent.eliteMission.useMutation({
    onError: error => toast.error(error.message),
  });

  const status = statusQuery.data;
  const isAdmin = Boolean(status?.isAdmin);
  const running = status?.state === "RUNNING";
  const ready =
    running &&
    Boolean(status?.providers.openrouter) &&
    Boolean(status?.github?.configured);

  async function submitMission(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const objective = prompt.trim();
    if (!objective || missionMutation.isPending) return;
    setLastResult(null);
    try {
      const result = await missionMutation.mutateAsync({
        prompt: objective,
        history: [],
        specialty: "Autonomous Product Engineering",
        ...(villaId ? { villaId } : {}),
      });
      setLastResult({
        answer: result.answer,
        completed: Boolean(result.completed),
        branch: result.branch ?? null,
        githubActions: result.githubActions ?? 0,
        model: result.model,
        pullRequest: result.pullRequest ?? null,
      });
      if (result.completed) {
        toast.success("Elite-Mission als Draft-PR vorbereitet.");
      } else {
        toast.info(
          "Mission beendet, aber noch ohne vollständige Draft-PR-Übergabe."
        );
      }
    } catch {
      // Error toast is handled by the mutation.
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100 grid place-items-center">
        <Loader2 className="animate-spin" aria-label="Lade Elite Mission Control" />
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100 grid place-items-center p-6">
        <section className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-8 text-center shadow-2xl">
          <ShieldCheck className="mx-auto mb-4 text-amber-400" size={42} />
          <h1 className="text-2xl font-semibold">Elite Mission Control</h1>
          <p className="mt-3 text-sm text-slate-400">
            Melde dich als Administrator an, um autonome Projektmissionen zu
            starten.
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

  if (status && !isAdmin) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100 grid place-items-center p-6">
        <section className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-8 text-center shadow-2xl">
          <XCircle className="mx-auto mb-4 text-rose-400" size={42} />
          <h1 className="text-2xl font-semibold">
            Administratorzugriff erforderlich
          </h1>
          <p className="mt-3 text-sm text-slate-400">
            Elite-Missionen können nur vom konfigurierten Administrator
            gestartet werden.
          </p>
          <a
            className="mt-6 inline-flex items-center gap-2 rounded-xl border border-slate-700 px-5 py-3 font-medium hover:bg-slate-800"
            href="/"
          >
            <ArrowLeft size={17} /> Zur Agenten-Villa
          </a>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-8">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-col gap-5 border-b border-slate-800 pb-7 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <a
              className="mb-4 inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white"
              href="/core/controller"
            >
              <ArrowLeft size={16} /> Mastervillage Controller
            </a>
            <div className="flex items-center gap-3">
              <Rocket className="text-violet-400" size={34} />
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-violet-400">
                  Administrator Elite
                </p>
                <h1 className="text-3xl font-bold tracking-tight">
                  Elite Mission Control
                </h1>
              </div>
            </div>
            <p className="mt-3 max-w-3xl text-slate-400">
              Eine Idee eingeben, die Villa untersucht das Repository,
              plant die Architektur, implementiert auf einem geschützten
              agent/*-Branch, ergänzt Tests und Dokumentation und bereitet
              einen Draft-PR zur Prüfung vor.
            </p>
            {villaId && (
              <div className="mt-4 rounded-2xl border border-cyan-500/30 bg-cyan-500/10 p-4 text-sm">
                <p className="font-semibold text-cyan-200">{selectedVilla ? `Villa ${selectedVilla.name} · Superagent` : "Projekt-Villa wird geladen …"}</p>
                {selectedVilla?.projectBrief && <p className="mt-1 text-slate-300">{selectedVilla.projectBrief}</p>}
                {villasQuery.isSuccess && !selectedVilla && <p className="mt-1 text-rose-300">Diese Villa gehört nicht zu deinem Konto oder wurde entfernt.</p>}
              </div>
            )}
          </div>
          <button
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
            onClick={() => statusQuery.refetch()}
            disabled={statusQuery.isFetching}
          >
            <RefreshCw
              className={statusQuery.isFetching ? "animate-spin" : ""}
              size={16}
            />
            Status aktualisieren
          </button>
        </header>

        <section className="mt-7 grid gap-5 lg:grid-cols-[1.35fr_0.65fr]">
          <div className="rounded-3xl border border-violet-500/25 bg-slate-900 p-6 shadow-2xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-violet-500/15 px-3 py-1 text-xs font-semibold text-violet-300">
                ELITE AKTIV
              </span>
              <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-300">
                Kein lokales Chat-Gesamtkontingent
              </span>
              <span className="rounded-full bg-blue-500/15 px-3 py-1 text-xs font-semibold text-blue-300">
                Free-Tier-First
              </span>
            </div>

            {!running && (
              <div className="mt-5 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
                <p className="text-sm text-amber-100">
                  Der Superagent ist gestoppt. Starte das Mastervillage, bevor
                  du eine Mission ausführst.
                </p>
                <button
                  className="mt-3 inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
                  onClick={() => controlMutation.mutate({ state: "RUNNING" })}
                  disabled={controlMutation.isPending}
                >
                  {controlMutation.isPending ? (
                    <Loader2 className="animate-spin" size={18} />
                  ) : (
                    <PlayCircle size={18} />
                  )}
                  Superagent starten
                </button>
              </div>
            )}

            <form className="mt-6" onSubmit={submitMission}>
              <label className="text-sm font-semibold" htmlFor="elite-objective">
                Projektidee / Missionsziel
              </label>
              <textarea
                id="elite-objective"
                className="mt-2 min-h-48 w-full rounded-2xl border border-slate-700 bg-slate-950 p-4 text-sm leading-6 text-slate-100 outline-none transition focus:border-violet-500"
                value={prompt}
                onChange={event => setPrompt(event.target.value)}
                maxLength={12_000}
                placeholder="Beispiel: Entwickle aus der Agenten-Villa eine autonome Software-Projektfabrik. Analysiere zuerst den vorhandenen Code, implementiere die fehlenden Teile, ergänze Tests und Dokumentation und bereite einen Draft-PR vor."
                disabled={missionMutation.isPending}
              />
              <div className="mt-3 flex items-center justify-between gap-4 text-xs text-slate-500">
                <span>{prompt.length.toLocaleString("de-DE")} / 12.000 Zeichen</span>
                <span>
                  max. {status?.github?.actionsPerEliteMission ?? 24} geschützte
                  GitHub-Aktionen je Mission
                </span>
              </div>
              <button
                className="mt-5 inline-flex w-full items-center justify-center gap-3 rounded-2xl bg-violet-500 px-5 py-4 text-lg font-semibold text-white transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-50"
                type="submit"
                disabled={!prompt.trim() || !ready || missionMutation.isPending || Boolean(villaId && !selectedVilla)}
              >
                {missionMutation.isPending ? (
                  <>
                    <Loader2 className="animate-spin" size={22} />
                    Elite-Mission läuft …
                  </>
                ) : (
                  <>
                    <Sparkles size={22} />
                    Idee autonom umsetzen
                  </>
                )}
              </button>
            </form>

            {!status?.providers.openrouter && (
              <p className="mt-4 text-sm text-rose-300">
                OPENROUTER_API_KEY fehlt.
              </p>
            )}
            {!status?.github?.configured && (
              <p className="mt-2 text-sm text-rose-300">
                GITHUB_TOKEN fehlt.
              </p>
            )}
          </div>

          <aside className="space-y-5">
            <section className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
              <div className="flex items-center gap-2">
                <PlugZap className="text-blue-400" size={20} />
                <h2 className="font-semibold">Connectoren</h2>
              </div>
              <div className="mt-4 space-y-3">
                {(status?.connectors ?? []).map(connector => (
                  <div
                    key={connector.id}
                    className="flex items-center justify-between gap-3 rounded-xl bg-slate-950/60 p-3"
                  >
                    <div>
                      <p className="text-sm font-medium">{connector.name}</p>
                      <p className="text-xs text-slate-500">{connector.mode}</p>
                    </div>
                    {connector.configured ? (
                      <CheckCircle2 className="text-emerald-400" size={18} />
                    ) : (
                      <XCircle className="text-slate-600" size={18} />
                    )}
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
              <div className="flex items-center gap-2">
                <Boxes className="text-violet-400" size={20} />
                <h2 className="font-semibold">Mission-Pipeline</h2>
              </div>
              <ol className="mt-4 space-y-2 text-sm text-slate-400">
                <li>1. Repository analysieren</li>
                <li>2. Architektur & Akzeptanzkriterien</li>
                <li>3. agent/*-Branch erstellen</li>
                <li>4. Implementieren & refaktorieren</li>
                <li>5. Tests & Dokumentation ergänzen</li>
                <li>6. Änderungen selbst prüfen</li>
                <li>7. CI-Checks beobachten</li>
                <li>8. Draft-PR übergeben</li>
              </ol>
            </section>
          </aside>
        </section>

        {lastResult && (
          <section
            className={`mt-5 rounded-3xl border p-6 ${
              lastResult.completed
                ? "border-emerald-500/30 bg-emerald-950/20"
                : "border-amber-500/30 bg-amber-950/20"
            }`}
          >
            <div className="flex items-start gap-3">
              {lastResult.completed ? (
                <CheckCircle2 className="mt-1 text-emerald-400" size={24} />
              ) : (
                <XCircle className="mt-1 text-amber-400" size={24} />
              )}
              <div className="min-w-0 flex-1">
                <h2 className="text-xl font-semibold">
                  {lastResult.completed
                    ? "Mission zur Prüfung bereit"
                    : "Mission mit offener Arbeit beendet"}
                </h2>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-300">
                  {lastResult.answer}
                </p>
                <div className="mt-4 flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full bg-slate-800 px-3 py-1">
                    {lastResult.githubActions} GitHub-Aktionen
                  </span>
                  <span className="rounded-full bg-slate-800 px-3 py-1">
                    {lastResult.model}
                  </span>
                  {lastResult.branch && (
                    <span className="rounded-full bg-slate-800 px-3 py-1">
                      {lastResult.branch}
                    </span>
                  )}
                </div>
                {lastResult.pullRequest?.url && (
                  <a
                    className="mt-5 inline-flex items-center gap-2 rounded-xl bg-slate-100 px-4 py-2 font-semibold text-slate-950 hover:bg-white"
                    href={lastResult.pullRequest.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Github size={18} />
                    Draft-PR #{lastResult.pullRequest.number ?? ""}
                  </a>
                )}
              </div>
            </div>
          </section>
        )}

        <p className="mt-6 text-xs leading-5 text-slate-500">
          „Unlimited“ bedeutet hier: kein von der Agenten-Villa gesetztes
          Gesamtlimit für Administrator-Chats oder ein lokales Token-Konto.
          Kontextfenster, Ausgabelimits, kostenlose Provider-Kontingente,
          GitHub-API-Limits und Sicherheitsregeln externer Dienste bleiben
          technisch verbindlich und werden nicht umgangen.
        </p>
      </div>
    </main>
  );
}
