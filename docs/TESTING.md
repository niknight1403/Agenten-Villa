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

## Hermetische Tests: ENV-Snapshot & ambient gesetzte Provider-Keys

Regel: **Die Testsuite muss in jeder Shell-Umgebung grün sein — auch wenn dort
echte Provider-Keys (z. B. `OPENROUTER_API_KEY`) gesetzt sind.**

Hintergrund: `server/_core/env.ts` exportiert `ENV` als Import-Zeit-Snapshot
von `process.env`. Router-Tests, die einen "nichts konfiguriert"-Zustand
prüfen, liefen deshalb rot, sobald die Shell einen Key exportierte — der
angeleitete Key blieb im Snapshot hängen, obwohl der Test `process.env`
geleert hatte. Dasselbe galt für `provider-health.ts`-basierte
Rotation-Tests, die `process.env` LIVE lesen.

Konventionen:

- **`resetEnvForTests()`** (`server/_core/env.ts`): Nach jeder
  `process.env`-Umstellung in Tests aufrufen, wenn geprüft wird, wie der
  Router auf Keys reagiert (analogue zu `resetLLMProvidersForTests()`).
  Produktionscode ruft die Funktion nie.
- **Save/Clear/Restore**: Testdateien, die Router-Verhalten gegen
  ambient gesetzte Keys absichern (`EXTENSION-POINTS_PROVIDER_ENV`),
  sichern die relevanten Variablen in `beforeEach`, löschen sie und stellen
  sie in `afterEach` wieder her — siehe `server/llm-router.test.ts`,
  `server/route-rotator.test.ts` und `server/extension-points.test.ts`.
- Neue Router-Tests, die "kein Key konfiguriert" oder eine bestimmte
  Provider-Reihenfolge annehmen, folgen denselben zwei Regeln.
