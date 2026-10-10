# Administrator-Handbuch — Agenten-Villa

Dieses Handbuch dokumentiert Betrieb, Grenzen und Notfallstop der
Agenten-Villa für Administratoren. Es ist bewusst knapp und ehrlich: Was hier
nicht steht, steht in den referenzierten Dokumenten — nichts wird behauptet,
was der Code nicht hergibt. Ein Test (`server/admin-handbook.test.ts`) prüft
die harten Fakten (Umgebungsvariablen, Zustände, Limits) gegen den Code.

**Rollenmodell:** Administratoren besitzen alle Rechte, Operatoren steuern
den Betrieb (Start/Stop, System-Prompt), Viewer lesen nur. Details:
`server/roles.ts` und Sprint 051 im Status-Dokument.

---

## 1 · Betrieb

### 1.1 Plattform und Deployment

Die App läuft als Node-Server mit PostgreSQL (Neon) und pnpm. Das
Schritt-für-Schritt-Deployment — Datenbank anlegen, Schema pushen, Render-Service,
Google-Anmeldung, Administratorkonto, APK-Bau — steht in `docs/DEPLOY.md`.
Build und Reproduzierbarkeit: `pnpm build` bzw. `pnpm build:manifest`
(`docs/TESTING.md`).

### 1.2 Server-Secrets (Umgebung)

Alle Schlüssel leben als geschützte Server-Secrets — nie im Code, nie im
Repository. Relevant sind genau diese Variablen (`server/_core/env.ts` und
`server/agent-engine.ts`):

| Variable | Zweck |
| --- | --- |
| `NODE_ENV` | `production` schaltet Produktionsverhalten ein |
| `VITE_APP_ID` | App-ID fuer den OAuth-Flow (Default `agenten-villa`) |
| `DATABASE_URL` | PostgreSQL-Verbindung (Neon) |
| `JWT_SECRET` | Cookie-/Session-Signatur |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google-Anmeldung |
| `OAUTH_SERVER_URL` / `OWNER_OPEN_ID` | OAuth-/Owner-Identifikation |
| `BUILT_IN_FORGE_API_URL` / `BUILT_IN_FORGE_API_KEY` | Forge-Provider (erste Fallback-Route) |
| `OPENROUTER_API_KEY` | OpenRouter (Free-Tier-Modelle) |
| `GROQ_API_KEY` | Groq |
| `GEMINI_API_KEY` | Gemini |
| `HF_TOKEN` | Hugging-Face-Fallback — nur nach ausdrücklicher Nutzereinwilligung |
| `GITHUB_TOKEN` | GitHub-Werkzeuge; für autonome Missionen zwingend |
| `GITHUB_REPOSITORY` | Ziel-Repository (Default `niknight1403/Agenten-Villa`) |

Ohne mindestens einen Modellanbieter-Schlüssel (`OPENROUTER_API_KEY`,
`GROQ_API_KEY`, `GEMINI_API_KEY` oder `HF_TOKEN`) startet keine autonome
Mission; der Fehler ist explizit und benannt die fehlenden Secrets.

### 1.3 Provider-Fallback und Cooldown

Der LLM-Router probiert Provider in fester Reihenfolge: Forge → OpenRouter →
Groq → Gemini. Bei HTTP 402/429/503 geht ein Provider für 5 Minuten in den
Cooldown und die nächste Route übernimmt. Neue Provider sind seit Sprint 095
reine Registrierungen (`registerLLMProvider`), kein Kernumbau.

### 1.4 Watchdog (24/7-Diagnose-Loop)

Der Controller betreibt einen begrenzten Diagnose-Loop: Lease-Sweep,
Datenbanksonde (`SELECT 1`), Provider-Statusabfragen ohne Completion-Aufruf
(kein Kontingentverbrauch) und Prozessmetriken. Unterbrochene Missionen werden
nur gezählt und angezeigt; ein Neustart bleibt an die ausdrückliche
Administrator-Freigabe gebunden. Der Loop-Zustand wird in
`data/controller-state.json` persistiert und startet standardmäßig im
Zustand `STOPPED`.

---

## 2 · Grenzen

### 2.1 Modellaufrufe und Missionen

Elite-Missionen (`server/agent-engine.ts`, `ELITE_LIMITS`):

- Prompt: 12 000 Zeichen; Historie: 20 Nachrichten / 4 000 Zeichen
- Ausgabe: standardmäßig 4 096, konfigurierbar bis 8 192 Tokens
- Timeout je Modellaufruf: 30 000 ms
- GitHub-Aktionen je Elite-Mission: **24** (Standard-Chat: 3 je Turn)
- Werkzeugrunden: 12; Abschluss-Nudges: 2; Tool-Kontext: 48 000 Zeichen

### 2.2 GitHub-Schreibgrenzen

Schreibzugriffe erfolgen ausschließlich auf `agent/*`-Branches, die in
derselben Mission angelegt wurden; Ergebnisse sind immer Draft-PRs. Niemals:
Merge, Löschungen, Default-Branch, Secrets, Berechtigungen,
`.github/workflows`, Repository-Einstellungen. Analysephasen dürfen nur
lesende GitHub-Werkzeuge verwenden.

### 2.3 Freigabepunkte (Approval-Gates)

Kritische Mutationen verlangen ausdrückliche Quittung im Aufruf
(`server/approval-gates.ts`): `mission-start` (Impact anerkennen) und
`controller-stop` (Stopp bestätigen, siehe unten). Ohne Quittung wirft der
Router `PRECONDITION_FAILED`.

### 2.4 Audit und Metriken

Jede kritische Änderung schreibt einen Audit-Eintrag (Zeit, Nutzer, Aktion;
`server/audit-trail.ts`-Werkzeuge, Sprint 052). Laufmetriken
(`server/agent-metrics.ts`) erfassen Laufzeit, Fehler und Ergebnisstatus je
Anbieter; Telemetrie enthält keine Nutzdaten oder Secrets.

---

## 3 · Notfallstop

### 3.1 Betriebszustand STOPPED

Der zentrale Notfallhebel ist die tRPC-Mutation `agent.setState`:

```ts
agent.setState({ state: "STOPPED", acknowledgeStop: true })
```

- Benötigt Rolle **Operator** oder Administrator.
- Der Stopp verlangt die Quittung `acknowledgeStop: true` — ohne sie wirft
  die Mutation (`controller-stop`-Freigabepunkt).
- Im Zustand `STOPPED` startet **keine** neue Mission: `mission-start` und
  Villa-Missionen prüfen `controlState === "RUNNING"` und werfen
  `PRECONDITION_FAILED` mit klarem Text.
- Laufende Züge fallen nach ihrem Timeout von selbst; der Watchdog läuft als
  ungefährliche Diagnose weiter und zeigt unterbrochene Missionen an.
- Die Zustandsänderung wird im Audit-Log protokolliert.

Wiederaufnahme symmetrisch: `agent.setState({ state: "RUNNING" })` (Operator,
keine Quittung nötig, da kein Risiko).

### 3.2 Was der Notfallstop NICHT tut

Er beendet keine bereits laufenden LLM-Aufrufe hart, löscht keine Daten und
sperrt keine Nutzer. Er ist ein Start-Stopp-Schalter für autonome Missionen —
für alles andere gelten die Grenzen aus Abschnitt 2.

### 3.3 Eskalations-Kurzliste

1. Stop setzen (Abschnitt 3.1) — neue Missionen sind sofort blockiert.
2. Secrets prüfen/rotieren (Anbieter-Dashboard, dann Render-Umgebung).
3. Watchdog-Report lesen (`agent.controllerState`): DB-Sonde,
   Provider-Status, unterbrochene Missionen.
4. Nach Ursachenbehebung: `agent.setState({ state: "RUNNING" })`.

---

## 4 · Verwandte Dokumente

- `docs/DEPLOY.md` — Deployment Schritt für Schritt
- `docs/TESTING.md` — Testpyramide, Build-Reproduzierbarkeit
- `docs/RELEASE-CHECKLISTE.md` / `docs/RELEASE-REVIEW.md` — Release-Prozess
- `docs/SPRINT-STATUS.md` — Sprint-Verlauf und Architektur-Entscheidungen
- `docs/ELITE-MISSION-RECOVERY.md` — Umgang mit unterbrochenen Missionen
