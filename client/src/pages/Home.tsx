import { FormEvent, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { startLogin } from "@/const";
import { trpc } from "@/lib/trpc";
import {
  ArrowLeft,
  Bot,
  Building2,
  Check,
  ChevronDown,
  Code2,
  FolderGit2,
  Github,
  KeyRound,
  LayoutGrid,
  Loader2,
  Menu,
  MessageSquare,
  Mic,
  Plus,
  Search,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  X,
} from "lucide-react";

type Screen = "home" | "workshop" | "villas";
type ChatMessage = {
  role: "assistant" | "user";
  text: string;
  meta?: string;
  messageId?: number;
  rating?: -1 | 1 | null;
};
type Villa = { id: number; name: string; specialty: string; icon: "villa" | "bot" };
const homeIdeas = ["Erstelle einen Aktionsplan", "Analysiere Chancen & Risiken"];
const workshopIdeas = [
  "Zeige Repo-Überblick und letzte Commits",
  "Lies server/agent-engine.ts und schlage Verbesserungen vor",
  "Erstelle ein Issue für eine Sprachgabe-Funktion",
];

export default function Home() {
  // The useAuth hook provides authentication state.
  // To implement login/logout, call logout(), or start login from an event
  // handler: onClick={() => startLogin()} (imported from "@/const"). Never call
  // startLogin() during render (no href={startLogin()}) — it mints a one-time
  // nonce cookie and must run only at the moment of navigation.
  const { isAuthenticated, loading, logout } = useAuth();
  const statusQuery = trpc.agent.status.useQuery(undefined, { enabled: isAuthenticated, refetchOnWindowFocus: false });
  const usageQuery = trpc.agent.usage.useQuery(undefined, { enabled: isAuthenticated, refetchOnWindowFocus: false });
  const villaListQuery = trpc.villa.list.useQuery(undefined, { enabled: isAuthenticated, refetchOnWindowFocus: false });
  const createVillaMutation = trpc.villa.create.useMutation({ onSuccess: () => villaListQuery.refetch() });
  const deleteVillaMutation = trpc.villa.remove.useMutation({ onSuccess: () => villaListQuery.refetch() });
  const appendMessagesMutation = trpc.villa.appendMessages.useMutation();
  const rateMessageMutation = trpc.villa.rateMessage.useMutation();
  const villaSnapshotQuery = trpc.agent.villaSnapshot.useQuery({}, { enabled: isAuthenticated, refetchOnWindowFocus: false });
  const chatMutation = trpc.agent.chat.useMutation();
  const controlMutation = trpc.agent.setState.useMutation({ onSuccess: () => statusQuery.refetch() });
  const systemPromptMutation = trpc.agent.setSystemPrompt.useMutation({ onSuccess: () => statusQuery.refetch() });
  const [promptDraft, setPromptDraft] = useState<string | null>(null);
  const effectivePrompt = promptDraft ?? statusQuery.data?.systemPrompt ?? "";
  const keyTestMutation = trpc.agent.testOpenRouterKey.useMutation({ gcTime: 0 });

  const [screen, setScreen] = useState<Screen>("home");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [newVillaOpen, setNewVillaOpen] = useState(false);
  const [keyDialogOpen, setKeyDialogOpen] = useState(false);
  const [openRouterKey, setOpenRouterKey] = useState("");
  const [keyTestResult, setKeyTestResult] = useState<{ status: "valid" | "invalid" | "unavailable"; message: string } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [villaName, setVillaName] = useState("");
  const [activeVillaId, setActiveVillaId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [allowHuggingFaceFallback, setAllowHuggingFaceFallback] = useState(false);
  const [githubToolsEnabled, setGithubToolsEnabled] = useState(false);

  const villas = useMemo<Villa[]>(
    () => (villaListQuery.data ?? []).map(({ id, name, specialty, icon }) => ({ id, name, specialty, icon: icon as Villa["icon"] })),
    [villaListQuery.data],
  );
  const activeVilla = useMemo(
    () => villas.find((villa) => villa.id === activeVillaId) ?? villas[0],
    [villas, activeVillaId],
  );
  const messagesQuery = trpc.villa.messages.useQuery(
    { villaId: activeVilla?.id ?? 0 },
    { enabled: isAuthenticated && Boolean(activeVilla?.id), refetchOnWindowFocus: false },
  );
  const filteredVillas = useMemo(
    () => villas.filter((villa) => `${villa.name} ${villa.specialty}`.toLowerCase().includes(query.toLowerCase())),
    [villas, query],
  );

  // Verlauf aus der Datenbank übernehmen, sobald er geladen ist.
  useEffect(() => {
    if (!activeVilla) {
      setMessages([]);
      return;
    }
    const rows = messagesQuery.data;
    if (!rows) return;
    setMessages(
      rows.map((row) =>
        row.role === "assistant"
          ? {
              role: "assistant",
              text: row.content,
              meta: [row.provider, row.model].filter(Boolean).join(" · ") || undefined,
              messageId: row.id,
              rating: row.rating === -1 || row.rating === 1 ? row.rating : null,
            }
          : { role: "user", text: row.content },
      ),
    );
  }, [activeVilla?.id, messagesQuery.data]);

  const speech = useSpeechRecognition((text) => {
    setDraft((previous) => (previous.trim() ? `${previous.trim()} ${text}` : text));
  });

  async function sendMessage(text = draft) {
    const prompt = text.trim();
    if (!prompt || chatMutation.isPending) return;
    if (screen !== "workshop" && !activeVilla) {
      toast.error("Erstelle zuerst eine Villa, bevor du chattest.");
      setNewVillaOpen(true);
      return;
    }
    const prior = messages.slice(-8).map(({ role, text: content }) => ({ role, content }));
    setMessages((previous) => [...previous, { role: "user", text: prompt }]);
    setDraft("");
    try {
      const result = await chatMutation.mutateAsync({
        prompt,
        history: prior,
        mode: screen === "workshop" ? "workshop" : "home",
        specialty: activeVilla?.specialty ?? "Generalist",
        allowHuggingFaceFallback,
        useGitHub: screen === "workshop" && githubToolsEnabled,
      });
      const actionInfo = result.githubActions ? ` · ${result.githubActions} GitHub-Aktionen` : "";
      const meta = `${result.provider} · ${result.model}${actionInfo}`;
      const optimistic: ChatMessage = { role: "assistant", text: result.answer, meta };
      setMessages((previous) => [...previous, optimistic]);
      if (screen !== "workshop" && activeVilla) {
        try {
          await appendMessagesMutation.mutateAsync({
            villaId: activeVilla.id,
            messages: [
              { role: "user", content: prompt },
              { role: "assistant", content: result.answer, provider: result.provider, model: result.model },
            ],
          });
          await messagesQuery.refetch();
        } catch {
          toast.error("Der Verlauf konnte nicht gespeichert werden. Die Datenbank ist gerade nicht erreichbar.");
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Die Anfrage konnte nicht verarbeitet werden.";
      setMessages((previous) => [...previous, { role: "assistant", text: message }]);
    }
  }

  async function rateMessage(messageId: number, rating: -1 | 1) {
    try {
      await rateMessageMutation.mutateAsync({ messageId, rating });
      setMessages((previous) =>
        previous.map((message) => (message.messageId === messageId ? { ...message, rating } : message)),
      );
    } catch {
      toast.error("Die Bewertung konnte nicht gespeichert werden.");
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    sendMessage();
  }

  async function testOpenRouterKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const apiKey = openRouterKey.trim();
    if (!apiKey || keyTestMutation.isPending) return;
    setKeyTestResult(null);
    try {
      setKeyTestResult(await keyTestMutation.mutateAsync({ apiKey }));
    } catch (error) {
      setKeyTestResult({ status: "unavailable", message: error instanceof Error ? error.message : "Die Prüfung konnte nicht abgeschlossen werden." });
    } finally {
      setOpenRouterKey("");
      keyTestMutation.reset();
    }
  }

  function closeKeyDialog() {
    setKeyDialogOpen(false);
    setOpenRouterKey("");
    setKeyTestResult(null);
    keyTestMutation.reset();
  }

  async function createVilla(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanName = villaName.trim();
    if (!cleanName || createVillaMutation.isPending) return;
    try {
      const villa = await createVillaMutation.mutateAsync({ name: cleanName });
      setVillaName("");
      setNewVillaOpen(false);
      setScreen("home");
      setActiveVillaId(villa.id);
      setMessages([]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Die Villa konnte nicht erstellt werden.");
    }
  }

  async function removeVilla(villa: Villa) {
    if (deleteVillaMutation.isPending) return;
    if (!window.confirm(`Villa „${villa.name}" inklusive Verlauf endgültig löschen?`)) return;
    try {
      await deleteVillaMutation.mutateAsync({ id: villa.id });
      if (activeVilla?.id === villa.id) {
        setActiveVillaId(null);
        setMessages([]);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Die Villa konnte nicht gelöscht werden.");
    }
  }

  async function handleLogout() {
    try {
      await logout();
    } finally {
      window.location.assign("/login");
    }
  }

  function chooseVilla(villa: Villa) {
    setActiveVillaId(villa.id);
    setMessages([]);
    setScreen("home");
    setDrawerOpen(false);
  }

  const isWorkshop = screen === "workshop";
  const agentRunning = statusQuery.data?.state === "RUNNING";

  return (
    <main className="villa-app">
      <header className="app-header">
        <button className="icon-button nav-menu" aria-label="Menü öffnen" onClick={() => setDrawerOpen(true)}><Menu /></button>
        <button className="brand-block" onClick={() => { setScreen("home"); setMessages([]); }} aria-label="Zur Agenten-Villa">
          <span className="brand-tile">{isWorkshop ? <Github /> : <Building2 />}</span>
          <span className="brand-copy">
            <strong>{isWorkshop ? "Superagent · Projekt-Werkstatt" : activeVilla?.name ?? "Agenten-Villa"}</strong>
            <span><i className={`status-dot${agentRunning ? " running" : " stopped"}`} />{isWorkshop ? `GitHub · ${statusQuery.data?.github?.configured ? "Repository verbunden" : "Token fehlt"}` : `${activeVilla?.specialty ?? "Neue Villa"} · ${agentRunning ? "Agent läuft" : statusQuery.data?.providers.openrouter ? "Agent gestoppt" : "OpenRouter-Schlüssel fehlt"}`}</span>
          </span>
          <ChevronDown className="brand-chevron" size={16} />
        </button>
        {!isWorkshop && (
          <nav className="header-tools" aria-label="Werkzeuge">
            <button className="icon-button" aria-label="Projekt-Werkstatt" onClick={() => { setScreen("workshop"); setMessages([]); }}><Bot /></button>
            <button className={`icon-button${searchOpen ? " active" : ""}`} aria-label="Villen suchen" onClick={() => { setScreen("villas"); setSearchOpen(true); setDrawerOpen(false); }}><Search /></button>
            <button className="icon-button tool-optional" aria-label="OpenRouter-Key prüfen" title={statusQuery.data?.isAdmin ? "OpenRouter-Key sicher prüfen" : "Administratorzugriff erforderlich"} disabled={!statusQuery.data?.isAdmin} onClick={() => { setOpenRouterKey(""); setKeyTestResult(null); setKeyDialogOpen(true); }}><SlidersHorizontal /></button>

          </nav>
        )}
        {isWorkshop && <button className="new-project-button" onClick={() => setDrawerOpen(true)}><Plus size={18} /><span>Neu</span></button>}
      </header>

      {searchOpen && screen === "villas" && (
        <div className="search-strip"><Search size={17} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Villa suchen…" aria-label="Villa suchen" /><button aria-label="Suche schließen" onClick={() => { setSearchOpen(false); setQuery(""); setScreen("home"); }}><X size={17} /></button></div>
      )}

      {screen === "villas" ? (
        <section className="villa-library">
          <div className="library-heading"><div><span className="eyebrow">DEIN AGENTEN-TEAM</span><h1>Deine Villen</h1></div><button className="round-add" aria-label="Neue Villa" onClick={() => setNewVillaOpen(true)}><Plus size={20} /></button></div>
          {villaSnapshotQuery.data && (
            <p className="library-capacity">
              Villa {villaSnapshotQuery.data.id}: {villaSnapshotQuery.data.availableLogicalAgents.toLocaleString("de-DE")} von {villaSnapshotQuery.data.logicalAgentCapacity.toLocaleString("de-DE")} logischen Plätzen verfügbar · {villaSnapshotQuery.data.provisioning === "lazy" ? "bedarfsgesteuert provisioniert" : villaSnapshotQuery.data.provisioning} · {villaSnapshotQuery.data.packs.length} Capability-Packs aktiv
            </p>
          )}
          <div className="villa-list">
            {villaListQuery.isLoading && <p className="empty-search">Villen werden geladen …</p>}
            {villaListQuery.isError && (
              <p className="empty-search">
                Villen konnten nicht geladen werden: {villaListQuery.error instanceof Error ? villaListQuery.error.message : "Datenbank nicht erreichbar."}
                <button className="retry-link" onClick={() => villaListQuery.refetch()}>Erneut versuchen</button>
              </p>
            )}
            {villaListQuery.isSuccess && villas.length === 0 && (
              <p className="empty-search">Noch keine Villa. Erstelle deine erste Agenten-Villa oben rechts.</p>
            )}
            {filteredVillas.map((villa) => (
              <div key={villa.id} className={`villa-row${activeVilla?.id === villa.id ? " selected" : ""}`}>
                <button className="villa-row-main" onClick={() => chooseVilla(villa)}>
                  <span className="villa-row-icon">{villa.icon === "villa" ? <Building2 /> : <Bot />}</span>
                  <span className="villa-row-copy"><strong>{villa.name}</strong><span>{villa.specialty}</span></span>
                  {activeVilla?.id === villa.id && <Check className="selected-check" size={18} />}
                </button>
                <button className="villa-row-delete" aria-label={`Villa ${villa.name} löschen`} disabled={deleteVillaMutation.isPending} onClick={() => removeVilla(villa)}><Trash2 size={16} /></button>
              </div>
            ))}
            {villaListQuery.isSuccess && villas.length > 0 && filteredVillas.length === 0 && <p className="empty-search">Keine Villa gefunden.</p>}
          </div>
          <button className="new-villa-button" onClick={() => setNewVillaOpen(true)}><Plus size={18} /> Neue Villa</button>
          <button className="sign-out-link" type="button" onClick={handleLogout}><ArrowLeft size={16} /> Abmelden</button>
        </section>
      ) : (
        <section className={`conversation ${isWorkshop ? "workshop" : "agent-home"}`}>
          <div className="conversation-scroll">
            {messages.length === 0 ? (
              <div className="welcome-panel">
                <div className={`hero-mark ${isWorkshop ? "robot" : "house"}`}>{isWorkshop ? <Bot /> : <Building2 />}</div>
                <h1>{isWorkshop ? "Superagent bereit" : "Agenten‑Villa"}</h1>
                <p>{isWorkshop
                  ? statusQuery.data?.github?.configured
                    ? `Repository ${statusQuery.data.github.repository} ist verbunden. Aktiviere GitHub-Werkzeuge im Eingabebereich, damit der Agent Repo-Daten lesen und begrenzte Aufgaben auf einem Branch ausführen kann.`
                    : `GitHub ist für ${statusQuery.data?.github?.repository ?? "das konfigurierte Repository"} noch nicht verbunden. Hinterlege zuerst GITHUB_TOKEN als geschütztes Server-Secret; der Agent führt bis dahin keine Repo-Aktionen aus.`
                  : activeVilla
                    ? <>Dein Superagent für <strong>{activeVilla.specialty}</strong> ist bereit. Die Abteilungen Strategie, Recherche, Analyse und weitere warten auf deine Anweisung.</>
                    : <>Erstelle deine erste Villa, dann startet dein Superagent hier. Villen und Verläufe werden dauerhaft gespeichert.</>}
                </p>
                {activeVilla && (
                  <div className={`suggestion-list ${isWorkshop ? "workshop-ideas" : "home-ideas"}`}>
                    {(isWorkshop ? workshopIdeas : homeIdeas).map((idea) => (
                      <button key={idea} className="suggestion-chip" onClick={() => sendMessage(idea)}>{idea}</button>
                    ))}
                  </div>
                )}
                {!isWorkshop && !activeVilla && (
                  <button className="modal-submit" type="button" onClick={() => setNewVillaOpen(true)}><Plus size={17} /> Erste Villa erstellen</button>
                )}
              </div>
            ) : (
              <div className="message-list" aria-live="polite">
                {messages.map((message, index) => (
                  <article key={message.messageId ?? `${index}-${message.role}`} className={`chat-message ${message.role}`}>
                    {message.role === "assistant" && <span className="assistant-avatar">{isWorkshop ? <Bot size={16} /> : <span>CS</span>}</span>}
                    <div className="message-bubble">
                      {message.role === "assistant" && <div className="message-author">{isWorkshop ? "Superagent · Projekt-Werkstatt" : "Sarah · KI-Operations"}</div>}
                      <p>{message.text}</p>
                      {message.role === "assistant" && message.meta && <div className="message-meta">{message.meta}</div>}
                      {message.role === "assistant" && message.messageId && (
                        <div className="message-rating" data-rated={message.rating ? "yes" : "no"}>
                          <button type="button" aria-label="Antwort positiv bewerten" className={message.rating === 1 ? "rated" : ""} disabled={rateMessageMutation.isPending} onClick={() => rateMessage(message.messageId as number, 1)}><ThumbsUp size={14} /></button>
                          <button type="button" aria-label="Antwort negativ bewerten" className={message.rating === -1 ? "rated" : ""} disabled={rateMessageMutation.isPending} onClick={() => rateMessage(message.messageId as number, -1)}><ThumbsDown size={14} /></button>
                        </div>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
          <div className="composer-area">
            {messages.length > 0 && <div className="chat-ready"><span className="ready-pulse" />{chatMutation.isPending ? "Antwort wird erstellt …" : agentRunning ? "Agent bereit" : "Agent gestoppt"}<span>·</span> {isWorkshop ? "Projekt-Werkstatt" : "KI-Operations"}<button aria-label="Chat einklappen" onClick={() => setMessages([])}><ChevronDown size={18} /></button></div>}
            {statusQuery.data?.isAdmin && <button className="agent-control" type="button" disabled={controlMutation.isPending} onClick={() => controlMutation.mutate({ state: agentRunning ? "STOPPED" : "RUNNING" })}>{controlMutation.isPending ? "Status wird geändert …" : agentRunning ? "Agent stoppen" : "Agent starten"}</button>}
            {statusQuery.data?.isAdmin && (
              <div className="github-tool-toggle admin-prompt-panel">
                <span>
                  <strong>Eigene Systemanweisung (Administrator)</strong>
                  <small>Ersetzt die Standard-Persona des Assistenten. Leer lassen und speichern = Standard wiederherstellen. GitHub-Sicherheitsregeln und Anbieterrichtlinien gelten weiterhin.</small>
                  <textarea value={effectivePrompt} onChange={(event) => setPromptDraft(event.target.value)} rows={2} maxLength={4000} aria-label="Eigene Systemanweisung" placeholder="z. B. eigener Stil, eigene Rollenbeschreibung …" />
                  <span className="prompt-actions">
                    <button className="agent-control" type="button" disabled={systemPromptMutation.isPending} onClick={() => systemPromptMutation.mutate({ prompt: effectivePrompt.trim() || null })}>{systemPromptMutation.isPending ? "Speichern …" : "Anweisung speichern"}</button>
                    <button className="agent-control" type="button" disabled={systemPromptMutation.isPending || !statusQuery.data.systemPrompt} onClick={() => { setPromptDraft(null); systemPromptMutation.mutate({ prompt: null }); }}>Zurücksetzen</button>
                  </span>
                </span>
              </div>
            )}
            {isWorkshop && statusQuery.data?.isAdmin && <label className="github-tool-toggle"><input type="checkbox" checked={githubToolsEnabled} onChange={(event) => setGithubToolsEnabled(event.target.checked)} disabled={!statusQuery.data.github?.configured || chatMutation.isPending} /><span><strong>GitHub-Werkzeuge aktivieren</strong><small>{statusQuery.data.github?.configured ? `${statusQuery.data.github.repository} · max. 3 Aktionen je Auftrag · Änderungen nur auf agent/*-Branches als Draft-PR` : "GITHUB_TOKEN fehlt — noch keine Repository-Aktionen möglich"}</small></span></label>}
            <form className="message-composer" onSubmit={onSubmit}>
              <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={isWorkshop ? "Auftrag an den Superagenten…" : "Anweisung an den Superagenten…"} rows={1} aria-label="Nachricht an den Superagenten" disabled={!isAuthenticated || !agentRunning || chatMutation.isPending} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendMessage(); } }} />
              {!isWorkshop && <button className={`mic-button${speech.listening ? " listening" : ""}`} type="button" aria-label={speech.listening ? "Spracheingabe stoppen" : "Spracheingabe starten"} title={speech.supported ? "Spracheingabe (Deutsch)" : "Spracheingabe wird von diesem Browser nicht unterstützt"} onClick={() => { if (!speech.supported) { toast.info("Spracheingabe wird von diesem Browser nicht unterstützt."); return; } speech.toggle(); }}><Mic size={20} /></button>}
              {!isAuthenticated && !loading ? <button className="send-button" type="button" aria-label="Anmelden" onClick={() => startLogin()}><ArrowLeft size={19} /></button> : <button className="send-button" type="submit" aria-label="Senden" disabled={!draft.trim() || !agentRunning || chatMutation.isPending}><Send size={19} /></button>}
            </form>
            {isAuthenticated && <label className="fallback-consent"><input type="checkbox" checked={allowHuggingFaceFallback} onChange={(event) => setAllowHuggingFaceFallback(event.target.checked)} /> Hugging Face einmalig nur bei vorübergehendem OpenRouter-Ausfall versuchen</label>}
            <div className="composer-footnote"><Sparkles size={12} /> {statusQuery.data?.notice ?? "Anbieterlimits gelten; keine bezahlte Ausweichroute. Agent standardmäßig gestoppt."}{usageQuery.data && !isWorkshop && ` · ${usageQuery.data.remainingTurns} Chats diese Stunde übrig`}</div>
          </div>
        </section>
      )}

      {drawerOpen && (
        <div className="drawer-backdrop" role="presentation" onClick={() => setDrawerOpen(false)}>
          <aside className="app-drawer" role="dialog" aria-modal="true" aria-label="Navigation" onClick={(event) => event.stopPropagation()}>
            <div className="drawer-top"><span className="drawer-title">Deine Villen</span><button className="drawer-close" onClick={() => setDrawerOpen(false)} aria-label="Menü schließen"><X size={20} /></button></div>
            <label className="drawer-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Villa suchen…" /></label>
            <div className="drawer-villas">
              {filteredVillas.map((villa) => <button key={villa.id} className={`villa-row${activeVilla?.id === villa.id ? " selected" : ""}`} onClick={() => chooseVilla(villa)}><span className="villa-row-icon">{villa.icon === "villa" ? <Building2 /> : <Bot />}</span><span className="villa-row-copy"><strong>{villa.name}</strong><span>{villa.specialty}</span></span></button>)}
            </div>
            <button className="new-villa-button" onClick={() => { setDrawerOpen(false); setNewVillaOpen(true); }}><Plus size={18} /> Neue Villa</button>
            <div className="drawer-spacer" />
            <button className="drawer-link" onClick={() => { setScreen("workshop"); setMessages([]); setDrawerOpen(false); }}><FolderGit2 size={18} /> Projekt-Werkstatt</button>
            {statusQuery.data?.isAdmin && <button className="drawer-link" onClick={() => { setDrawerOpen(false); setOpenRouterKey(""); setKeyTestResult(null); setKeyDialogOpen(true); }}><KeyRound size={18} /> OpenRouter-Key prüfen</button>}
            <button className="drawer-link" type="button" onClick={handleLogout}><ArrowLeft size={18} /> Abmelden</button>
          </aside>
        </div>
      )}

      {newVillaOpen && (
        <div className="modal-backdrop" role="presentation" onClick={() => setNewVillaOpen(false)}>
          <form className="new-villa-modal" role="dialog" aria-modal="true" aria-labelledby="new-villa-title" onSubmit={createVilla} onClick={(event) => event.stopPropagation()}>
            <div className="modal-heading"><span className="modal-mark"><Building2 size={20} /></span><button type="button" className="drawer-close" aria-label="Schließen" onClick={() => setNewVillaOpen(false)}><X size={18} /></button></div>
            <h2 id="new-villa-title">Neue Villa erstellen</h2><p>Gib deinem Superagenten einen Namen. Du kannst ihn später spezialisieren.</p>
            <label className="modal-label" htmlFor="villa-name">Name</label><input id="villa-name" className="modal-input" value={villaName} onChange={(event) => setVillaName(event.target.value)} placeholder="z. B. Marketing-Villa" autoFocus required />
            <button className="modal-submit" type="submit"><Plus size={17} /> Villa erstellen</button>
          </form>
        </div>
      )}

      {keyDialogOpen && statusQuery.data?.isAdmin && (
        <div className="modal-backdrop" role="presentation" onClick={closeKeyDialog}>
          <section className="new-villa-modal credential-modal" role="dialog" aria-modal="true" aria-labelledby="key-dialog-title" onClick={(event) => event.stopPropagation()}>
            <div className="modal-heading"><span className="modal-mark"><KeyRound size={20} /></span><button type="button" className="drawer-close" aria-label="Dialog schließen" onClick={closeKeyDialog}><X size={18} /></button></div>
            <h2 id="key-dialog-title">OpenRouter-Key testen</h2>
            <p>Nur Administratoren. Der maskiert eingegebene Schlüssel wird einmalig per HTTPS an OpenRouter gesendet, danach aus dem Formular gelöscht und nicht gespeichert. Es wird keine Modellanfrage ausgelöst.</p>
            <form onSubmit={testOpenRouterKey}>
              <label className="modal-label" htmlFor="openrouter-api-key">API-Key</label>
              <input id="openrouter-api-key" className="modal-input" type="password" value={openRouterKey} onChange={(event) => { setOpenRouterKey(event.target.value); setKeyTestResult(null); }} placeholder="sk-or-…" autoComplete="new-password" autoCapitalize="none" spellCheck={false} required minLength={8} maxLength={512} disabled={keyTestMutation.isPending} />
              <button className="modal-submit" type="submit" disabled={!openRouterKey.trim() || keyTestMutation.isPending}>{keyTestMutation.isPending ? <><Loader2 size={17} className="spin" /> Prüfe Authentifizierung …</> : <><ShieldCheck size={17} /> Schlüssel sicher testen</>}</button>
            </form>
            {keyTestResult && <p className={`key-test-result ${keyTestResult.status}`} role="status" aria-live="polite">{keyTestResult.message}</p>}
            <p className="key-dialog-note">Für den Live-Agenten muss ein gültiger Schlüssel anschließend separat über den geschützten Projekt-Secret-Manager eingerichtet werden. Die Oberfläche speichert oder übernimmt ihn absichtlich nicht.</p>
          </section>
        </div>
      )}

      <footer className="mobile-tabbar" aria-label="Schnellnavigation">
        <button className={!isWorkshop && screen !== "villas" ? "tab-active" : ""} aria-label="Agenten-Chat" onClick={() => { setScreen("home"); setMessages([]); }}><MessageSquare size={19} /></button>
        <button className={screen === "villas" ? "tab-active" : ""} aria-label="Meine Villen" onClick={() => { setScreen("villas"); setSearchOpen(false); setQuery(""); }}><LayoutGrid size={19} /></button>
        <button className={isWorkshop ? "tab-active" : ""} aria-label="Projekt-Werkstatt" onClick={() => { setScreen("workshop"); setMessages([]); }}><Code2 size={20} /></button>
        <button aria-label="Neuen Agenten erstellen" onClick={() => setNewVillaOpen(true)}><Plus size={21} /></button>
      </footer>
    </main>
  );
}
