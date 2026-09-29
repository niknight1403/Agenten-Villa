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
pnpm test    # vitest — erwartet 149 passed / 4 skipped
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

## Design-Themes

Vier wählbare Dashboard-Designs liegen in `client/src/styles/themes.css` und werden über
`DashboardThemeProvider` (`client/src/contexts/DashboardThemeContext.tsx`) gesteuert. Die
Theme-Klasse `theme-<id>` sitzt auf `.villa-app`; ohne Klasse gilt weiter das bisherige
Design. Die Wahl wird in `localStorage["villa-dashboard-theme"]` gespeichert.

## Konventionen

- Sprache: Code/Kommentare meist Englisch, Docs und Commit-Messages teils Deutsch.
- Sprintarbeit ist in `docs/ROADMAP-100-SPRINTS.md` und `docs/SPRINT-STATUS.md` dokumentiert
  (Sprints 001–020 grün, 021–100 geplant).
- Sicherheitsgrenzen gelten hart: kein autonomes Merge, kein Schreiben auf `main`,
  keine Änderungen an `.github/workflows`, keine Secrets-/Berechtigungsverwaltung.
- Git-Flow: Änderungen auf `agent/*`-Branch, dann Draft-PR gegen `main`.

## Wichtige Pfade

- `server/` — tRPC-Router, Stores, GitHub-Tools, Provider-Router, Elite-Mission
- `client/src/` — React-Seiten und Komponenten
- `drizzle/` — Schema und Migrationen (0000–0008)
- `docs/` — Deploy, APK, Testing, Roadmap, Sprintstatus
