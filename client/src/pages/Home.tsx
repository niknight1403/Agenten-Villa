import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { offlineBannerMessage, useOnlineStatus } from "../hooks/useOnlineStatus";
import { Capacitor } from "@capacitor/core";
import { toast } from "sonner";
import { onboardingSteps, validateNewVillaForm } from "@/lib/villa-onboarding";
import { useAuth } from "@/_core/hooks/useAuth";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { useDashboardTheme } from "@/contexts/DashboardThemeContext";
import ThemeSwitcher from "@/components/ThemeSwitcher";
import MessageMarkdown from "@/components/MessageMarkdown";
import { trpc } from "@/lib/trpc";
import { markLastUserMessageFailed, markTailLocalOnly, removeFailedExchangeAt, syncNotice } from "@/lib/chatSync";
import { APP_VERSION, APP_BUILD } from "@shared/const";
import {
  Archive,
  ArrowLeft,
  Bot,
  Building2,
  Check,
  ChevronDown,
  Code2,
  FileText,
  FolderGit2,
  FolderOpen,
  Github,
  Image as ImageIcon,
  KeyRound,
  Link2,
  LayoutGrid,
  Loader2,
  Menu,
  MessageSquare,
  Mic,
  Paperclip,
  Plus,
  RotateCcw,
  Route,
  Search,
  Send,
  ShieldCheck,
  Rocket,
  SlidersHorizontal,
  Sparkles,
  Square,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Video,
  X,
} from "lucide-react";

type Screen = "home" | "workshop" | "villas";
type ChatMessage = {
  role: "assistant" | "user";
  text: string;
  meta?: string;
  messageId?: number;
  rating?: -1 | 1 | null;
  // Sprint 067 — Synchronisationskonflikte: gescheiterte Sendungen bleiben
  // wiederholbar, nur-lokale Züge bleiben nachvollziehbar markiert.
  syncState?: "failed" | "local-only";
};
type Villa = {
  id: number;
  name: string;
  specialty: string;
  icon: "villa" | "bot";
  projectBrief: string | null;
  description?: string | null;
  capacity?: number;
  archivedAt?: string | null;
  /** Sprint 071 — verbundenes GitHub-Repository („owner/repo“). */
  repository?: string | null;
};
const homeIdeas = [
  "Schlage 3 konkrete Verbesserungen für dieses Projekt vor",
  "Was sollten wir als Nächstes entwickeln?",
  "Analysiere den aktuellen Stand und mögliche Risiken",
];
const workshopIdeas = [
  "Zeige Repo-Überblick und letzte Commits",
  "Lies server/agent-engine.ts und schlage Verbesserungen vor",
  "Erstelle ein Issue für eine Sprachgabe-Funktion",
];

export default function Home() {
  // The useAuth hook provides authentication state. Unauthenticated
  // visitors are shown the login screen at app start — no need to find
  // the small sign-in button on the Home screen first.
  const { isAuthenticated, loading, logout } = useAuth({
    redirectOnUnauthenticated: true,
    redirectPath: "/login",
  });
  const { theme, themes, setTheme } = useDashboardTheme();
  const statusQuery = trpc.agent.status.useQuery(undefined, {
    enabled: isAuthenticated,
    refetchOnWindowFocus: false,
  });
  // Sprint 092 — Rollenbasierte Dashboards: sichtbare Abschnitte kommen
  // zentral vom Server (agent.dashboard); waehrend des Ladens greift der
  // Status-Fallback aus statusQuery.
  const dashboardQuery = trpc.agent.dashboard.useQuery(undefined, {
    enabled: isAuthenticated,
    refetchOnWindowFocus: false,
  });
  const dashboardSections = new Set(dashboardQuery.data?.sections ?? []);
  const isAdminUser = dashboardQuery.isSuccess
    ? dashboardSections.has("admin_metrics")
    : Boolean(statusQuery.data?.isAdmin);
  const canControlUser = dashboardQuery.isSuccess
    ? dashboardSections.has("controller")
    : Boolean(statusQuery.data?.canControl) || Boolean(statusQuery.data?.isAdmin);
  const usageQuery = trpc.agent.usage.useQuery(undefined, {
    enabled: isAuthenticated,
    refetchOnWindowFocus: false,
  });
  // Sprint 098 — Produkt-Telemetrie ist Opt-in (Standard AUS).
  const telemetryConsentQuery = trpc.telemetry.consent.useQuery(undefined);
  const telemetryConsentMutation = trpc.telemetry.setConsent.useMutation({
    onSuccess: state => {
      telemetryConsentQuery.refetch();
      toast.success(
        state.optedIn
          ? "Telemetrie aktiviert — danke. Jederzeit abschaltbar."
          : "Telemetrie deaktiviert. Es werden keine Laufmetriken erfasst."
      );
    },
    onError: error => {
      toast.error(error.message || "Die Einwilligung konnte nicht gespeichert werden.");
    },
  });
  const villaListQuery = trpc.villa.list.useQuery(undefined, {
    enabled: isAuthenticated,
    refetchOnWindowFocus: false,
  });
  // The chat needs a villa. If a signed-in user has none, create the default
  // project villa once so they can start immediately instead of hitting a
  // dead end. A ref guards against React StrictMode double-invocation.
  const starterVillaRequested = useRef(false);
  const ensureStarterMutation = trpc.villa.ensureStarter.useMutation({
    onSuccess: () => villaListQuery.refetch(),
    onError: error => toast.error(error.message),
  });
  useEffect(() => {
    if (!isAuthenticated || villaListQuery.isLoading) return;
    if (!villaListQuery.data || villaListQuery.data.length > 0) return;
    if (starterVillaRequested.current) return;
    starterVillaRequested.current = true;
    ensureStarterMutation.mutate();
  }, [isAuthenticated, villaListQuery.isLoading, villaListQuery.data, ensureStarterMutation]);
  const createVillaMutation = trpc.villa.create.useMutation({
    onSuccess: () => villaListQuery.refetch(),
  });
  const archiveVillaMutation = trpc.villa.archive.useMutation({
    onSuccess: () => villaListQuery.refetch(),
  });
  const deleteVillaMutation = trpc.villa.remove.useMutation({
    onSuccess: () => villaListQuery.refetch(),
  });
  const appendMessagesMutation = trpc.villa.appendMessages.useMutation();
  const rateMessageMutation = trpc.villa.rateMessage.useMutation();
  const villaSnapshotQuery = trpc.agent.villaSnapshot.useQuery(
    {},
    { enabled: isAuthenticated, refetchOnWindowFocus: false }
  );
  const chatMutation = trpc.agent.chat.useMutation();
  // Sprint 072 — Autonome Villa-Mission mit Stopp-Knopf.
  const startVillaMissionMutation = trpc.agent.startVillaMission.useMutation();
  const stopVillaMissionMutation = trpc.agent.stopVillaMission.useMutation();
  const missionPending =
    startVillaMissionMutation.isPending || stopVillaMissionMutation.isPending;
  // Live-Fortschritt: während ein Auftrag oder eine Mission läuft, werden die
  // echten Server-Meilensteine gepollt und im Chat angezeigt.
  const agentBusy = chatMutation.isPending || startVillaMissionMutation.isPending;
  const progressQuery = trpc.agent.progress.useQuery(undefined, {
    enabled: isAuthenticated && agentBusy,
    refetchInterval: 1500,
    refetchOnWindowFocus: false,
  });
  const [turnStartedAt, setTurnStartedAt] = useState<number | null>(null);
  const [elapsedTick, setElapsedTick] = useState(0);
  useEffect(() => {
    if (!agentBusy) return;
    const startedAt = turnStartedAt ?? Date.now();
    if (turnStartedAt === null) setTurnStartedAt(startedAt);
    const timer = window.setInterval(() => setElapsedTick(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [agentBusy, turnStartedAt]);
  useEffect(() => {
    if (!agentBusy && turnStartedAt !== null) setTurnStartedAt(null);
  }, [agentBusy, turnStartedAt]);
  const controlMutation = trpc.agent.setState.useMutation({ onSuccess: () => statusQuery.refetch() });
  const systemPromptMutation = trpc.agent.setSystemPrompt.useMutation({ onSuccess: () => statusQuery.refetch() });
  const [promptDraft, setPromptDraft] = useState<string | null>(null);
  const effectivePrompt = promptDraft ?? statusQuery.data?.systemPrompt ?? "";
  const keyTestMutation = trpc.agent.testOpenRouterKey.useMutation({ gcTime: 0 });
  const guardianQuery = trpc.agent.guardian.useQuery(undefined, {
    enabled: Boolean(isAuthenticated && isAdminUser),
    refetchInterval: 60_000,
  });
  const runGuardianMutation = trpc.agent.runProviderGuardian.useMutation({
    onSuccess: () => guardianQuery.refetch(),
  });
  const setGuardianMutation = trpc.agent.setProviderGuardian.useMutation({
    onSuccess: () => guardianQuery.refetch(),
  });

  const [screen, setScreen] = useState<Screen>("home");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [newVillaOpen, setNewVillaOpen] = useState(false);
  const [keyDialogOpen, setKeyDialogOpen] = useState(false);
  const [openRouterKey, setOpenRouterKey] = useState("");
  const [keyTestResult, setKeyTestResult] = useState<{
    status: "valid" | "invalid" | "unavailable";
    message: string;
  } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [villaName, setVillaName] = useState("");
  const [villaDescription, setVillaDescription] = useState("");
  const [villaCapacity, setVillaCapacity] = useState(8);
  const [villaIdea, setVillaIdea] = useState("");
  const [villaRepository, setVillaRepository] = useState("");
  const [missionObjective, setMissionObjective] = useState("");
  const [activeVillaId, setActiveVillaId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [allowHuggingFaceFallback, setAllowHuggingFaceFallback] =
    useState(false);
  const [githubToolsEnabled, setGithubToolsEnabled] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  type ComposerAttachment = {
    id: string;
    name: string;
    kind: "Datei" | "Foto" | "Video";
    size: number;
  };
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const attachFileInputRef = useRef<HTMLInputElement | null>(null);
  const attachKindRef = useRef<ComposerAttachment["kind"]>("Datei");

  const villas = useMemo<Villa[]>(
    () =>
      (villaListQuery.data ?? []).map(({ id, name, specialty, icon, projectBrief }) => ({
        id,
        name,
        specialty,
        icon: icon as Villa["icon"],
        projectBrief,
      })),
    [villaListQuery.data]
  );
  const activeVilla = useMemo(
    () => villas.find(villa => villa.id === activeVillaId) ?? villas[0],
    [villas, activeVillaId]
  );
  const messagesQuery = trpc.villa.messages.useQuery(
    { villaId: activeVilla?.id ?? 0 },
    {
      enabled: isAuthenticated && Boolean(activeVilla?.id),
      refetchOnWindowFocus: false,
    }
  );
  const filteredVillas = useMemo(
    () =>
      villas.filter(villa =>
        `${villa.name} ${villa.specialty}`
          .toLowerCase()
          .includes(query.toLowerCase())
      ),
    [villas, query]
  );

  // Sprint 061 — Mobile Navigation: Overlays (Drawer, Neue-Villa-Modal,
  // Key-Dialog) sperren den Hintergrund-Scroll und lassen sich mit
  // Escape schließen — auf Touch-Geräten läuft die Konversation dahinter
  // sonst weiter und das Drawer wirkt "durchlässig".
  useEffect(() => {
    const overlayActive = drawerOpen || newVillaOpen || keyDialogOpen;
    if (!overlayActive) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDrawerOpen(false);
        setNewVillaOpen(false);
        setKeyDialogOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [drawerOpen, newVillaOpen, keyDialogOpen]);

  // Verlauf aus der Datenbank übernehmen, sobald er geladen ist.
  useEffect(() => {
    if (!activeVilla) {
      setMessages([]);
      return;
    }
    const rows = messagesQuery.data;
    if (!rows) return;
    setMessages(
      rows.map(row =>
        row.role === "assistant"
          ? {
              role: "assistant",
              text: row.content,
              meta:
                [row.provider, row.model].filter(Boolean).join(" · ") ||
                undefined,
              messageId: row.id,
              rating: row.rating === -1 || row.rating === 1 ? row.rating : null,
            }
          : { role: "user", text: row.content }
      )
    );
  }, [activeVilla?.id, messagesQuery.data]);

  const speech = useSpeechRecognition(text => {
    setDraft(previous =>
      previous.trim() ? `${previous.trim()} ${text}` : text
    );
  });

  function formatAttachmentSize(bytes: number) {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${bytes} B`;
  }

  async function sendMessage(text = draft) {
    const attachmentNote = attachments.length
      ? `\n\n[Angehängt: ${attachments
          .map(item => `${item.kind} „${item.name}" (${formatAttachmentSize(item.size)})`)
          .join(", ")}]`
      : "";
    const prompt = `${text}${attachmentNote}`.trim();
    if (!prompt || chatMutation.isPending) return;
    if (screen !== "workshop" && !activeVilla) {
      toast.error("Erstelle zuerst eine Villa, bevor du chattest.");
      setNewVillaOpen(true);
      return;
    }
    const prior = [
      ...(screen === "home" && activeVilla?.projectBrief
        ? [{ role: "user" as const, content: `Projektziel der Villa: ${activeVilla.projectBrief.slice(0, 3900)}` }]
        : []),
      ...messages.slice(activeVilla?.projectBrief ? -7 : -8)
        .map(({ role, text: content }) => ({ role, content })),
    ];
    setTurnStartedAt(Date.now());
    setMessages(previous => [...previous, { role: "user", text: prompt }]);
    setDraft("");
    setAttachments([]);
    try {
      const result = await chatMutation.mutateAsync({
        prompt,
        history: prior,
        mode: screen === "workshop" ? "workshop" : "home",
        specialty: activeVilla?.specialty ?? "Generalist",
        allowHuggingFaceFallback,
        useGitHub: githubToolsEnabled,
        ...(screen === "home" && activeVilla ? { villaId: activeVilla.id } : {}),
      });
      const actionInfo = result.githubActions
        ? ` · ${result.githubActions} GitHub-Aktionen`
        : "";
      const meta = `${result.provider} · ${result.model}${actionInfo}`;
      const optimistic: ChatMessage = {
        role: "assistant",
        text: result.answer,
        meta,
      };
      setMessages(previous => [...previous, optimistic]);
      if (screen !== "workshop" && activeVilla) {
        try {
          await appendMessagesMutation.mutateAsync({
            villaId: activeVilla.id,
            messages: [
              { role: "user", content: prompt },
              {
                role: "assistant",
                content: result.answer,
                provider: result.provider,
                model: result.model,
              },
            ],
          });
          await messagesQuery.refetch();
        } catch {
          toast.error(
            "Der Verlauf konnte nicht gespeichert werden. Die Datenbank ist gerade nicht erreichbar."
          );
          // Sprint 067 — Konflikt transparent machen: der Zug bleibt
          // lesbar, ist aber beim nächsten Serverabgleich weg.
          setMessages(previous => markTailLocalOnly(previous, 2));
        }
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Die Anfrage konnte nicht verarbeitet werden.";
      setMessages(previous => [
        // Sprint 067 — der gescheiterte Zug bleibt sichtbar und
        // wiederholbar: Nutzer-Nachricht wird „failed“ markiert, die
        // Fehlerantwort gehört zum selben Zug.
        ...markLastUserMessageFailed(previous, prompt),
        { role: "assistant", text: message, syncState: "failed" },
      ]);
    }
  }

  /** Sprint 067 — Erneut senden: entfernt genau den gescheiterten Zug an dieser Position. */
  async function retryFailedSend(index: number) {
    if (chatMutation.isPending) return;
    const failed = messages[index];
    if (!failed || failed.syncState !== "failed") return;
    const text = failed.text;
    setMessages(previous => removeFailedExchangeAt(previous, index));
    await sendMessage(text);
  }

  async function rateMessage(messageId: number, rating: -1 | 1) {
    try {
      await rateMessageMutation.mutateAsync({ messageId, rating });
      setMessages(previous =>
        previous.map(message =>
          message.messageId === messageId ? { ...message, rating } : message
        )
      );
    } catch {
      toast.error("Die Bewertung konnte nicht gespeichert werden.");
    }
  }

  function openAttachmentPicker(kind: ComposerAttachment["kind"]) {
    attachKindRef.current = kind;
    setAttachMenuOpen(false);
    const input = attachFileInputRef.current;
    if (!input) return;
    input.value = "";
    input.accept =
      kind === "Foto" ? "image/*" : kind === "Video" ? "video/*" : "*/*";
    input.click();
  }

  function handleAttachmentFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length) {
      setAttachments(previous => [
        ...previous,
        ...files.map(file => ({
          id: `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name: file.name,
          kind: attachKindRef.current,
          size: file.size,
        })),
      ]);
    }
    event.target.value = "";
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
      setKeyTestResult({
        status: "unavailable",
        message:
          error instanceof Error
            ? error.message
            : "Die Prüfung konnte nicht abgeschlossen werden.",
      });
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

  // Sprint 097 — Live-Feedback im Erstellungs-Modal (keine Sackgassen):
  // Feldfehler erscheinen sofort neben dem Feld, nicht erst als Server-Fehler.
  const newVillaValidation = useMemo(
    () =>
      validateNewVillaForm({
        name: villaName,
        repository: villaRepository,
        projectBrief: villaIdea,
        description: villaDescription,
      }),
    [villaName, villaRepository, villaIdea, villaDescription]
  );

  async function createVilla(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (createVillaMutation.isPending) return;
    // Sprint 097 — Onboarding: Validierung VOR dem Absenden mit klaren
    // Meldungen; niemand landet in einer Server-Zod-Sackgasse.
    const validation = validateNewVillaForm({
      name: villaName,
      repository: villaRepository,
      projectBrief: villaIdea,
      description: villaDescription,
    });
    if (!validation.ok) {
      toast.error(Object.values(validation.errors)[0] ?? "Bitte prüfe deine Eingaben.");
      return;
    }
    const cleanName = villaName.trim();
    try {
      const cleanDescription = villaDescription.trim();
      const villa = await createVillaMutation.mutateAsync({
        name: cleanName,
        specialty: villaIdea.trim() ? "Autonome Projektentwicklung" : "Neuer Agent",
        icon: "villa",
        capacity: villaCapacity,
        ...(villaIdea.trim() ? { projectBrief: villaIdea.trim() } : {}),
        ...(cleanDescription ? { description: cleanDescription } : {}),
        ...(validation.normalizedRepository
          ? { repository: validation.normalizedRepository }
          : {}),
      });
      setVillaName("");
      setVillaDescription("");
      setVillaCapacity(8);
      setVillaIdea("");
      setVillaRepository("");
      setNewVillaOpen(false);
      setScreen("home");
      setActiveVillaId(villa.id);
      setMessages([]);
      // Sprint 097 — keine Sackgasse nach dem Erstellen: der naechste
      // sinnvolle Schritt steht sofort im Raum.
      toast.info(
        onboardingSteps({
          name: villa.name,
          repository: villa.repository ?? null,
          projectBrief: villa.projectBrief ?? null,
        })[0]
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Die Villa konnte nicht erstellt werden."
      );
    }
  }

  /** Sprint 072 — Autonome Mission aus dem Chat-Entwicklungsfenster. */
  async function startVillaMission() {
    if (!activeVilla || startVillaMissionMutation.isPending || chatMutation.isPending) return;
    if (
      !window.confirm(
        `Autonome Mission für „${activeVilla.name}" starten${activeVilla.repository ? ` auf ${activeVilla.repository}` : ""}? Der Superagent analysiert zuerst, verbessert dann umsatz- und autonomie-orientiert und übergibt am Ende einen Bericht. Änderungen laufen ausschließlich über agent/*-Branches und einen Draft-PR.`
      )
    )
      return;
    try {
      const result = await startVillaMissionMutation.mutateAsync({
        villaId: activeVilla.id,
        ...(missionObjective.trim() ? { objective: missionObjective.trim() } : {}),
        acknowledgeImpact: true,
      });
      setMissionObjective("");
      await messagesQuery.refetch();
      if (result.stopped) {
        toast.info("Mission über den Stopp-Knopf sauber abgeschlossen. Der Bericht steht im Chat.");
      } else {
        toast.success("Mission abgeschlossen. Der Bericht steht im Chat.");
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Die Mission konnte nicht gestartet werden."
      );
    }
  }

  async function stopVillaMission() {
    if (!activeVilla || stopVillaMissionMutation.isPending) return;
    try {
      await stopVillaMissionMutation.mutateAsync({ villaId: activeVilla.id });
      toast.info("Stopp signalisiert — die Mission schließt sich sauber ab.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Der Stopp konnte nicht signalisiert werden."
      );
    }
  }

  async function removeVilla(villa: Villa) {
    if (deleteVillaMutation.isPending) return;
    if (
      !window.confirm(
        `Villa „${villa.name}" inklusive Verlauf endgültig löschen?`
      )
    )
      return;
    try {
      await deleteVillaMutation.mutateAsync({ id: villa.id });
      if (activeVilla?.id === villa.id) {
        setActiveVillaId(null);
        setMessages([]);
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Die Villa konnte nicht gelöscht werden."
      );
    }
  }

  async function handleLogout() {
    // Nativ: Google-Plugin-Session mit abmelden (Play-Services), damit die
    // naechste Anmeldung sauber startet. Web: nichts zu tun.
    if (Capacitor.isNativePlatform()) {
      try {
        const { GoogleAuth } = await import("@codetrix-studio/capacitor-google-auth");
        await GoogleAuth.signOut();
      } catch (error) {
        console.warn("[Logout] Google signOut failed", error);
      }
    }
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
  // Sprint 064 — Offline-Chatcache: Verbindungsstatus und Lesehinweis.
  const isOnline = useOnlineStatus();
  const offlineBanner = offlineBannerMessage(isOnline, messages.length > 0);

  return (
    <main className={`villa-app theme-${theme}`} data-theme={theme}>
      <header className="app-header">
        <button
          className="icon-button nav-menu"
          aria-label="Menü öffnen"
          onClick={() => setDrawerOpen(true)}
        >
          <Menu />
        </button>
        <button
          className="brand-block"
          onClick={() => {
            setScreen("home");
            setMessages([]);
          }}
          aria-label="Zur Agenten-Villa"
        >
          <span className="brand-tile">
            {isWorkshop ? <Github /> : <Building2 />}
          </span>
          <span className="brand-copy">
            <strong>
              {isWorkshop
                ? "Superagent · Projekt-Werkstatt"
                : (activeVilla?.name ?? "Agenten-Villa")}
            </strong>
            <span>
              <i
                className={`status-dot${agentRunning ? " running" : " stopped"}`}
              />
              {isWorkshop
                ? `GitHub · ${statusQuery.data?.github?.configured ? "Repository verbunden" : "Token fehlt"}`
                : `${activeVilla?.specialty ?? "Neue Villa"} · ${agentRunning ? "Agent läuft" : statusQuery.data?.providers.openrouter ? "Agent gestoppt" : "OpenRouter-Schlüssel fehlt"}`}
            </span>
          </span>
          <ChevronDown className="brand-chevron" size={16} />
        </button>
        {!isWorkshop && (
          <nav className="header-tools" aria-label="Werkzeuge">
            <ThemeSwitcher />
            <button
              className="icon-button"
              aria-label="Projekt-Werkstatt"
              onClick={() => {
                setScreen("workshop");
                setMessages([]);
              }}
            >
              <Bot />
            </button>
            <button
              className={`icon-button${searchOpen ? " active" : ""}`}
              aria-label="Villen suchen"
              onClick={() => {
                setScreen("villas");
                setSearchOpen(true);
                setDrawerOpen(false);
              }}
            >
              <Search />
            </button>
            {(canControlUser) && (
              <a
                className="icon-button"
                aria-label="Mastervillage Controller"
                title="Mastervillage Controller"
                href="/core/controller"
              >
                <ShieldCheck />
              </a>
            )}
            <button
              className="icon-button tool-optional"
              aria-label="OpenRouter-Key prüfen"
              title={
                isAdminUser
                  ? "OpenRouter-Key sicher prüfen"
                  : "Administratorzugriff erforderlich"
              }
              disabled={!isAdminUser}
              onClick={() => {
                setOpenRouterKey("");
                setKeyTestResult(null);
                setKeyDialogOpen(true);
              }}
            >
              <SlidersHorizontal />
            </button>
          </nav>
        )}
        {isWorkshop && (
          <button
            className="new-project-button"
            onClick={() => setDrawerOpen(true)}
          >
            <Plus size={18} />
            <span>Neu</span>
          </button>
        )}
      </header>

      {searchOpen && screen === "villas" && (
        <div className="search-strip">
          <Search size={17} />
          <input
            autoFocus
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Villa suchen…"
            aria-label="Villa suchen"
          />
          <button
            aria-label="Suche schließen"
            onClick={() => {
              setSearchOpen(false);
              setQuery("");
              setScreen("home");
            }}
          >
            <X size={17} />
          </button>
        </div>
      )}

      {screen === "villas" ? (
        <section className="villa-library">
          <div className="library-heading">
            <div>
              <span className="eyebrow">DEIN AGENTEN-TEAM</span>
              <h1>Deine Villen</h1>
            </div>
            <button
              className="round-add"
              aria-label="Neue Villa"
              onClick={() => setNewVillaOpen(true)}
            >
              <Plus size={20} />
            </button>
          </div>
          {villaSnapshotQuery.data && (
            <p className="library-capacity">
              Villa {villaSnapshotQuery.data.id}:{" "}
              {villaSnapshotQuery.data.availableLogicalAgents.toLocaleString(
                "de-DE"
              )}{" "}
              von{" "}
              {villaSnapshotQuery.data.logicalAgentCapacity.toLocaleString(
                "de-DE"
              )}{" "}
              logischen Plätzen verfügbar ·{" "}
              {villaSnapshotQuery.data.provisioning === "lazy"
                ? "bedarfsgesteuert provisioniert"
                : villaSnapshotQuery.data.provisioning}{" "}
              · {villaSnapshotQuery.data.packs.length} Capability-Packs aktiv
            </p>
          )}
          {isAdminUser && guardianQuery.data && (
            <section className="guardian-panel" aria-label="Provider-Wächter">
              <header className="guardian-heading">
                <span>
                  <Route size={16} /> Provider-Wächter
                </span>
                <span
                  className={`guardian-state guardian-state-${guardianQuery.data.enabled ? "on" : "off"}`}
                >
                  {guardianQuery.data.enabled ? "autonom aktiv" : "pausiert"}
                </span>
              </header>
              <p className="guardian-active">
                Aktive Free-Route:{" "}
                <strong>{guardianQuery.data.activeModel ?? "keine"}</strong>
              </p>
              <ul className="guardian-routes">
                {guardianQuery.data.routes.map(route => (
                  <li key={route.model} className={`guardian-route status-${route.status}`}>
                    <span className="guardian-model">{route.model}</span>
                    <span className="guardian-badge">
                      {route.cooling
                        ? "Cooldown"
                        : route.status === "healthy"
                          ? "funktionsfähig"
                          : route.status === "unavailable"
                            ? "nicht erreichbar"
                            : "ungeprüft"}
                    </span>
                    <span className="guardian-detail">
                      {route.lastLatencyMs !== null
                        ? `${route.lastLatencyMs} ms`
                        : "—"}
                      {route.lastDetail ? ` · ${route.lastDetail}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="guardian-note">
                {guardianQuery.data.note}
                {guardianQuery.data.lastRunAt
                  ? ` Letzte Prüfung: ${new Date(guardianQuery.data.lastRunAt).toLocaleTimeString("de-DE")}.`
                  : ""}
              </p>
              <div className="guardian-actions">
                <button
                  type="button"
                  className="guardian-button"
                  disabled={runGuardianMutation.isPending}
                  onClick={() => runGuardianMutation.mutate()}
                >
                  {runGuardianMutation.isPending ? "Prüfe …" : "Jetzt prüfen"}
                </button>
                <button
                  type="button"
                  className="guardian-button secondary"
                  disabled={setGuardianMutation.isPending}
                  onClick={() =>
                    setGuardianMutation.mutate({
                      enabled: !guardianQuery.data?.enabled,
                    })
                  }
                >
                  {guardianQuery.data.enabled ? "Pausieren" : "Aktivieren"}
                </button>
              </div>
            </section>
          )}
          <div className="villa-list">
            {villaListQuery.isLoading && (
              <p className="empty-search">Villen werden geladen …</p>
            )}
            {villaListQuery.isError && (
              <p className="empty-search">
                Villen konnten nicht geladen werden:{" "}
                {villaListQuery.error instanceof Error
                  ? villaListQuery.error.message
                  : "Datenbank nicht erreichbar."}
                <button
                  className="retry-link"
                  onClick={() => villaListQuery.refetch()}
                >
                  Erneut versuchen
                </button>
              </p>
            )}
            {villaListQuery.isSuccess && villas.length === 0 && (
              <p className="empty-search">
                Noch keine Villa. Erstelle deine erste Agenten-Villa oben
                rechts.
              </p>
            )}
            {filteredVillas.map(villa => (
              <div
                key={villa.id}
                className={`villa-row${activeVilla?.id === villa.id ? " selected" : ""}`}
              >
                <button
                  className="villa-row-main"
                  onClick={() => chooseVilla(villa)}
                >
                  <span className="villa-row-icon">
                    {villa.icon === "villa" ? <Building2 /> : <Bot />}
                  </span>
                  <span className="villa-row-copy">
                    <strong>{villa.name}</strong>
                    <span>
                      {villa.archivedAt ? `Archiv · ${villa.specialty}` : villa.specialty}
                    </span>
                  </span>
                  {activeVilla?.id === villa.id && (
                    <Check className="selected-check" size={18} />
                  )}
                </button>
                <button
                  className="villa-row-archive"
                  aria-label={
                    villa.archivedAt
                      ? `Villa ${villa.name} wiederherstellen`
                      : `Villa ${villa.name} archivieren`
                  }
                  title={villa.archivedAt ? "Villa wiederherstellen" : "Villa archivieren"}
                  disabled={archiveVillaMutation.isPending}
                  onClick={() =>
                    archiveVillaMutation.mutate({ id: villa.id, archived: !villa.archivedAt })
                  }
                >
                  {villa.archivedAt ? <RotateCcw size={16} /> : <Archive size={16} />}
                </button>
                <button
                  className="villa-row-delete"
                  aria-label={`Villa ${villa.name} löschen`}
                  disabled={deleteVillaMutation.isPending}
                  onClick={() => removeVilla(villa)}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            {villaListQuery.isSuccess &&
              villas.length > 0 &&
              filteredVillas.length === 0 && (
                <p className="empty-search">Keine Villa gefunden.</p>
              )}
          </div>
          <button
            className="new-villa-button"
            onClick={() => setNewVillaOpen(true)}
          >
            <Plus size={18} /> Neue Villa
          </button>
          <button
            className="sign-out-link"
            type="button"
            onClick={handleLogout}
          >
            <ArrowLeft size={16} /> Abmelden
          </button>
        </section>
      ) : (
        <section
          className={`conversation ${isWorkshop ? "workshop" : "agent-home"}`}
        >
          <div className="conversation-scroll">
            {messages.length === 0 ? (
              <div className="welcome-panel">
                {!isWorkshop && activeVilla ? (
                  <div className="villa-stage" aria-label={`Villa ${activeVilla.name} mit Superagent`}>
                    <div className="villa-stage-sky" />
                    <svg className="villa-stage-house" viewBox="0 0 300 175" fill="none" aria-hidden="true">
                      <path d="M22 78 148 18l130 60v85H22V78Z" fill="#12264a" stroke="#66d8ef" strokeWidth="2" />
                      <path d="M22 78 148 18l130 60M148 18v145M22 78h256" stroke="#a099ff" strokeWidth="2" />
                      <path d="M46 96h62v44H46zm98 0h66v67h-66zm82 0h32v44h-32z" fill="#245783" stroke="#62d8fa" strokeWidth="2" />
                      <path d="M46 96h62v44H46zm98 0h66v67h-66zm82 0h32v44h-32z" fill="#43caff" opacity=".17" />
                      <path d="M22 163h256" stroke="#7f71ff" strokeWidth="3" />
                    </svg>
                    <span className="villa-stage-agent"><Bot size={31} /><span>SUPERAGENT</span></span>
                    <span className="villa-stage-state"><i className={`status-dot ${agentRunning ? "running" : "stopped"}`} />{agentRunning ? "Bereit" : "Gestoppt"}</span>
                  </div>
                ) : (
                  <div className={`hero-mark ${isWorkshop ? "robot" : "house"}`}>
                    {isWorkshop ? <Bot /> : <Building2 />}
                  </div>
                )}
                <h1>{isWorkshop ? "Superagent bereit" : (activeVilla?.name ?? "Agenten‑Villa")}</h1>
                <p>
                  {isWorkshop ? (
                    statusQuery.data?.github?.configured ? (
                      `Repository ${statusQuery.data.github.repository} ist verbunden. Aktiviere GitHub-Werkzeuge im Eingabebereich, damit der Agent Repo-Daten lesen und begrenzte Aufgaben auf einem Branch ausführen kann.`
                    ) : (
                      `GitHub ist für ${statusQuery.data?.github?.repository ?? "das konfigurierte Repository"} noch nicht verbunden. Hinterlege zuerst GITHUB_TOKEN als geschütztes Server-Secret; der Agent führt bis dahin keine Repo-Aktionen aus.`
                    )
                  ) : activeVilla ? (
                    <>
                      Dein Superagent für{" "}
                      <strong>{activeVilla.specialty}</strong> ist bereit. Die
                      Abteilungen Strategie, Recherche, Analyse und weitere
                      warten auf deine Anweisung.
                    </>
                  ) : (
                    <>
                      Erstelle deine erste Villa, dann startet dein Superagent
                      hier. Villen und Verläufe werden dauerhaft gespeichert.
                    </>
                  )}
                </p>
                {activeVilla && (
                  <div className="villa-project-actions">
                    {activeVilla.projectBrief && <p className="villa-project-brief">Projektziel: {activeVilla.projectBrief}</p>}
                    {activeVilla.repository && <p className="villa-project-brief">Verbundenes Repository: {activeVilla.repository}</p>}
                    {(!activeVilla.projectBrief || !activeVilla.repository) && (
                      <p className="villa-project-brief">
                        Nächste Schritte: {onboardingSteps({ name: activeVilla.name, repository: activeVilla.repository ?? null, projectBrief: activeVilla.projectBrief ?? null }).join(" ")}
                      </p>
                    )}
                    {isAdminUser && (
                      <div className="mission-launcher">
                        <input
                          className="mission-objective"
                          type="text"
                          value={missionObjective}
                          onChange={event => setMissionObjective(event.target.value)}
                          placeholder="Optionaler Auftrag (z. B. Fokus: Monetarisierung stabilisieren)"
                          aria-label="Auftrag für die autonome Mission"
                          maxLength={2000}
                          disabled={missionPending}
                        />
                        <button
                          className="mission-start"
                          type="button"
                          onClick={startVillaMission}
                          disabled={missionPending || chatMutation.isPending}
                        >
                          <Rocket size={16} />
                          {startVillaMissionMutation.isPending ? "Mission läuft …" : "Autonome Mission starten"}
                        </button>
                        {startVillaMissionMutation.isPending && (
                          <button
                            className="mission-stop"
                            type="button"
                            onClick={stopVillaMission}
                            disabled={stopVillaMissionMutation.isPending}
                          >
                            <Square size={14} /> Stoppen
                          </button>
                        )}
                      </div>
                    )}
                    {isAdminUser && (
                      <a className="villa-project-link" href={`/core/elite?villaId=${activeVilla.id}`}>
                        <Sparkles size={16} /> Projekt mit Superagent entwickeln
                      </a>
                    )}
                    <a className="villa-project-link secondary" href="/android/files">
                      <FolderOpen size={16} /> Android-Dateimanager
                    </a>
                  </div>
                )}
                {activeVilla && (
                  <div
                    className={`suggestion-list ${isWorkshop ? "workshop-ideas" : "home-ideas"}`}
                  >
                    {(isWorkshop ? workshopIdeas : homeIdeas).map(idea => (
                      <button
                        key={idea}
                        className="suggestion-chip"
                        onClick={() => sendMessage(idea)}
                      >
                        {idea}
                      </button>
                    ))}
                  </div>
                )}
                {!isWorkshop && !activeVilla && (
                  <button
                    className="modal-submit"
                    type="button"
                    onClick={() => setNewVillaOpen(true)}
                  >
                    <Plus size={17} /> Erste Villa erstellen
                  </button>
                )}
              </div>
            ) : (
              <div className="message-list" aria-live="polite">
                {messages.map((message, index) => (
                  <article
                    key={message.messageId ?? `${index}-${message.role}`}
                    className={`chat-message ${message.role}`}
                  >
                    {message.role === "assistant" && (
                      <span className="assistant-avatar">
                        <Bot size={16} />
                      </span>
                    )}
                    <div className="message-bubble">
                      {message.role === "assistant" && (
                        <div className="message-author">
                          {isWorkshop
                            ? "Superagent · Projekt-Werkstatt"
                            : `${activeVilla?.name ?? "Villa"} · Superagent`}
                        </div>
                      )}
                      <MessageMarkdown text={message.text} />
                      {message.syncState && syncNotice(message) && (
                        <div className="message-syncnotice" data-sync={message.syncState}>
                          {syncNotice(message)}
                          {message.role === "user" && message.syncState === "failed" && (
                            <button
                              type="button"
                              className="message-retry"
                              disabled={chatMutation.isPending}
                              onClick={() => retryFailedSend(index)}
                            >
                              Erneut senden
                            </button>
                          )}
                        </div>
                      )}
                      {message.role === "assistant" && message.meta && (
                        <div className="message-meta">{message.meta}</div>
                      )}
                      {message.role === "assistant" && message.messageId && (
                        <div
                          className="message-rating"
                          data-rated={message.rating ? "yes" : "no"}
                        >
                          <button
                            type="button"
                            aria-label="Antwort positiv bewerten"
                            className={message.rating === 1 ? "rated" : ""}
                            disabled={rateMessageMutation.isPending}
                            onClick={() =>
                              rateMessage(message.messageId as number, 1)
                            }
                          >
                            <ThumbsUp size={14} />
                          </button>
                          <button
                            type="button"
                            aria-label="Antwort negativ bewerten"
                            className={message.rating === -1 ? "rated" : ""}
                            disabled={rateMessageMutation.isPending}
                            onClick={() =>
                              rateMessage(message.messageId as number, -1)
                            }
                          >
                            <ThumbsDown size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                  </article>
                ))}
                {agentBusy && (
                  <article className="chat-message assistant" aria-live="polite">
                    <span className="assistant-avatar">
                      <Bot size={16} />
                    </span>
                    <div className="message-bubble progress-live">
                      <div className="message-author">
                        {startVillaMissionMutation.isPending ? "Autonome Mission läuft" : "Superagent arbeitet"}
                        {turnStartedAt !== null && (
                          <span className="progress-elapsed">
                            · {Math.max(0, elapsedTick)} s
                          </span>
                        )}
                      </div>
                      {startVillaMissionMutation.isPending && (
                        <button
                          className="mission-stop bubble-stop"
                          type="button"
                          onClick={stopVillaMission}
                          disabled={stopVillaMissionMutation.isPending}
                        >
                          <Square size={13} /> Stoppen — sauber abschließen
                        </button>
                      )}
                      <div className="progress-track" aria-hidden="true">
                        <div className="progress-fill" />
                      </div>
                      <ul className="progress-events">
                        {(progressQuery.data?.events ?? [])
                          .slice(-5)
                          .map((event, index, list) => {
                            const done = index < list.length - 1;
                            return (
                              <li
                                key={event.seq}
                                className={done ? "done" : "active"}
                              >
                                {done ? (
                                  <Check className="progress-check" size={12} />
                                ) : (
                                  <i className="ready-pulse" />
                                )}
                                {event.label}
                                <span className="progress-event-time">
                                  {new Date(event.at).toLocaleTimeString("de-DE")}
                                </span>
                              </li>
                            );
                          })}
                      </ul>
                      {progressQuery.data === null && (
                        <p className="progress-hint">
                          Auftrag wird vorbereitet …
                        </p>
                      )}
                    </div>
                  </article>
                )}
              </div>
            )}
          </div>
          <div className="composer-area">
{offlineBanner && <div className="offline-banner" role="status">{offlineBanner}</div>}
          {messagesQuery.isError && (
            <div className="offline-banner" role="alert">
              Verlauf konnte nicht geladen werden.{" "}
              <button
                type="button"
                className="message-retry"
                onClick={() => messagesQuery.refetch()}
              >
                Erneut laden
              </button>
            </div>
          )}
{messages.length > 0 && <div className="chat-ready"><span className="ready-pulse" />{chatMutation.isPending ? "Antwort wird erstellt …" : agentRunning ? "Agent bereit" : "Agent gestoppt"}<span>·</span> {isWorkshop ? "Projekt-Werkstatt" : "KI-Operations"}<button aria-label="Chat einklappen" onClick={() => setMessages([])}><ChevronDown size={18} /></button></div>}
            {isAdminUser && <button className="agent-control" type="button" disabled={controlMutation.isPending} onClick={() => (agentRunning && !window.confirm("Den Agentenbetrieb für alle Konten anhalten?")) ? undefined : controlMutation.mutate({ state: agentRunning ? "STOPPED" : "RUNNING", ...(agentRunning ? { acknowledgeStop: true } : {}) })}>{controlMutation.isPending ? "Status wird geändert …" : agentRunning ? "Agent stoppen" : "Agent starten"}</button>}
            <form className="message-composer" onSubmit={onSubmit}>
              <input
                ref={attachFileInputRef}
                type="file"
                multiple
                hidden
                onChange={handleAttachmentFiles}
              />
              <div className="attach-wrap">
                <button
                  className={`attach-button${attachMenuOpen ? " open" : ""}`}
                  type="button"
                  aria-label="Anhang hinzufügen"
                  aria-expanded={attachMenuOpen}
                  disabled={!isAuthenticated}
                  onClick={() => setAttachMenuOpen(previous => !previous)}
                >
                  <Plus size={20} />
                </button>
                {attachMenuOpen && (
                  <>
                    <button
                      type="button"
                      className="attach-backdrop"
                      aria-label="Anhang-Menü schließen"
                      onClick={() => setAttachMenuOpen(false)}
                    />
                    <div className="attach-menu" role="menu" aria-label="Anhänge">
                      <button type="button" role="menuitem" onClick={() => openAttachmentPicker("Datei")}>
                        <Paperclip size={15} />
                        <span>Dateien</span>
                      </button>
                      <button type="button" role="menuitem" onClick={() => openAttachmentPicker("Foto")}>
                        <ImageIcon size={15} />
                        <span>Fotos</span>
                      </button>
                      <button type="button" role="menuitem" onClick={() => openAttachmentPicker("Video")}>
                        <Video size={15} />
                        <span>Videos</span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setAttachMenuOpen(false);
                          setAdvancedOpen(true);
                        }}
                      >
                        <Link2 size={15} />
                        <span>Connectoren</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
              {attachments.length > 0 && (
                <div className="attachment-chips">
                  {attachments.map(attachment => (
                    <span className="attachment-chip" key={attachment.id}>
                      {attachment.name}
                      <button
                        type="button"
                        aria-label={`${attachment.name} entfernen`}
                        onClick={() =>
                          setAttachments(previous =>
                            previous.filter(item => item.id !== attachment.id)
                          )
                        }
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <textarea
                value={draft}
                onChange={event => setDraft(event.target.value)}
                placeholder={
                  isWorkshop
                    ? "Auftrag an den Superagenten…"
                    : "Anweisung an den Superagenten…"
                }
                rows={1}
                aria-label="Nachricht an den Superagenten"
                disabled={
                  !isAuthenticated ||
                  chatMutation.isPending ||
                  Boolean(activeVilla?.archivedAt)
                }
                onKeyDown={event => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    sendMessage();
                  }
                }}
              />
              {!isWorkshop && (
                <button
                  className={`mic-button${speech.listening ? " listening" : ""}`}
                  type="button"
                  aria-label={
                    speech.listening
                      ? "Spracheingabe stoppen"
                      : "Spracheingabe starten"
                  }
                  title={
                    speech.supported
                      ? "Spracheingabe (Deutsch)"
                      : "Spracheingabe wird von diesem Browser nicht unterstützt"
                  }
                  onClick={() => {
                    if (!speech.supported) {
                      toast.info(
                        "Spracheingabe wird von diesem Browser nicht unterstützt."
                      );
                      return;
                    }
                    speech.toggle();
                  }}
                >
                  <Mic size={20} />
                </button>
              )}
              {!isAuthenticated && !loading ? (
                <button
                  className="send-button"
                  type="button"
                  aria-label="Anmelden"
                  onClick={() => window.location.assign("/login")}
                >
                  <ArrowLeft size={19} />
                </button>
              ) : (
                <button
                  className="send-button"
                  type="submit"
                  aria-label="Senden"
                  disabled={
                    (!draft.trim() && attachments.length === 0) ||
                    !agentRunning ||
                    chatMutation.isPending
                  }
                >
                  <Send size={19} />
                </button>
              )}
            </form>
            {!agentRunning && statusQuery.data && (
              <p className="composer-stopped" role="status">
                Der Superagent ist gestoppt.{" "}
                {statusQuery.data.isAdmin
                  ? "Starte ihn über den Schalter oben."
                  : "Bitte den Administrator, ihn zu starten."}
              </p>
            )}
            {isAuthenticated && (
              <div className="advanced-settings">
                <button
                  type="button"
                  className="advanced-toggle"
                  aria-expanded={advancedOpen}
                  onClick={() => setAdvancedOpen(previous => !previous)}
                >
                  <span>
                    Details &amp; Systemeinstellungen
                    {!advancedOpen &&
                      isAdminUser &&
                      statusQuery.data?.systemPrompt
                      ? " · Anweisung aktiv"
                      : ""}
                    {!advancedOpen &&
                      isAdminUser &&
                      githubToolsEnabled
                      ? " · GitHub aktiv"
                      : ""}
                  </span>
                  <ChevronDown
                    size={14}
                    className={`advanced-chevron${advancedOpen ? " open" : ""}`}
                  />
                </button>
                {advancedOpen && (
                  <div className="advanced-settings-body">
                    {isAdminUser && (
                      <div className="admin-prompt-panel">
                        <strong>Eigene Systemanweisung (Administrator)</strong>
                        <small>Ersetzt die Standard-Persona des Assistenten. Leer lassen und speichern = Standard wiederherstellen. GitHub-Sicherheitsregeln und Anbieterrichtlinien gelten weiterhin.</small>
                        <textarea
                          value={effectivePrompt}
                          onChange={event => setPromptDraft(event.target.value)}
                          rows={2}
                          maxLength={4000}
                          aria-label="Eigene Systemanweisung"
                          placeholder="z. B. eigener Stil, eigene Rollenbeschreibung …"
                        />
                        <span className="prompt-actions">
                          <button className="agent-control" type="button" disabled={systemPromptMutation.isPending} onClick={() => systemPromptMutation.mutate({ prompt: effectivePrompt.trim() || null })}>{systemPromptMutation.isPending ? "Speichern …" : "Anweisung speichern"}</button>
                          <button className="agent-control" type="button" disabled={systemPromptMutation.isPending || !statusQuery.data?.systemPrompt} onClick={() => { setPromptDraft(null); systemPromptMutation.mutate({ prompt: null }); }}>Zurücksetzen</button>
                        </span>
                      </div>
                    )}
                    {isAdminUser && (
                      <label className="github-tool-toggle">
                        <input type="checkbox" checked={githubToolsEnabled} onChange={(event) => setGithubToolsEnabled(event.target.checked)} disabled={!statusQuery.data?.github?.configured || chatMutation.isPending} />
                        <span>
                          <strong>GitHub-Werkzeuge aktivieren</strong>
                          <small>{statusQuery.data?.github?.configured ? `${statusQuery.data?.github?.repository} · max. 3 Aktionen je Auftrag · Änderungen nur auf agent/*-Branches als Draft-PR` : "GITHUB_TOKEN fehlt — noch keine Repository-Aktionen möglich"}</small>
                        </span>
                      </label>
                    )}
                    <label className="fallback-consent">
                      <input
                        type="checkbox"
                        checked={allowHuggingFaceFallback}
                        onChange={event =>
                          setAllowHuggingFaceFallback(event.target.checked)
                        }
                      />{" "}
                      Hugging Face einmalig nur bei vorübergehendem
                      OpenRouter-Ausfall versuchen
                    </label>
                    <div className="composer-footnote">
                      <Sparkles size={12} />{" "}
                      {statusQuery.data?.notice ??
                        "Anbieterlimits gelten; keine bezahlte Ausweichroute. Agent standardmäßig gestoppt."}
                      {usageQuery.data &&
                        !isWorkshop &&
                        (usageQuery.data.unlimited
                          ? " · Elite: kein lokales Chat-Gesamtkontingent"
                          : ` · ${usageQuery.data.remainingTurns} Chats diese Stunde übrig`)}
                    </div>
                    <p className="composer-app-version">
                      App-Version {APP_VERSION} (Build {APP_BUILD})
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {drawerOpen && (
        <div
          className="drawer-backdrop"
          role="presentation"
          onClick={() => setDrawerOpen(false)}
        >
          <aside
            className="app-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            onClick={event => event.stopPropagation()}
          >
            <div className="drawer-top">
              <span className="drawer-title">Deine Villen</span>
              <button
                className="drawer-close"
                onClick={() => setDrawerOpen(false)}
                aria-label="Menü schließen"
              >
                <X size={20} />
              </button>
            </div>
            <label className="drawer-search">
              <Search size={17} />
              <input
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="Villa suchen…"
              />
            </label>
            <div className="drawer-villas">
              {filteredVillas.map(villa => (
                <button
                  key={villa.id}
                  className={`villa-row${activeVilla?.id === villa.id ? " selected" : ""}`}
                  onClick={() => chooseVilla(villa)}
                >
                  <span className="villa-row-icon">
                    {villa.icon === "villa" ? <Building2 /> : <Bot />}
                  </span>
                  <span className="villa-row-copy">
                    <strong>{villa.name}</strong>
                    <span>
                      {villa.archivedAt ? `Archiv · ${villa.specialty}` : villa.specialty}
                    </span>
                  </span>
                </button>
              ))}
            </div>
            <button
              className="new-villa-button"
              onClick={() => {
                setDrawerOpen(false);
                setNewVillaOpen(true);
              }}
            >
              <Plus size={18} /> Neue Villa
            </button>
            <div className="drawer-spacer" />
            <div className="drawer-telemetry" aria-label="Produkt-Telemetrie">
              <span className="theme-menu-title">Produkt-Telemetrie (optional)</span>
              <button
                role="switch"
                aria-checked={telemetryConsentQuery.data?.optedIn ?? false}
                className={`telemetry-toggle${telemetryConsentQuery.data?.optedIn ? " on" : ""}`}
                onClick={() =>
                  telemetryConsentMutation.mutate({
                    optedIn: !(telemetryConsentQuery.data?.optedIn ?? false),
                  })
                }
                disabled={telemetryConsentQuery.isLoading || telemetryConsentMutation.isPending}
              >
                {telemetryConsentQuery.data?.optedIn ? "Aktiviert" : "Deaktiviert"}
              </button>
              <p className="telemetry-notice">
                {telemetryConsentQuery.data?.notice ??
                  "Nur Zahlen, nie Inhalte — Hinweis wird geladen…"}
              </p>
            </div>
            <div className="drawer-theme" aria-label="Dashboard-Design">
              <span className="theme-menu-title">Design wählen</span>
              {themes.map(option => (
                <button
                  key={option.id}
                  role="menuitemradio"
                  aria-checked={option.id === theme}
                  className={`theme-option${option.id === theme ? " selected" : ""}`}
                  onClick={() => setTheme(option.id)}
                >
                  <span className="theme-swatch" aria-hidden="true">
                    {option.swatch.map((color, index) => (
                      <i key={index} style={{ background: color }} />
                    ))}
                  </span>
                  <span className="theme-option-copy">
                    <strong>{option.name}</strong>
                    <small>{option.tagline}</small>
                  </span>
                  {option.id === theme && (
                    <Check className="theme-option-check" size={16} />
                  )}
                </button>
              ))}
            </div>
            <button
              className="drawer-link"
              onClick={() => {
                setScreen("workshop");
                setMessages([]);
                setDrawerOpen(false);
              }}
            >
              <FolderGit2 size={18} /> Projekt-Werkstatt
            </button>
            {isAdminUser && (
              <button
                className="drawer-link"
                onClick={() => {
                  setDrawerOpen(false);
                  setOpenRouterKey("");
                  setKeyTestResult(null);
                  setKeyDialogOpen(true);
                }}
              >
                <KeyRound size={18} /> OpenRouter-Key prüfen
              </button>
            )}
            {isAdminUser && (
              <button
                className="drawer-link"
                type="button"
                disabled={runGuardianMutation.isPending}
                onClick={() => runGuardianMutation.mutate()}
              >
                <Route size={18} /> Free-Routen jetzt prüfen
              </button>
            )}
            <button
              className="drawer-link"
              type="button"
              onClick={handleLogout}
            >
              <ArrowLeft size={18} /> Abmelden
            </button>
          </aside>
        </div>
      )}

      {newVillaOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setNewVillaOpen(false)}
        >
          <form
            className="new-villa-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-villa-title"
            onSubmit={createVilla}
            onClick={event => event.stopPropagation()}
          >
            <div className="modal-heading">
              <span className="modal-mark">
                <Building2 size={20} />
              </span>
              <button
                type="button"
                className="drawer-close"
                aria-label="Schließen"
                onClick={() => setNewVillaOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            <h2 id="new-villa-title">Neue Villa erstellen</h2>
            <p>
              Gib deinem Superagenten einen Namen. Du kannst ihn später
              spezialisieren. Beschreibe optional ein Projektziel für eine autonome Elite-Mission.
            </p>
            <label className="modal-label" htmlFor="villa-name">
              Name
            </label>
            <input
              id="villa-name"
              className="modal-input"
              value={villaName}
              onChange={event => setVillaName(event.target.value)}
              placeholder="z. B. Marketing-Villa"
              autoFocus
              required
            />
            {villaName.trim() && newVillaValidation.errors.name && (
              <p className="modal-hint" role="alert">{newVillaValidation.errors.name}</p>
            )}
            <label className="modal-label" htmlFor="villa-idea">Projektidee (optional)</label>
            <textarea
              id="villa-idea"
              className="modal-input villa-idea-input"
              value={villaIdea}
              onChange={event => setVillaIdea(event.target.value)}
              maxLength={4000}
              placeholder="z. B. Entwickle einen Android-Dateimanager mit Speicheranalyse und bestätigten Dateiaktionen"
            />
            <label className="modal-label" htmlFor="villa-repository">
              GitHub-Repository (optional, „owner/repo“)
            </label>
            <input
              id="villa-repository"
              className="modal-input"
              value={villaRepository}
              onChange={event => setVillaRepository(event.target.value)}
              maxLength={120}
              placeholder="z. B. niknight1403/CyberSarah-control-center"
            />
            {villaRepository.trim() && newVillaValidation.errors.repository && (
              <p className="modal-hint" role="alert">{newVillaValidation.errors.repository}</p>
            )}
            {villaRepository.trim() && newVillaValidation.normalizedRepository && (
              <p className="modal-hint">Wird verbunden als „{newVillaValidation.normalizedRepository}".</p>
            )}
            <p className="modal-hint">
              Mit Repository arbeitet die Villa (Chat-Werkzeuge und autonome
              Missionen) direkt auf diesem Projekt; ohne Eintrag gilt das
              Server-Standard-Repository.
            </p>
            <label className="modal-label" htmlFor="villa-description">
              Beschreibung (optional, max. 1000 Zeichen)
            </label>
            <textarea
              id="villa-description"
              className="modal-input villa-idea-input"
              value={villaDescription}
              onChange={event => setVillaDescription(event.target.value)}
              maxLength={1000}
              placeholder="z. B. Analysiert Repositorys und schlägt Verbesserungen vor"
            />
            <label className="modal-label" htmlFor="villa-capacity">
              Kapazität (Eingabegrenze in Tausend Zeichen)
            </label>
            <select
              id="villa-capacity"
              className="modal-input"
              value={villaCapacity}
              onChange={event => setVillaCapacity(Number(event.target.value))}
            >
              {Array.from({ length: 25 }, (_, index) => index + 1).map(value => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
            <button className="modal-submit" type="submit">
              <Plus size={17} /> Villa mit Superagent erstellen
            </button>
          </form>
        </div>
      )}

      {keyDialogOpen && isAdminUser && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={closeKeyDialog}
        >
          <section
            className="new-villa-modal credential-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="key-dialog-title"
            onClick={event => event.stopPropagation()}
          >
            <div className="modal-heading">
              <span className="modal-mark">
                <KeyRound size={20} />
              </span>
              <button
                type="button"
                className="drawer-close"
                aria-label="Dialog schließen"
                onClick={closeKeyDialog}
              >
                <X size={18} />
              </button>
            </div>
            <h2 id="key-dialog-title">OpenRouter-Key testen</h2>
            <p>
              Nur Administratoren. Der maskiert eingegebene Schlüssel wird
              einmalig per HTTPS an OpenRouter gesendet, danach aus dem Formular
              gelöscht und nicht gespeichert. Es wird keine Modellanfrage
              ausgelöst.
            </p>
            <form onSubmit={testOpenRouterKey}>
              <label className="modal-label" htmlFor="openrouter-api-key">
                API-Key
              </label>
              <input
                id="openrouter-api-key"
                className="modal-input"
                type="password"
                value={openRouterKey}
                onChange={event => {
                  setOpenRouterKey(event.target.value);
                  setKeyTestResult(null);
                }}
                placeholder="sk-or-…"
                autoComplete="new-password"
                autoCapitalize="none"
                spellCheck={false}
                required
                minLength={8}
                maxLength={512}
                disabled={keyTestMutation.isPending}
              />
              <button
                className="modal-submit"
                type="submit"
                disabled={!openRouterKey.trim() || keyTestMutation.isPending}
              >
                {keyTestMutation.isPending ? (
                  <>
                    <Loader2 size={17} className="spin" /> Prüfe
                    Authentifizierung …
                  </>
                ) : (
                  <>
                    <ShieldCheck size={17} /> Schlüssel sicher testen
                  </>
                )}
              </button>
            </form>
            {keyTestResult && (
              <p
                className={`key-test-result ${keyTestResult.status}`}
                role="status"
                aria-live="polite"
              >
                {keyTestResult.message}
              </p>
            )}
            <p className="key-dialog-note">
              Für den Live-Agenten muss ein gültiger Schlüssel anschließend
              separat über den geschützten Projekt-Secret-Manager eingerichtet
              werden. Die Oberfläche speichert oder übernimmt ihn absichtlich
              nicht.
            </p>
          </section>
        </div>
      )}

      <footer className="mobile-tabbar" aria-label="Schnellnavigation">
        <button
          className={!isWorkshop && screen !== "villas" ? "tab-active" : ""}
          aria-label="Agenten-Chat"
          onClick={() => {
            setScreen("home");
            setMessages([]);
          }}
        >
          <MessageSquare size={19} />
        </button>
        <button
          className={screen === "villas" ? "tab-active" : ""}
          aria-label="Meine Villen"
          onClick={() => {
            setScreen("villas");
            setSearchOpen(false);
            setQuery("");
          }}
        >
          <LayoutGrid size={19} />
        </button>
        <button
          className={isWorkshop ? "tab-active" : ""}
          aria-label="Projekt-Werkstatt"
          onClick={() => {
            setScreen("workshop");
            setMessages([]);
          }}
        >
          <Code2 size={20} />
        </button>
        <button
          aria-label="Neuen Agenten erstellen"
          onClick={() => setNewVillaOpen(true)}
        >
          <Plus size={21} />
        </button>
      </footer>
    </main>
  );
}
