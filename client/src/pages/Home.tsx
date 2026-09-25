import { FormEvent, useMemo, useState } from "react";
import {
  ArrowLeft,
  Bot,
  Building2,
  Check,
  ChevronDown,
  CircleDot,
  Code2,
  ExternalLink,
  FolderGit2,
  Github,
  LayoutGrid,
  Menu,
  MessageSquare,
  Mic,
  Plus,
  Search,
  Send,
  SlidersHorizontal,
  Sparkles,
  Sun,
  X,
} from "lucide-react";

type Screen = "home" | "workshop" | "villas";
type ChatMessage = { role: "assistant" | "user"; text: string };
type Villa = { name: string; specialty: string; icon: "villa" | "bot" };

const initialVillas: Villa[] = [{ name: "Agent-Villa", specialty: "Generalist", icon: "villa" }];
const homeIdeas = ["Erstelle einen Aktionsplan", "Analysiere Chancen & Risiken"];
const workshopIdeas = [
  "Zeige Repo-Überblick und letzte Commits",
  "Lies src/pages/Villa.jsx und schlage Verbesserungen vor",
  "Erstelle ein Issue für eine Sprachgabe-Funktion",
];

function cannedReply(prompt: string, screen: Screen) {
  if (screen === "workshop") {
    if (/repo|commit/i.test(prompt)) return "Ich würde mit einer Übersicht der Repository-Struktur und den letzten Commits beginnen. Verbinde zuerst ein GitHub-Repository, damit ich den tatsächlichen Projektstand analysieren kann.";
    if (/issue/i.test(prompt)) return "Gern. Beschreibe kurz den gewünschten Umfang und die Akzeptanzkriterien. In dieser Vorschau kann ich noch kein Issue in GitHub anlegen.";
    return "Ich habe den Auftrag aufgenommen. Für eine echte Codeanalyse muss ein Repository verbunden sein. Die angezeigte Werkstatt ist derzeit eine interaktive Vorschau.";
  }
  if (/risiko|chance/i.test(prompt)) return "Ich kann Chancen und Risiken strukturiert gegenüberstellen. Nenne mir dazu das Vorhaben, den Zeithorizont und deine wichtigsten Rahmenbedingungen.";
  if (/aktionsplan|plan/i.test(prompt)) return "Ein guter Start: Ziel und messbares Ergebnis festlegen, die Arbeit in Etappen teilen, Verantwortlichkeiten zuweisen und pro Etappe einen Prüfpunkt setzen. Was ist dein konkretes Ziel?";
  return "Ich unterstütze dich als Generalist beim Planen, Recherchieren und Analysieren. Sag mir kurz, welches Ergebnis du erreichen möchtest.";
}

export default function Home() {
  const [screen, setScreen] = useState<Screen>("home");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [newVillaOpen, setNewVillaOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [villaName, setVillaName] = useState("");
  const [villas, setVillas] = useState(initialVillas);
  const [activeVilla, setActiveVilla] = useState(initialVillas[0]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const filteredVillas = useMemo(
    () => villas.filter((villa) => `${villa.name} ${villa.specialty}`.toLowerCase().includes(query.toLowerCase())),
    [villas, query],
  );

  function sendMessage(text = draft) {
    const prompt = text.trim();
    if (!prompt) return;
    setMessages((previous) => [
      ...previous,
      { role: "user", text: prompt },
      { role: "assistant", text: cannedReply(prompt, screen) },
    ]);
    setDraft("");
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    sendMessage();
  }

  function createVilla(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanName = villaName.trim();
    if (!cleanName) return;
    const villa = { name: cleanName, specialty: "Neuer Agent", icon: "bot" as const };
    setVillas((previous) => [...previous, villa]);
    setActiveVilla(villa);
    setVillaName("");
    setNewVillaOpen(false);
    setScreen("home");
    setMessages([]);
  }

  function chooseVilla(villa: Villa) {
    setActiveVilla(villa);
    setMessages([]);
    setScreen("home");
    setDrawerOpen(false);
  }

  const isWorkshop = screen === "workshop";

  return (
    <main className="villa-app">
      <header className="app-header">
        <button className="icon-button nav-menu" aria-label="Menü öffnen" onClick={() => setDrawerOpen(true)}><Menu /></button>
        <button className="brand-block" onClick={() => { setScreen("home"); setMessages([]); }} aria-label="Zur Agenten-Villa">
          <span className="brand-tile">{isWorkshop ? <Github /> : <Building2 />}</span>
          <span className="brand-copy">
            <strong>{isWorkshop ? "Superagent · Projekt-Werkstatt" : activeVilla.name}</strong>
            <span><i className="status-dot" />{isWorkshop ? "niknight1403/Agenten-Villa · Vorschau" : `${activeVilla.specialty} · bereit`}</span>
          </span>
          <ChevronDown className="brand-chevron" size={16} />
        </button>
        {!isWorkshop && (
          <nav className="header-tools" aria-label="Werkzeuge">
            <button className="icon-button" aria-label="Projekt-Werkstatt" onClick={() => { setScreen("workshop"); setMessages([]); }}><Bot /></button>
            <button className={`icon-button${searchOpen ? " active" : ""}`} aria-label="Villen suchen" onClick={() => { setScreen("villas"); setSearchOpen(true); setDrawerOpen(false); }}><Search /></button>
            <button className="icon-button tool-optional" aria-label="Einstellungen" onClick={() => setNewVillaOpen(true)}><SlidersHorizontal /></button>
            <button className="icon-button tool-optional" aria-label="Darstellung" onClick={(event) => event.currentTarget.classList.toggle("active")}><Sun /></button>
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
          <div className="villa-list">
            {filteredVillas.map((villa) => (
              <button key={villa.name} className={`villa-row${activeVilla.name === villa.name ? " selected" : ""}`} onClick={() => chooseVilla(villa)}>
                <span className="villa-row-icon">{villa.icon === "villa" ? <Building2 /> : <Bot />}</span>
                <span className="villa-row-copy"><strong>{villa.name}</strong><span>{villa.specialty}</span></span>
                {activeVilla.name === villa.name && <Check className="selected-check" size={18} />}
              </button>
            ))}
            {filteredVillas.length === 0 && <p className="empty-search">Keine Villa gefunden.</p>}
          </div>
          <button className="new-villa-button" onClick={() => setNewVillaOpen(true)}><Plus size={18} /> Neue Villa</button>
          <a className="sign-out-link" href="/login"><ArrowLeft size={16} /> Abmelden</a>
        </section>
      ) : (
        <section className={`conversation ${isWorkshop ? "workshop" : "agent-home"}`}>
          <div className="conversation-scroll">
            {messages.length === 0 ? (
              <div className="welcome-panel">
                <div className={`hero-mark ${isWorkshop ? "robot" : "house"}`}>{isWorkshop ? <Bot /> : <Building2 />}</div>
                <h1>{isWorkshop ? "Superagent bereit" : "Agenten‑Villa"}</h1>
                <p>{isWorkshop
                  ? "Beschreibe, was am Projekt weiterentwickelt werden soll. Der Superagent liest das Repo, schlägt Änderungen vor, legt Dateien an und erstellt Issues."
                  : <>Dein Superagent für <strong>{activeVilla.specialty}</strong> ist bereit. Die Abteilungen Strategie, Recherche, Analyse und weitere warten auf deine Anweisung.</>}
                </p>
                <div className={`suggestion-list ${isWorkshop ? "workshop-ideas" : "home-ideas"}`}>
                  {(isWorkshop ? workshopIdeas : homeIdeas).map((idea) => (
                    <button key={idea} className="suggestion-chip" onClick={() => sendMessage(idea)}>{idea}</button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="message-list" aria-live="polite">
                {messages.map((message, index) => (
                  <article key={`${index}-${message.role}`} className={`chat-message ${message.role}`}>
                    {message.role === "assistant" && <span className="assistant-avatar">{isWorkshop ? <Bot size={16} /> : <span>CS</span>}</span>}
                    <div className="message-bubble">
                      {message.role === "assistant" && <div className="message-author">{isWorkshop ? "Superagent · Projekt-Werkstatt" : "Sarah · KI-Operations"}</div>}
                      <p>{message.text}</p>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
          <div className="composer-area">
            {messages.length > 0 && <div className="chat-ready"><span className="ready-pulse" />Chat bereit <span>·</span> {isWorkshop ? "main · On-Server" : "KI-Operations"}<button aria-label="Chat einklappen" onClick={() => setMessages([])}><ChevronDown size={18} /></button></div>}
            <form className="message-composer" onSubmit={onSubmit}>
              <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={isWorkshop ? "Auftrag an den Superagenten…" : "Anweisung an den Superagenten…"} rows={1} aria-label="Nachricht an den Superagenten" onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendMessage(); } }} />
              {!isWorkshop && <button className="mic-button" type="button" aria-label="Spracheingabe (Vorschau)"><Mic size={20} /></button>}
              <button className="send-button" type="submit" aria-label="Senden" disabled={!draft.trim()}><Send size={19} /></button>
            </form>
            <div className="composer-footnote"><Sparkles size={12} /> KI-Antworten in dieser Vorschau sind Beispiele</div>
          </div>
        </section>
      )}

      {drawerOpen && (
        <div className="drawer-backdrop" role="presentation" onClick={() => setDrawerOpen(false)}>
          <aside className="app-drawer" role="dialog" aria-modal="true" aria-label="Navigation" onClick={(event) => event.stopPropagation()}>
            <div className="drawer-top"><span className="drawer-title">Deine Villen</span><button className="drawer-close" onClick={() => setDrawerOpen(false)} aria-label="Menü schließen"><X size={20} /></button></div>
            <label className="drawer-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Villa suchen…" /></label>
            <div className="drawer-villas">
              {filteredVillas.map((villa) => <button key={villa.name} className={`villa-row${activeVilla.name === villa.name ? " selected" : ""}`} onClick={() => chooseVilla(villa)}><span className="villa-row-icon">{villa.icon === "villa" ? <Building2 /> : <Bot />}</span><span className="villa-row-copy"><strong>{villa.name}</strong><span>{villa.specialty}</span></span></button>)}
            </div>
            <button className="new-villa-button" onClick={() => { setDrawerOpen(false); setNewVillaOpen(true); }}><Plus size={18} /> Neue Villa</button>
            <div className="drawer-spacer" />
            <button className="drawer-link" onClick={() => { setScreen("workshop"); setMessages([]); setDrawerOpen(false); }}><FolderGit2 size={18} /> Projekt-Werkstatt</button>
            <a className="drawer-link" href="/login"><ArrowLeft size={18} /> Abmelden</a>
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

      <footer className="mobile-tabbar" aria-label="Schnellnavigation">
        <button className={!isWorkshop && screen !== "villas" ? "tab-active" : ""} aria-label="Agenten-Chat" onClick={() => { setScreen("home"); setMessages([]); }}><MessageSquare size={19} /></button>
        <button className={screen === "villas" ? "tab-active" : ""} aria-label="Meine Villen" onClick={() => { setScreen("villas"); setSearchOpen(false); setQuery(""); }}><LayoutGrid size={19} /></button>
        <button className={isWorkshop ? "tab-active" : ""} aria-label="Projekt-Werkstatt" onClick={() => { setScreen("workshop"); setMessages([]); }}><Code2 size={20} /></button>
        <button aria-label="Neuen Agenten erstellen" onClick={() => setNewVillaOpen(true)}><Plus size={21} /></button>
      </footer>
    </main>
  );
}

export { ExternalLink, CircleDot };
