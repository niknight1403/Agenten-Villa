# Deployment – kostenloser Server (Schritt für Schritt)

Diese Anleitung bringt Agenten Villa **kostenlos** ans Netz: ein Docker-Web-Service (Client + Express-API gemeinsam) plus kostenlose MySQL-Datenbank. Der gesamte Client-Build wird vom Service mit ausgeliefert, es gibt nur **einen** Service.

## Überblick

| Baustein | Kostenloser Anbieter | Konto nötig |
| --- | --- | --- |
| Web-Service (Docker) | [Render](https://render.com) Free Plan | ja (GitHub-Login) |
| MySQL-Datenbank | [Aiven Free](https://aiven.io) oder [TiDB Serverless](https://tidbcloud.com) | ja |
| LLM-Modellroute | [OpenRouter](https://openrouter.ai/keys) (Free-Modelle) | ja |

> Hinweis: Render Free-Services gehen nach ~15 Min. Inaktivität schlafen und brauchen beim ersten Aufruf ~30–60 Sek. Aufwachzeit.

## 1. MySQL-Datenbank anlegen

**Aiven Free:** Projekt anlegen → Service `MySQL` (Free Plan) → nach dem Start die `Service URI` kopieren (Format: `mysql://user:pass@host:port/defaultdb?ssl-mode=REQUIRED`).

**Alternativ TiDB Serverless (Free):** Cluster anlegen → Connection String (Format: `mysql://user:pass@host:4000/test?ssl-mode=VERIFY_IDENTITY`).

Die URI später als `DATABASE_URL` eintragen.

## 2. Schema in die Datenbank pushen (einmalig, lokal)

```bash
pnpm install
DATABASE_URL="mysql://...deine-uri..." pnpm db:push
```

## 3. Web-Service auf Render deployen

1. Auf [render.com](https://render.com) mit GitHub anmelden.
2. **New → Blueprint** wählen → Repository `niknight1403/Agenten-Villa` verbinden → Render erkennt die `render.yaml` → **Apply**.
3. Beim ersten Deploy nach den drei Werten fragen (Sync-Dialog):
   - `DATABASE_URL` = MySQL-URI aus Schritt 1
   - `AGENT_ADMIN_EMAIL` = deine Administrator-E-Mail (Allowlist-Admin, vom Stundenlimit befreit)
   - `OPENROUTER_API_KEY` = Key von <https://openrouter.ai/keys> (kostenlose Modelle)
   - `JWT_SECRET` wird automatisch generiert.
4. Nach dem Deploy ist die App unter `https://agenten-villa.onrender.com` erreichbar.

## 4. Google-Anmeldung einrichten (Account-System)

Das Account-System basiert auf Google OAuth 2.0 (kein separates Passwort-System, "Mit Google anmelden" ist die einzige Anmeldeart):

1. In der [Google Cloud Console](https://console.cloud.google.com/apis/credentials) ein OAuth-Client (Typ **Web-Anwendung**) anlegen.
2. **Autorisierte Redirect-URI**: `https://<deine-render-url>/api/auth/google/callback`
   - Der Service heißt in `render.yaml` `agenten-villa`, d.h. Render vergibt standardmäßig **`https://agenten-villa.onrender.com`** → Redirect-URI dann exakt: `https://agenten-villa.onrender.com/api/auth/google/callback`
   - Tipp: zusätzlich `http://localhost:3000/api/auth/google/callback` als zweite Redirect-URI hinterlegen (Google erlaubt mehrere), dann funktioniert die Anmeldung auch beim lokalen Test-Server (`pnpm dev`).
   - (Name vergeben? Render hängt dann `-1`, `-2` … an die URL. Falls das passiert: einfach die angezeigte Render-URL in der Google-Konsole ergänzen.)
3. `GOOGLE_CLIENT_ID` und `GOOGLE_CLIENT_SECRET` bei Render als Umgebungsvariablen hinterlegen (werden beim Blueprint-Deploy abgefragt, `sync: false`).
4. Fertig — der Button „Mit Google anmelden" auf `/login` funktioniert direkt.

## 5. Administratorkonto

Nach dem ersten Login im Web-UI: die E-Mail aus `AGENT_ADMIN_EMAIL` erhält automatisch die Admin-Rolle (`admin`) – Stundenlimit entfällt, voller Zugriff auf Werkstatt und geschützte GitHub-Funktionen. Zugangsdaten gehören **niemals** in Code, Chats oder die APK.

## 6. APK bauen (GitHub Actions)

Im Repo: **Actions → Build Android APK → Run workflow**. Optional das Feld `server_url` mit der Render-URL aus Schritt 3 füllen (z. B. `https://agenten-villa.onrender.com`), damit die App direkt das Backend anspricht.

Nach ~15 Min. liegt unter dem Run das **Artifact `agenten-villa-debug-apk`** – die APK aufs Handy herunterladen und installieren („Unbekannte Quellen" erlauben). Ohne `server_url` gestartet die App, findet aber noch kein Backend.

Die Debug-APK ist für Tests gedacht. Für Play Store / Verteilung: Release-APK mit eigenem Keystore signieren (folgt auf Anfrage).

## API-URL (Web-App)

Die Web-App ruft das Backend über die feste Produktions-URL `https://agenten-villa.onrender.com` auf – gepinnt im `Dockerfile` zur Build-Zeit (`ARG VITE_API_URL`, Überschreibbar mit `--build-arg`). Die APK-Builds im GitHub-Workflow defaulten ebenfalls auf diese URL. Lokale Entwicklung bleibt unberührt (relative URL via `pnpm dev`).

## Umgebungsvariablen (Server)

| Variable | Zweck | Pflicht |
| --- | --- | --- |
| `DATABASE_URL` | MySQL-Verbindung | ja |
| `JWT_SECRET` | Signatur der Sitzungen | ja (auto-generiert) |
| `AGENT_ADMIN_EMAIL` | Allowlist-Administrator | empfohlen |
| `OPENROUTER_API_KEY` | Kostenlose Modellroute | ja für Agenten |
| `OPENROUTER_MODELS` | Freie Modellkette (Default: `openrouter/free`) | nein |
| `FREE_TIER_CACHE` | Antwort-Cache: Produktion default an | nein |
| `FREE_TIER_CACHE_TTL_SECONDS` | Cache-TTL (Default 600) | nein |
| `PORT` | von Render gesetzt | nein |

## Client (Web)

| Variable | Zweck |
| --- | --- |
| `VITE_API_URL` | Nur für Mobile-Builds (APK): absolute Server-URL, z. B. `https://agenten-villa.onrender.com`. Web-Standard: leer = relative `/api/trpc` |
| `VITE_ANALYTICS_ENDPOINT` / `VITE_ANALYTICS_WEBSITE_ID` | optionales Umami-Tracking |

## KI-Code-Review (PR-Agent)

Jeder neue Pull Request wird automatisch vom PR-Agenten (Gemini) reviewed:
`/describe`, `/review` und `/improve` laufen automatisch, im PR sind
interaktive Kommentare moeglich (`/ask "..."`, `/review`, `/improve`).
Kein externes Konto noetig — der Gemini-Key liegt als Repo-Secret.
