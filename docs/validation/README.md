# Validierungsartefakte

Jeder vollständige Qualitätslauf wird mit Datum, Commit, Befehlen, Ergebnissen und bekannten Einschränkungen dokumentiert. Ein grüner Lauf bedeutet, dass TypeScript-Prüfung, Tests, Produktionsbuild und Diff-Prüfung erfolgreich waren. Übersprungene Credential-Livetests werden separat aufgeführt und gelten nicht als Fehler, solange sie ausdrücklich opt-in sind.

## Pflichtfelder

- **Commit:** geprüfter Git-Commit.
- **Befehle:** exakt ausgeführte Validierungsbefehle.
- **TypeScript:** Ergebnis von `pnpm check`.
- **Tests:** bestandene, übersprungene und fehlgeschlagene Tests.
- **Build:** Ergebnis von `pnpm build`.
- **Diff:** Ergebnis von `git diff --check`.
- **Warnungen:** nicht blockierende Warnungen mit geplanter Behandlung.
- **Einschränkungen:** bewusste Grenzen, etwa fehlende externe Provider-Schlüssel.

Ein Bericht darf keine Provider-Schlüssel, Sessiondaten oder personenbezogenen Inhalte enthalten.
