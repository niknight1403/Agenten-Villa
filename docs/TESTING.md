# Teststrategie und Secret-Trennung

Die Standardtestsuite ist deterministisch und benötigt keine Provider-Schlüssel. Sie wird mit `pnpm test` ausgeführt. Tests, die echte Provider- oder GitHub-Endpunkte ansprechen, sind als Live-Tests gekennzeichnet und werden nur durch eine explizite Umgebungsvariable aktiviert.

| Testtyp                   | Standardlauf | Schlüssel erforderlich | Zweck                                                                      |
| ------------------------- | ------------ | ---------------------- | -------------------------------------------------------------------------- |
| Unit- und Regressionstest | Ja           | Nein                   | Validiert Eingaben, Router, Villa-Logik und Fehlerpfade.                   |
| Provider-Livetest         | Nein         | Ja                     | Prüft nur auf ausdrückliche Anforderung die Konfiguration eines Providers. |
| GitHub-Livetest           | Nein         | Ja                     | Prüft nur auf ausdrückliche Anforderung einen geschützten GitHub-Endpunkt. |

Live-Testschalter werden nicht in `.env.example` mit echten Werten hinterlegt. Testausgaben dürfen keine vollständigen Schlüssel oder Authorization-Header enthalten. Ein fehlender Schlüssel führt im Live-Test zu einem klaren Fehlschlag oder zu einem übersprungenen Test, nicht zu einem Fallback auf einen anderen geheimen Kontext.

Der lokale Qualitätsweg verwendet ausschließlich Mocks und sichere Testdaten:

```bash
pnpm validate
```

Damit bleibt die reguläre CI reproduzierbar und unabhängig von Kontingenten, Netzwerkverfügbarkeit und privaten Providerkonten.

> Hinweis: `pnpm test` läuft sauber nur mit **sauberer Env** (z. B. `env -i PATH=… pnpm test`). Setzt die Umgebung
> echte Provider-Schlüssel, reagierende `GITHUB_REPOSITORY` oder andere Container-Env-Werte, schlagen
> provider-/repo-sensitiven Tests fälschlich fehl, weil sie gegen echte Konfiguration laufen statt Mocks.
> Live-Tests bleiben separat hinter `RUN_LIVE_*` geschaltet.

## Lokale End-to-End-Prüfung der Chat-Pipeline (ohne externen Anbieter)

Für einen echten Laufzeittest ohne Provider-Kosten (Details auch in `AGENTS.md`):

1. Postgres bereitstellen und `DATABASE_URL` setzen (lokal z. B. `postgres://villa:villa@127.0.0.1:5433/villa`),
   Schema per `pnpm db:push` anlegen, Projekt-Villa per `pnpm seed:villa -- --user <id>` erzeugen.
2. `OPENROUTER_BASE_URL=http://127.0.0.1:<port>/v1` auf einen lokalen Mock zeigen — der Endpunkt wird zu
   `<base>/chat/completions` (siehe `server/provider-endpoints.ts`, einzige URL-Quelle).
3. Server mit `JWT_SECRET` starten und ein signiertes Session-Cookie (`app_session_id`, HS256 mit
   `{openId, appId, name}`) setzen; der Benutzer wird per `openId` aus der DB aufgelöst.

Die reale Modellroute bleibt unverändert die Anbieter-Kette in `server/agent-engine.ts`
(`callWithProviderChain`, OpenRouter → Groq → Gemini; Hugging Face nur mit Einwilligung). Der Mock
spielt nur die OpenRouter-Route nach; es gibt keine neue Auswahl, keinen zweiten Endpunkt und keinen
Cloud-Ersatzweg. Eine Umstellung auf eine lokale Einzelroute erfordert ein eigenes, separat
freigegebenes Arbeitspaket.

## Build-Reproduzierbarkeit

Zur Sicherstellung deterministischer und reproduzierbarer Produktions-Builds wird nach `pnpm build` mit `pnpm build:manifest` ein SHA-256-Manifest über das Ausgabeverzeichnis `dist/` erstellt (`scripts/build-manifest.ts`).

### Vorgehen zur Verifikation

Der Repro-Nachweis erfolgt durch zwei aufeinanderfolgende Build-Läufe:

```bash
pnpm build && pnpm build:manifest
cp dist/build-manifest.json /tmp/manifest-run1.json

pnpm build && pnpm build:manifest
cp dist/build-manifest.json /tmp/manifest-run2.json

diff -u /tmp/manifest-run1.json /tmp/manifest-run2.json
```

### Ergebnis

Beide aufeinanderfolgenden Builds erzeugen identische Artefakt-Strukturen und identische Aggregat-Hashes:

- **Anzahl Artefakte**: 11 Dateien (Web-Payload in `dist/public/` sowie Server-Bundle `dist/index.js`)
- **Gesamtgröße**: 1.692.020 Bytes
- **Aggregat-Hash**: `2cd39f7a186c679a1cd01c4a165430b778ea5891616bb3c94073e7e4185752f5`
- **Vergleich**: 100 % identische SHA-256-Hashes über alle Einzeldateien in beiden Läufen.

### Dokumentierte Abweichung & Anpassung

Bei der anfänglichen Ausführung wurde identifiziert, dass ein vorherig erzeugtes `dist/build-manifest.json` beim Folgerun im `dist/`-Verzeichnis verblieb und durch den Zeitstempel (`generatedAt`) im Manifest selbst zu einem geänderten Aggregat-Hash führte.

**Anpassung/Fix**: `scripts/build-manifest.ts` (und die Testsuite in `tests/build-manifest.test.ts`) ignoriert `build-manifest.json` beim Erfassen der Artefakte explizit (`collectFiles`). Dadurch fließen nur die echten Build-Erzeugnisse (JS, CSS, HTML, Assets) in die Hash-Berechnung ein und die Reproduzierbarkeit ist zu 100 % gewährleistet.
