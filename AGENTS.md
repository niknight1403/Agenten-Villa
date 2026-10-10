# AGENTS.md — Agenten-Villa

Persistente Projektnotizen für autonome Arbeitssitzungen.

## Projekt

Sichere Agenten-Werkstatt ("Villa") mit 5.000 lazy provisionierten Agentenplätzen.
Stack: React 19 + Vite (Client), Express + tRPC (Server), Drizzle ORM + PostgreSQL (Neon), pnpm.

## Setup (bereits ausgeführt)

```bash
export PATH="$HOME/.local/bin:$PATH"   # pnpm 10.4.1 liegt hier
pnpm install --frozen-lockfile
```

Hinweis: Node im Container ist v24 (Projekt wünscht `>=22 <23`). Das erzeugt nur eine
Warnung ("Unsupported engine"), Typecheck/Tests/Build laufen trotzdem sauber.

## Qualitäts-Gate (alles muss grün sein)

```bash
pnpm check   # tsc --noEmit
pnpm test    # vitest — erwartet 169 passed / 4 skipped
pnpm build   # vite + esbuild
pnpm validate # check + test + build + git diff --check
```

Externe Provider-Schlüssel (`OPENROUTER_API_KEY`, `HF_TOKEN`, `GITHUB_TOKEN`) sind für
den lokalen Validierungsweg NICHT nötig; Live-Tests sind separat markiert.

### Lokale End-to-End-Prüfung (Chat-Pipeline)

Für echte Laufzeittests ohne externen Anbieter:

1. Postgres bereitstellen und `DATABASE_URL` setzen (lokal z. B. `postgres://villa:villa@127.0.0.1:5433/villa`).
2. `OPENROUTER_BASE_URL=http://127.0.0.1:<port>/v1` auf einen lokalen Mock zeigen —
   der Endpunkt wird zu `<base>/chat/completions`.
3. Server mit `JWT_SECRET` starten und ein signiertes Session-Cookie
   (`app_session_id`, HS256 mit `{openId, appId, name}`) setzen.

Nützliche Helfer: `pnpm seed:villa -- --user <id>` bzw. `--email <adresse>` legt die
Projekt-Villa direkt per Store-Funktion an.

## Provider-Wächter & Free-Routen

`server/provider-guardian.ts` pflegt den Gesundheitszustand der kostenlosen Modellkette.
Er wird beim Serverstart (`server/_core/index.ts`) gestartet und läuft autonom im
Intervall `PROVIDER_GUARDIAN_INTERVAL_MS` (Default 300000, min. 30000, max 3600000).

- `guardianChain()` sortiert `OPENROUTER_MODELS` nach echter Gesundheit: funktionsfähig
  zuerst, ungeprüft danach, Cooldown zuletzt. Die Liste ist nie leer.
- `reportProviderOutcome()` wird im echten Chat-Pfad aufgerufen, damit Health auf echtem
  Verkehr basiert, nicht nur auf geplanten Probes.
- `server/provider-endpoints.ts` ist die einzige Quelle für Provider-URLs. `OPENROUTER_BASE_URL`
  wird sowohl von Probes als auch vom Chat verwendet — deshalb funktioniert der lokale Mock.
- tRPC: `agent.guardian` (Query), `agent.runProviderGuardian`, `agent.setProviderGuardian` —
  alle admin-gated. `agent.status` liefert zusätzlich `providerGuardian` und `eliteUnlimited`.
- Tests: `server/provider-guardian.test.ts`. Bei Änderungen an der Kette
  `resetProviderGuardianForTests()` in `afterEach` aufrufen, sonst leckt Modulzustand
  zwischen Testdateien.

Harte Grenze: Der Wächter erzeugt keine Token, rotiert keine Schlüssel und umgeht keine
Anbieterkontingente. „Elite/Unlimited" heißt ausschließlich: kein lokales Villa-Kontingent.
Es gibt bewusst kein `limit-bypass`-Pack — `agent-villa.test.ts` prüft das.

## Multi-Provider-Failover

`server/agent-engine.ts` (Funktion `callWithProviderChain`) ruft die Anbieter in
festgelegter Reihenfolge auf: **OpenRouter -> Groq -> Gemini**; Hugging Face bleibt
ein willentlicher, einwilligungsgebundener Chat-Fallback (`allowHuggingFaceFallback`).

- Ziel: Erschöpft EIN freies Tageskontingent, wechselt die Kette automatisch zum
  nächsten Anbieter und nutzt ausschließlich **dessen eigenes** Kontingent. Kein
  Anbieter wird umgangen, nichts wird als unbegrenzt vorgetäuscht.
- Fehlerklassen: `LIMIT` (429/402) und `UNAVAILABLE`/`INVALID_RESPONSE` führen zum
  nächsten Modell bzw. Anbieter; `AUTH` spart den ganzen Anbieter aus (30 Min
  prozesslokaler Cooldown, danach fail-closed neu probiert); `REJECTED` ist
  terminal — Ablehnungen werden nicht durch Anbietertausch umgangen.
- Vor jedem Anbieterwechsel fragt die Kette `beforeFallback` (Elite-Lease/Stopp-Schutz).
- Env: `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY`, `HF_TOKEN` (alle
  außer OpenRouter optional); Modellketten via `OPENROUTER_MODELS`, `GROQ_MODELS`,
  `GEMINI_MODELS`, `HF_MODEL` überschreibbar (`server/provider-endpoints.ts`).
- Der GitHub-Werkzeug-Loop (inkl. Elite-Missionen) nutzt dieselbe Kette, aber ohne
  Hugging Face (die Einwilligung ist ein Chat-Attribut und existiert dort nicht).
- tRPC-Status: `agent.status` zeigt `providers` mit konfigurierten Anbietern;
  `providerRouting` (agent-villa) wählt die aktive Route entsprechend.
- Tests: `server/agent-engine.test.ts` (`multi-provider failover chain`) — bei
  Änderungen `resetProviderChainForTests()` in `afterEach` aufrufen.

## Design-Themes

Vier wählbare Dashboard-Designs liegen in `client/src/styles/themes.css` und werden über
`DashboardThemeProvider` (`client/src/contexts/DashboardThemeContext.tsx`) gesteuert. Die
Theme-Klasse `theme-<id>` sitzt auf `.villa-app`; ohne Klasse gilt weiter das bisherige
Design. Die Wahl wird in `localStorage["villa-dashboard-theme"]` gespeichert.

## Web-Login (Google OAuth) — Betrieb hinter dem Proxy

- `app.set("trust proxy", 1)` ist Pflicht (siehe `server/_core/index.ts`). Ohne das liest
  Express die Proxy-IP als `req.ip`; dann teilen sich ALLE Besucher einen einzigen
  Rate-Limit-Bucket (`/api/auth`, 20/Minute) und ab der 21. Anfrage bekommt jeder 429 —
  der Login wirkt dadurch „kaputt", obwohl die OAuth-Kette intakt ist. Live reproduziert:
  die Produktions-URL lieferte nach 20 schnellen Aufrufen 429, auch mit fremder
  `X-Forwarded-For`.
- `getRedirectUri()` (`server/_core/googleAuth.ts`) muss in Start und Token-Tausch exakt
  dieselbe URI liefern. Proxy-Header können Komma-Listen sein ("https, http"); es gilt der
  erste Eintrag. `PUBLIC_BASE_URL` pinnt die URI auf die in der Google Cloud Console
  registrierte und entfernt die Abhängigkeit von Proxy-Headern.
- `redirect_uri_mismatch` beim Token-Tausch äußert sich als
  `/login?error=token_exchange_failed`.

## Nativer Google-Sign-In (Android)

Der native Login läuft über `@codetrix-studio/capacitor-google-auth`. Zwei Fallstricke:

- **Scopes müssen ein String sein**, kein Array. `GoogleAuth.java` liest sie mit
  `getConfig().getString("scopes")`; ein Array erzeugt eine `JSONException`, der Default
  `""` greift, und `new Scope("")` wirft `IllegalArgumentException` — Capacitor reicht das
  als `RuntimeException` weiter und der App-Prozess stirbt (Absturz beim Antippen von
  „Anmelden"). Der TS-Typ `InitOptions.scopes` ist irreführend als `string[]` deklariert.
  `server/native-google-auth-config.test.ts` sichert das ab.
- **Android-OAuth-Client nötig**: im Google-Cloud-Projekt muss ein Android-Client für
  `de.niknight1403.agentenvilla` mit dem SHA-1 des installierten APKs liegen. Fehlt er,
  meldet Google Code 10 (`DEVELOPER_ERROR`). Fingerprints beider Keystores und die
  Einrichtung stehen in `docs/APK.md`.

## Konventionen

- Sprache: Code/Kommentare meist Englisch, Docs und Commit-Messages teils Deutsch.
- Sprintarbeit ist in `docs/ROADMAP-100-SPRINTS.md` und `docs/SPRINT-STATUS.md` dokumentiert
  (Sprints 001–020 grün, 021–100 geplant).
- Sicherheitsgrenzen gelten hart: kein autonomes Merge, kein Schreiben auf `main`,
  keine Änderungen an `.github/workflows`, keine Secrets-/Berechtigungsverwaltung.
- Release-Ablauf: APK per `workflow_dispatch` mit vollem Commit-SHA als `ref`-Input aus
  genau dem Commit bauen, der getaggt wird — nicht aus einem älteren Artefakt. Danach
  annotiertes Tag pushen und Release anlegen. Prüfen, dass der Baum des Merge-Commits
  mit dem Release-Commit identisch ist (`git diff --quiet <release> <merge>`).
- Die beiden APK-Hashes unterscheiden sich bei jedem Build (Zip-Zeitstempel, Padding in
  der Signatur). Zum Vergleich den Web-Payload (`assets/public/**`) und
  `assets/capacitor.config.json` hashen, nicht die ganze Datei.
- `GITHUB_TOKEN` im Container reicht zum Lesen und für viele Schreibwege, aber Merge und
  Release-Bearbeitung liefern damit 403 ("Resource not accessible by integration").
  Dafür den Repo-Token mit `repo`-Scope verwenden.
- Git-Flow: Änderungen auf `agent/*`-Branch, dann Draft-PR gegen `main`.

## Lokale Konfiguration & Zugänge

- Es gibt **keinen Passwort-Login**. Anmeldung ist ausschließlich Google OAuth
  (`server/_core/googleAuth.ts` Web, `server/_core/nativeAuth.ts` Android). Die Passwort-Felder
  in der UI dienen dem OpenRouter-Key-Test, nicht Konten. Ein Konto-Passwort wird nirgends geprüft.
- Administratorzugriff läuft allein über die Allowlist `AGENT_ADMIN_EMAIL`
  (`server/agent-router.ts` `isAdmin`, `googleAuth.ts`). Beim Google-Login erhält die passende
  E-Mail automatisch `role=admin`; Code allein kann die Rolle nicht vergeben.
- Lokale `.env` (gitignored, Modus 600) setzt `AGENT_ADMIN_EMAIL` und ein lokales `JWT_SECRET`;
  `GITHUB_TOKEN` wird aus der Containerumgebung übernommen. Session-Cookie `app_session_id` ist
  ein HS256-JWT (`{openId, appId, name}`); der Benutzer wird per `openId` aus der DB aufgelöst.
- Actions-Secrets setzen: Das Container-`GITHUB_TOKEN` ist ein **GitHub-App-Installationstoken**
  ohne Actions-Rechte (`actions/secrets` → 403 "Resource not accessible by integration"). Nötig ist
  ein klassischer PAT mit `repo`-Scope (`gh secret set NAME --repo …`, Wert per stdin). Live-Test:
  `RUN_LIVE_GITHUB_SECRET=1` in `server/github-secret.live.test.ts`.
- `getRedirectUri()` (`server/_core/googleAuth.ts`) leitet die Callback-URI aus
  `PUBLIC_BASE_URL` bzw. `X-Forwarded-Proto`/`Host` ab. Im Vorschau-Proxy lautet sie
  `https://work-<n>-<id>.prod-runtime.all-hands.dev/api/auth/google/callback`; diese URI muss in
  der Google Cloud Console als autorisierte Redirect-URI stehen, sonst scheitert der Token-Tausch
  (`/login?error=token_exchange_failed`). `PUBLIC_BASE_URL` pinnt sie fest.
- Google-OAuth-Client-Secret heißt in Actions `GOOGLE_CLIENT_SECRET` (war dort zuvor nicht gesetzt).

## Neon (Projekt `holy-dew-30703563`)

- Neon-CLI (`neon` npm-Paket, global via `sudo npm i -g neon@latest`) ist installiert. Das
  Installation-Image setzt Root-only-Rechte (700/600) auf `/usr/local/lib/node_modules/neon` —
  danach `sudo chmod -R a+rX` nötig, sonst findet der Nutzer die CLI nicht.
- Auth non-interaktiv über `NEON_API_KEY` (Profil `agent`, `~/.config/neon/`). `neon login`
  hängt im Container am Browser-Callback — stattdessen `neon profile create agent --api-key -`.
- Org: `org-mute-art-28567781` (niko.oeben@gmail.com). Projekt `holy-dew-30703563`
  („Agenten Villa", aws-eu-central-1, PG 18), Branch `production` = `br-patient-surf-b2u2x8gj`.
- Verlinkung steht in `.neon` (gitignored). `neon link` hat 6 Variablen nach `.env` gezogen:
  `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `NEON_BRANCH`, `NEON_AUTH_BASE_URL`,
  `NEON_AUTH_JWKS_URL`, `NEON_FUNCTION_API_BASE_URL`.
- `neon.ts` (Policy, `@neon/config` + `@neon/env` als Root-Deps) und `hello.ts` (Neon Function)
  liegen im Repo-Root. `neon deploy` (= `config apply`) deployt die Funktion; URL:
  `https://br-patient-surf-b2u2x8gj-api.compute.c-6.eu-central-1.aws.neon.tech/`.
  `neon config init` scheitert beim Auto-Install, weil `pnpm` nicht im PATH ist —
  `corepack pnpm add -w @neon/config @neon/env` nachziehen.
- `neon.ts` nutzt das GA-Schema: `functions` steht auf oberster Ebene (nicht mehr unter
  `preview`, das ist deprecated). `neon deploy` meldet damit keine Veraltet-Warnung mehr.
- `neon skills -y` und `neon mcp -y` erkennen OpenHands NICHT als Coding-Agent (unterstützt sind
  vscode, cursor, claude-code, codex, …). Skills: `-a vscode` wählen, sie landen trotzdem in
  `{project}/.agents/skills/` (von OpenHands gelesen). MCP: `neon mcp` schreibt nur in
  Agent-eigene Configs (z. B. `~/.config/Code/User/mcp.json`); der Server
  `https://mcp.neon.tech/mcp` muss in OpenHands manuell als `mcp_servers` hinterlegt werden.
- `pnpm db:push` gegen die Neon-DB angewandt (10 Tabellen). Danach meldet `/api/health`
  `database.status: "verbunden"`.

## Wichtige Pfade

- `server/` — tRPC-Router, Stores, GitHub-Tools, Provider-Router, Elite-Mission
- `client/src/` — React-Seiten und Komponenten
- `drizzle/` — Schema und Migrationen (0000–0008)
- `docs/` — Deploy, APK, Testing, Roadmap, Sprintstatus

## Master-Prompt-Charter (Sprint 101)

Die Mission "System-Analyse, Hyper-Autonomie & Revenue Optimization" für das
integrierte Projekt CyberSarah Control Center liegt in
`docs/MASTER-PROMPT.md`. Verbindliche Regeln:

1. **Schritt-für-Schritt-Freigabe:** Die vier Abschnitte werden ausschließlich
   nacheinander abgearbeitet — erst Plan, dann Admin-Freigabe, dann Code,
   dann Verifikation (`server/master-prompt.ts`).
2. **Trading-Gate:** Live-Handel erfordert Mindest-Win-Rate 68 % über
   mindestens 500 simulierte Trades, stabilen Profit-Faktor (>= 1.25) und ein
   Simulationsfenster jünger als 24 h — plus separate Admin-Freigabe für echte
   API-Keys (`server/trading-gate.ts`, Gate `live-trading-keys`).
3. **Abbruchkriterium:** Entwicklung stoppt erst, wenn alles grün ist und
   funktioniert.
