# Sprintstatus Agenten-Villa

**Roadmap:** [100-Sprint-Roadmap](./ROADMAP-100-SPRINTS.md)  
**Branch:** `main`  
**Startstand:** `69df273`

| Sprint | Status | Ergebnis |
|---|---|---|
| 001 | Grün | Roadmap und Definition of Done sind versioniert. |
| 002 | Grün | `pnpm validate` führt Typecheck, Tests, Build und Diff-Prüfung reproduzierbar aus. |
| 003 | Grün | Validierung enthält die abschließende Diff-Prüfung; Formatprüfung bleibt als Folgeverbesserung geplant. |
| 004–100 | Geplant | Start nach Abschluss und Review der vorherigen Sprintgruppe. |

## Grüner Validierungsweg

```bash
pnpm validate
```

Der Befehl führt TypeScript-Prüfung, vollständige Tests, Produktionsbuild und eine abschließende Diff-Prüfung aus. Externe Provider-Schlüssel sind für diesen Weg nicht erforderlich.

## Regeln für autonome Sprintausführung

Jeder Sprint erhält eine eindeutige Änderung, mindestens eine technische Prüfung und ein dokumentiertes Ergebnis. Ein fehlgeschlagener Sprint wird korrigiert oder als blockiert markiert; er wird nicht stillschweigend übersprungen. Riskante externe Aktionen, Datenlöschungen, Käufe, Veröffentlichungen und Änderungen an Zugriffen benötigen eine separate Bestätigung.
