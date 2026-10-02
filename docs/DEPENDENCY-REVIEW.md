# Dependency-Review (Sprint 059)

Stand: 02.10.2026 — Pfad: `main`

## Zusammenfassung

| Prüfung | Ergebnis |
|---|---|
| `pnpm audit --prod` | keine bekannten Schwachstellen |
| `pnpm audit` (inkl. Dev) | keine bekannten Schwachstellen |
| Dependabot (npm) | aktiviert, wöchentlich (Montags), Minor/Patch gruppiert |
| Dependabot (GitHub Actions) | aktiviert, wöchentlich (Montags) |

## Automatisierung

- **CI (`ci.yml`)**: Nach Tests und Build läuft `pnpm audit --prod
  --audit-level high`. Bekannte High-/Critical-Schwachstellen in
  Produktionsabhängigkeiten lassen den Build rot werden — der Review ist
  damit nicht nur einmalig dokumentiert, sondern dauerhaft durchgesetzt.
- **Dependabot (`.github/dependabot.yml`)**:
  - `npm`: Minor-/Patch-Updates werden pro Woche als eine gruppierte PR
    vorgeschlagen; Major-Updates bleiben als Einzelmeldungen sichtbar und
    erfordern bewussten Review (die `cookie`-v2-Runtime-Panne von Sept. 2026
    kam aus einem unbegleiteten Major-Sprung — dieses Ignore ist die Lehre
    daraus).
  - `github-actions`: Aktualisierung der Action-Versionen (checkout, node,
    pnpm) wöchentlich, Minor/Patch gruppiert.

## Prozess

1. Dependabot eröffnet PRs → CI prüft (check, test, build, audit).
2. Minor/Patch: nach grünem CI mergen; Major: zusätzlich Changelog/Release
   Notes prüfen und einmalig lokal rauchtesten (`pnpm validate` + Start).
3. Ergebnis jedes Reviews wird in dieser Datei nachgetragen (Datum, PR,
   Ergebnis).

## Review-Log

| Datum | Anlass | Ergebnis |
|---|---|---|
| 2026-09-27 | Cookie-v2-Kompatibilitätspatch (`parse`→`parseCookie`) | behoben, Produktion verifiziert (Smoketest `/api/health`) |
| 2026-10-02 | Sprint 059 Erstreview (`pnpm audit` prod+dev) | keine bekannten Schwachstellen |
