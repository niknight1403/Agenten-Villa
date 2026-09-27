import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

const labels = { new: "Neu", contacted: "Kontaktiert", closed: "Geschlossen", opted_out: "Kontaktwiderspruch" } as const;
type Status = keyof typeof labels;

export default function DemoAdmin() {
  const { user, isAuthenticated, loading } = useAuth();
  const isAdmin = user?.role === "admin";
  const requests = trpc.demo.list.useQuery(undefined, { enabled: isAuthenticated && isAdmin });
  const update = trpc.demo.setStatus.useMutation({
    onSuccess: () => requests.refetch(),
    onError: error => toast.error(error.message),
  });

  if (loading) return <main className="min-h-screen bg-slate-950 p-8 text-slate-100">Lade Verwaltung …</main>;
  if (!isAuthenticated || !isAdmin) return <main className="min-h-screen bg-slate-950 p-8 text-slate-100">Administratorzugriff erforderlich. <a className="text-cyan-300" href="/login">Anmelden</a></main>;

  function changeStatus(id: number, next: Status) {
    if (next === "opted_out" && !window.confirm("Kontaktwiderspruch endgültig markieren? Danach ist diese Anfrage nicht mehr kontaktierbar.")) return;
    update.mutate({ id, status: next });
  }

  return <main className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100 sm:px-8">
    <div className="mx-auto max-w-5xl">
      <a href="/core/elite" className="text-sm text-cyan-300">← Elite Mission Control</a>
      <h1 className="mt-5 text-3xl font-semibold">Demoanfragen</h1>
      <p className="mt-2 text-sm text-slate-400">Nur Administratoren sehen die letzten 100 Anfragen. Diese Seite versendet keine Nachrichten. Kontaktwidersprüche dürfen nicht reaktiviert werden.</p>
      {requests.isPending && <p className="mt-8">Anfragen werden geladen …</p>}
      {requests.error && <p role="alert" className="mt-8 text-rose-300">{requests.error.message}</p>}
      {requests.data?.length === 0 && <p className="mt-8 text-slate-300">Noch keine Demoanfragen.</p>}
      <div className="mt-8 space-y-4">
        {requests.data?.map(item => <article key={item.id} className="rounded-2xl border border-white/10 bg-slate-900 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h2 className="font-semibold">{item.company} · {item.name}</h2><p className="mt-1 text-sm text-slate-400">Eingang: {new Date(item.createdAt).toLocaleString("de-DE")} · Zustimmung: {new Date(item.consentedAt).toLocaleString("de-DE")}</p></div>
            <span className="rounded-full border border-cyan-500/30 px-3 py-1 text-xs text-cyan-200">{labels[item.status]}</span>
          </div>
          <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-6 text-slate-300">{item.projectIdea}</p>
          <p className="mt-4 break-all text-sm">{item.status === "opted_out" ? <span className="text-slate-400">{item.email}</span> : <a className="text-cyan-300 underline" href={`mailto:${item.email}`}>{item.email}</a>}</p>
          {item.status === "opted_out" ? <p className="mt-4 text-sm text-amber-300">Keine weitere Kontaktaufnahme · Widerspruch: {item.optedOutAt ? new Date(item.optedOutAt).toLocaleString("de-DE") : "gesetzt"}</p> :
            <div className="mt-4 flex flex-wrap gap-2">{(["new", "contacted", "closed", "opted_out"] as const).filter(next => next !== item.status).map(next =>
              <button key={next} disabled={update.isPending} onClick={() => changeStatus(item.id, next)} className={`min-h-10 rounded-lg border px-3 text-sm disabled:opacity-50 ${next === "opted_out" ? "border-amber-500/50 text-amber-200" : "border-slate-600 text-slate-200"}`}>{labels[next]}</button>
            )}</div>}
        </article>)}
      </div>
    </div>
  </main>;
}
