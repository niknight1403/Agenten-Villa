import { type FormEvent, useState } from "react";
import { ArrowRight, CheckCircle2, ShieldCheck, Sparkles } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { DEMO_CONTACT_CONSENT_TEXT } from "@shared/demo-consent";

export default function Demo() {
  const submit = trpc.demo.submit.useMutation();
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [projectIdea, setProjectIdea] = useState("");
  const [contactConsent, setContactConsent] = useState(false);
  const [website, setWebsite] = useState("");
  const [sent, setSent] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submit.isPending || !contactConsent) return;
    try {
      // Actual consent state — never hardcode, otherwise Enter/programmatic
      // submits could record consent that was never given.
      await submit.mutateAsync({ name, company, email, projectIdea, contactConsent, website });
      setSent(true);
    } catch {
      // A visible, non-sensitive error is shown under the form.
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-6xl px-5 py-6 sm:px-8">
        <nav className="flex items-center justify-between gap-4 border-b border-white/10 pb-5">
          <a href="/" className="flex items-center gap-2 font-semibold tracking-wide"><Sparkles size={21} className="text-cyan-300" /> Agenten Villa</a>
          <a href="/login" className="text-sm text-slate-300 hover:text-white">Zur App <ArrowRight size={14} className="ml-1 inline" /></a>
        </nav>
        <div className="grid gap-12 py-12 md:grid-cols-2 md:gap-16 md:py-20">
          <section className="max-w-xl">
            <p className="mb-4 text-xs font-bold uppercase tracking-[0.25em] text-cyan-300">Agenten Villa · Projektwerkstatt</p>
            <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl">Von einer Projektidee zum prüfbaren Software-Entwurf.</h1>
            <p className="mt-6 text-lg leading-8 text-slate-300">Agenten Villa verbindet eine Projekt-Villa mit einem Superagenten. Administratoren können eine Idee am verbundenen GitHub-Projekt analysieren und Änderungen als Draft-Pull-Request vorbereiten.</p>
            <div className="mt-9 space-y-5 text-sm text-slate-300">
              <p className="flex gap-3"><CheckCircle2 className="mt-0.5 shrink-0 text-cyan-300" size={18} /> Projektziel, Chat und Villa werden im Konto gespeichert.</p>
              <p className="flex gap-3"><CheckCircle2 className="mt-0.5 shrink-0 text-cyan-300" size={18} /> Codeänderungen der Elite-Mission gehen auf geschützte Branches und in einen Draft-PR.</p>
              <p className="flex gap-3"><ShieldCheck className="mt-0.5 shrink-0 text-cyan-300" size={18} /> Eine menschliche Prüfung und echte Tests bleiben für die Auslieferung erforderlich.</p>
            </div>
            <p className="mt-10 rounded-2xl border border-cyan-400/20 bg-cyan-400/5 p-5 text-sm leading-6 text-slate-300">Aktueller Umfang: Projekt-Villen, Agenten-Chat und eine begrenzte GitHub-Elite-Mission. Ein automatisierter Vertrieb, garantierte Projektergebnisse oder unbegrenzte externe Modellkapazität sind nicht enthalten.</p>
          </section>

          <section className="h-fit rounded-3xl border border-white/10 bg-slate-900 p-6 shadow-2xl shadow-cyan-950/20 sm:p-8" id="demo-anfrage">
            {sent ? (
              <div role="status" className="py-12 text-center">
                <CheckCircle2 className="mx-auto text-cyan-300" size={48} />
                <h2 className="mt-5 text-2xl font-semibold">Anfrage eingegangen</h2>
                <p className="mt-3 text-slate-300">Danke. Deine Angaben wurden für die Bearbeitung deiner Demoanfrage gespeichert. Es wird keine automatische E-Mail versendet.</p>
              </div>
            ) : (
              <>
                <h2 className="text-2xl font-semibold">Demo anfragen</h2>
                <p className="mt-2 text-sm leading-6 text-slate-400">Beschreibe kurz dein konkretes Projekt. Die Anfrage wird intern geprüft; eine Demo oder Rückmeldung ist nicht garantiert.</p>
                <form onSubmit={onSubmit} className="mt-7 space-y-4">
                  <label className="block text-sm">Name<input required minLength={2} maxLength={100} value={name} onChange={e => setName(e.target.value)} autoComplete="name" className="mt-1.5 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 text-white" /></label>
                  <label className="block text-sm">Firma<input required minLength={2} maxLength={120} value={company} onChange={e => setCompany(e.target.value)} autoComplete="organization" className="mt-1.5 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 text-white" /></label>
                  <label className="block text-sm">Geschäftliche E-Mail<input required type="email" maxLength={320} value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" className="mt-1.5 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 text-white" /></label>
                  <label className="block text-sm">Deine Projektidee<textarea required minLength={20} maxLength={4000} rows={5} value={projectIdea} onChange={e => setProjectIdea(e.target.value)} placeholder="Welches Problem soll die Software lösen und für wen?" className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white" /></label>
                  <div aria-hidden="true" className="absolute left-[-9999px]"><label>Website<input tabIndex={-1} autoComplete="off" value={website} onChange={e => setWebsite(e.target.value)} /></label></div>
                  <label className="flex gap-3 text-sm leading-6 text-slate-300"><input required type="checkbox" checked={contactConsent} onChange={e => setContactConsent(e.target.checked)} className="mt-1 h-4 w-4 accent-cyan-400" /><span>{DEMO_CONTACT_CONSENT_TEXT}</span></label>
                  {submit.error && <p role="alert" className="text-sm text-rose-300">{submit.error.message}</p>}
                  <button disabled={!contactConsent || submit.isPending} className="min-h-12 w-full rounded-xl bg-cyan-400 px-5 font-semibold text-slate-950 hover:bg-cyan-300 disabled:opacity-50">{submit.isPending ? "Anfrage wird gespeichert …" : "Demoanfrage senden"}</button>
                </form>
              </>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
