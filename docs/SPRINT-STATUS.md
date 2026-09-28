# Sprintstatus Agenten-Villa

**Roadmap:** [100-Sprint-Roadmap](./ROADMAP-100-SPRINTS.md)  
**Branch:** `main`  
**Startstand:** `69df273`

| Sprint  | Status       | Ergebnis                                                                                                |
| ------- | ------------ | ------------------------------------------------------------------------------------------------------- |
| 001     | Grün         | Roadmap und Definition of Done sind versioniert.                                                        |
| 002     | Grün         | `pnpm validate` führt Typecheck, Tests, Build und Diff-Prüfung reproduzierbar aus.                      |
| 003     | Grün         | Validierung enthält die abschließende Diff-Prüfung; Formatprüfung bleibt als Folgeverbesserung geplant. |
| 004     | Grün         | Standardformat und erster Validierungsbericht liegen unter `docs/validation/`.                          |
| 005 | Grün | Node 22, pnpm 10.4.1 und die unterstützte Workspace-Konfiguration sind synchronisiert. |
| 006 | Grün | Branch-Schutz, Pflichtprüfungen und Rollback-Regeln sind dokumentiert. |
| 007 | Grün | Mock-, Live- und Secret-Testpfade sind getrennt und dokumentiert. |
| 008 | Grün | Agentenfehler besitzen zentrale Codes, Kategorien und sichere öffentliche Meldungen. |
| 009 | Grün | Deterministische lokale Villa- und Agenten-Fixtures samt Reset-Test sind vorhanden. |
| 010 | Grün | Gesamt-Review, 62 bestandene Tests, Build und Diff-Prüfung sind dokumentiert. |
| 011 | Grün | Zentraler Ownership-Guard im Villa-Store; jeder Lese- und Schreibpfad läuft über die Nutzer-ID des Aufrufers, Cross-User-Zugriffe liefern keine fremden Daten (13 Router-Tests grün). |
| 012 | Grün | Villa-Erstellung validiert Name, Projekt (Brief), Beschreibung (max. 1000) und Kapazität (1–25, Standard 8) zentral per Schema; Migration 0002 und Client-Modal erweitert (114 Tests grün). |
| 013 | Grün | Villa-Bearbeitung umfasst Name, Spezialisierung, Beschreibung und Kapazität; jede Änderung schreibt transaktional einen Audit-Eintrag (villa_events), abfragbar über villa.events (Migration 0003). |
| 014 | Grün | Archivierte Villen (archivedAt + Audit-Eintrag) akzeptieren keine neuen Nachrichten (FORBIDDEN) und starten keine Elite-Missionen; Client zeigt Archiv-Badge, Umschalten und sperrt die Chat-Eingabe. |
| 015 | Grün | Projekte (Tabelle projects) sind pro Nutzer verwaltet; ein Projekt lässt sich einer oder mehreren eigenen Villen zuordnen (villa.projectId, Migration 0004), Ownership beider Seiten wird transaktional geprüft. |
| 016–100 | Geplant | Fortsetzung nach Sprint 015. |

## Grüner Validierungsweg

```bash
pnpm validate
```

Der Befehl führt TypeScript-Prüfung, vollständige Tests, Produktionsbuild und eine abschließende Diff-Prüfung aus. Externe Provider-Schlüssel sind für diesen Weg nicht erforderlich.

## Regeln für autonome Sprintausführung

Jeder Sprint erhält eine eindeutige Änderung, mindestens eine technische Prüfung und ein dokumentiertes Ergebnis. Ein fehlgeschlagener Sprint wird korrigiert oder als blockiert markiert; er wird nicht stillschweigend übersprungen. Riskante externe Aktionen, Datenlöschungen, Käufe, Veröffentlichungen und Änderungen an Zugriffen benötigen eine separate Bestätigung.
