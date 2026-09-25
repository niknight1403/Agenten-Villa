# Sicherheitsrichtlinie

## Gemeldete Schwachstellen

Bitte melde Sicherheitslücken **nicht** als öffentliches GitHub-Issue, sondern
direkt und diskret über die GitHub-Funktion „Report a vulnerability"
(Repository → Security → Report a vulnerability).

## Umgang mit Abhängigkeiten

- Sicherheitsrelevante Updates werden bevorzugt auf `main` behandelt.
- Dependabot-Alerts werden aktiv bearbeitet; transitive Fixes laufen über
  pnpm-Overrides (`package.json` → `pnpm.overrides`).
- Inkompatible Major-Updates werden bewusst zurückgehalten, bis Kompatibilität
  geprüft ist (siehe `docs/DEPLOY.md`).

## Sicherheitsgrenzen der Anwendung

- Keine Umgehung von Provider-Kontingenten oder Modelllimits
- Keine Geheimnisse im Repository oder im Client-Bundle
- Signaturschlüssel ausschließlich in GitHub-Secrets (nie committet)
- Auth-Endpunkte sind rate-limitiert; Sessions sind Eigentümer-geprüft
