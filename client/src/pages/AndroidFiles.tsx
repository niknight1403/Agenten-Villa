import { useState } from "react";
import { Capacitor } from "@capacitor/core";
import { ArrowLeft, CheckCircle2, FolderOpen, HardDrive, Loader2, ScanSearch, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { startLogin } from "@/const";
import { androidStorage } from "@/lib/android-storage";
import { FilePlan, StorageEntry, formatBytes, planFromPrompt, storageSuggestions } from "@/lib/storage-plan";

export default function AndroidFiles() {
  const { isAuthenticated, loading } = useAuth({
    redirectOnUnauthenticated: true,
    redirectPath: "/login",
  });
  const [folder, setFolder] = useState("");
  const [entries, setEntries] = useState<StorageEntry[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [plan, setPlan] = useState<FilePlan | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const native = Capacitor.getPlatform() === "android";

  async function scan() {
    const snapshot = await androidStorage.scan();
    setFolder(snapshot.name);
    setEntries(snapshot.entries);
    setTruncated(snapshot.truncated);
    setPlan(null);
    setSelected(new Set());
  }

  async function pickFolder() {
    setBusy(true);
    setFeedback("");
    try {
      await androidStorage.pickTree();
      await scan();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Ordner konnte nicht geöffnet werden.");
    } finally { setBusy(false); }
  }

  async function refresh() {
    setBusy(true);
    try { await scan(); } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Scan fehlgeschlagen.");
    } finally { setBusy(false); }
  }

  function showPlan(next: FilePlan) {
    setPlan(next);
    setSelected(new Set(next.actions.map(action => action.id)));
    setFeedback("");
  }

  function submitPrompt() {
    const next = planFromPrompt(prompt, entries);
    if (next) showPlan(next);
    else setFeedback("Bitte konkret formulieren, z. B. „Sortiere Bilder“ oder „Lösche Dateien größer als 500 MB“. Allgemeine Löschbefehle werden nicht ausgeführt.");
  }

  async function executePlan() {
    if (!plan || busy) return;
    const actions = plan.actions.filter(action => selected.has(action.id));
    if (!actions.length) return;
    const deletion = actions.some(action => action.operation === "delete");
    const summary = `${actions.length} Datei(en) ${deletion ? "endgültig löschen" : "in Typ-Ordner verschieben"}?${deletion ? " Dieser Schritt kann nicht rückgängig gemacht werden." : ""}`;
    if (!window.confirm(summary)) return;
    setBusy(true);
    let done = 0;
    try {
      for (const action of actions) {
        await androidStorage.execute({ id: action.id, expectedName: action.name, expectedSize: action.size, operation: action.operation, ...(action.category ? { category: action.category } : {}) });
        done += 1;
      }
      setFeedback(`${done} Datei(en) erfolgreich bearbeitet.`);
    } catch (error) {
      setFeedback(`${done} von ${actions.length} Datei(en) bearbeitet. Stopp: ${error instanceof Error ? error.message : "Aktion fehlgeschlagen."}`);
    } finally {
      try { await scan(); } catch { /* Previous status remains visible. */ }
      setBusy(false);
    }
  }

  const suggestions = storageSuggestions(entries);
  const selectedActions = plan?.actions.filter(action => selected.has(action.id)) ?? [];
  const selectedBytes = selectedActions.filter(action => action.operation === "delete").reduce((sum, action) => sum + action.size, 0);

  return <main className="min-h-screen bg-[#091427] px-4 py-6 text-slate-100 sm:px-7">
    <div className="mx-auto max-w-3xl space-y-5">
      <a href="/" className="inline-flex items-center gap-2 text-sm text-cyan-200"><ArrowLeft size={17} /> Agenten Villa</a>
      <header className="rounded-3xl border border-cyan-400/20 bg-gradient-to-br from-[#193568] to-[#0b1933] p-5 shadow-2xl">
        <div className="flex items-center gap-3"><HardDrive className="text-cyan-300" size={28} /><div><p className="text-xs font-semibold tracking-widest text-cyan-300">ANDROID · VILLA WERKZEUG</p><h1 className="text-2xl font-bold">Autonomer Dateimanager</h1></div></div>
        <p className="mt-3 text-sm leading-6 text-slate-300">Der Superagent analysiert nur einen von dir gewählten Ordner. Vorschläge und Prompt-Befehle werden auf dem Gerät geplant. Jede Änderung wird vor der Ausführung angezeigt und bestätigt.</p>
      </header>

      {!loading && !isAuthenticated && <section className="rounded-2xl border border-slate-700 bg-slate-900 p-5"><p>Melde dich an, um die Villa-Werkzeuge zu öffnen.</p><button className="mt-3 rounded-xl bg-cyan-600 px-4 py-2" onClick={startLogin}>Anmelden</button></section>}
      {!native && <section className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 text-sm text-amber-100">Ordnerzugriff ist in der Android-App verfügbar. Diese Web-Ansicht verändert keine lokalen Dateien.</section>}
      {isAuthenticated && native && <>
        <section className="rounded-2xl border border-slate-700 bg-slate-900/80 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Freigegebener Ordner</h2><p className="mt-1 break-all text-sm text-slate-400">{folder || "Noch kein Ordner ausgewählt"}</p></div><button disabled={busy} onClick={pickFolder} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-cyan-600 px-4 font-semibold disabled:opacity-50"><FolderOpen size={18} /> Ordner wählen</button></div>
          {folder && <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-400"><span>{entries.length} Einträge · {formatBytes(entries.filter(entry => !entry.directory).reduce((sum, entry) => sum + entry.size, 0))} in diesem Ordner erfasst</span><button disabled={busy} onClick={refresh} className="inline-flex items-center gap-1 text-cyan-300"><ScanSearch size={16} /> Neu scannen</button></div>}
          {truncated && <p className="mt-3 text-sm text-amber-300">Mehr als 3.000 Einträge: Bitte einen kleineren Ordner wählen. Aktionen sind bis dahin deaktiviert.</p>}
        </section>
        {folder && !truncated && <>
          <section className="rounded-2xl border border-slate-700 bg-slate-900/80 p-5"><h2 className="flex items-center gap-2 font-semibold"><Sparkles size={18} className="text-violet-300" /> Speicherplatz-Vorschläge</h2><div className="mt-3 grid gap-3 sm:grid-cols-2">{suggestions.map(suggestion => <button key={suggestion.title} onClick={() => showPlan(suggestion)} className="min-h-28 rounded-xl border border-slate-600 bg-[#121f3c] p-4 text-left hover:border-cyan-400"><strong>{suggestion.title}</strong><p className="mt-2 text-xs text-slate-400">{suggestion.explanation}</p><span className="mt-2 block text-xs text-cyan-300">{suggestion.actions.length} Dateien{suggestion.potentialBytes ? ` · bis zu ${formatBytes(suggestion.potentialBytes)}` : ""}</span></button>)}</div>{suggestions.length === 0 && <p className="mt-3 text-sm text-slate-400">Keine passenden Dateien im gewählten Ordner.</p>}</section>
          <section className="rounded-2xl border border-slate-700 bg-slate-900/80 p-5"><label htmlFor="file-prompt" className="font-semibold">Auftrag per Prompt</label><textarea id="file-prompt" value={prompt} onChange={event => setPrompt(event.target.value)} maxLength={250} placeholder="Sortiere Bilder · Lösche Dateien größer als 500 MB" className="mt-3 min-h-24 w-full rounded-xl border border-slate-600 bg-[#0b1831] p-3 text-sm outline-none focus:border-cyan-400" /><button disabled={!prompt.trim() || busy} onClick={submitPrompt} className="mt-3 min-h-11 rounded-xl bg-violet-600 px-5 font-semibold disabled:opacity-50">Vorschau erstellen</button></section>
          {plan && <section className="rounded-2xl border border-cyan-500/30 bg-slate-900 p-5" aria-label="Aktionsvorschau"><h2 className="text-lg font-semibold">{plan.title}</h2><p className="mt-1 text-sm text-slate-400">{plan.explanation}</p><p className="mt-3 text-sm text-cyan-300">{selectedActions.length} ausgewählt · möglicher freier Platz: {formatBytes(selectedBytes)}</p><div className="mt-3 max-h-72 space-y-2 overflow-auto">{plan.actions.map(action => <label key={action.id} className="flex items-center gap-3 rounded-xl bg-[#172440] p-3 text-sm"><input type="checkbox" checked={selected.has(action.id)} onChange={() => setSelected(previous => { const next = new Set(previous); if (next.has(action.id)) next.delete(action.id); else next.add(action.id); return next; })} /><span className="min-w-0 flex-1 break-all">{action.name}</span><span className="shrink-0 text-slate-400">{action.operation === "move" ? `→ ${action.category}` : <Trash2 size={16} />}</span><span className="shrink-0 text-slate-400">{formatBytes(action.size)}</span></label>)}</div>{plan.actions.length === 0 && <p className="mt-3 text-sm text-slate-400">Keine passenden Dateien gefunden.</p>}<button disabled={busy || !selectedActions.length} onClick={executePlan} className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-cyan-600 px-4 font-semibold disabled:opacity-50">{busy ? <Loader2 className="animate-spin" size={17} /> : <ShieldCheck size={17} />} Auswahl bestätigen und ausführen</button></section>}
        </>}
      </>}
      {feedback && <p role="status" className="rounded-xl border border-slate-600 bg-slate-800 p-4 text-sm"><CheckCircle2 className="mr-2 inline text-cyan-300" size={16} />{feedback}</p>}
    </div>
  </main>;
}
