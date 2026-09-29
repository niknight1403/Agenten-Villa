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

## Wichtige Pfade

- `server/` — tRPC-Router, Stores, GitHub-Tools, Provider-Router, Elite-Mission
- `client/src/` — React-Seiten und Komponenten
- `drizzle/` — Schema und Migrationen (0000–0008)
- `docs/` — Deploy, APK, Testing, Roadmap, Sprintstatus
