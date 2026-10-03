# Branch-Schutz und Merge-Anforderungen

Der Default-Branch ist `main`. Änderungen werden bevorzugt über Pull Requests eingebracht. Ein Pull Request gilt erst als bereit, wenn TypeScript-Prüfung, Tests und Produktionsbuild in der CI erfolgreich waren. Format- und Diff-Fehler müssen vor dem Merge behoben werden.

Direkte Änderungen an `main` sind nur für ausdrücklich beauftragte Wartungsarbeiten zulässig. Agentenwerkzeuge arbeiten, sofern sie für ein Repository aktiviert werden, ausschließlich auf `agent/*`-Branches und erstellen keine automatischen Merges. Änderungen an Secrets, Berechtigungen, Actions-Workflows oder Repository-Einstellungen benötigen eine separate Administratorentscheidung.

### Dokumentierte Ausnahme: Auto-Merge für agent/*-PRs (Beschluss vom 03.10.2026)

Der Owner hat am 03.10.2026 beschlossen, dass der Workflow `Auto-Merge (agent/*)` offene Pull Requests aus `agent/*`-Branches nach `main` automatisch per Squash-Merge erledigt, sobald alle Pflichtchecks (`CI`, `PR Agent (Gemini)`, `Android mobile smoke`) erfolgreich abgeschlossen sind. Die Entscheidungslogik lebt im getesteten Modul `server/auto-merge-gate.ts` und wird vom Workflow immer vom Default-Branch geladen — ein Pull Request kann seine eigene Freigabe nicht verändern.

Nicht automatisch gemerged werden (Admin-Disziplin bleibt verbindlich): Drafts, PRs auf andere Ziel-Branches, PRs aus Forks sowie PRs, die `.github/`, die Datei `server/auto-merge-gate.ts` selbst oder dieses Dokument ändern. Der Branch wird nach dem Merge gelöscht.

Ergänzung (Sprint 081, 03.10.2026): Ein Pflichtcheck, dessen Workflow wegen seines `paths:`-Filters bei den geänderten Dateien eines PRs gar nicht hätte triggern können (z. B. `Android mobile smoke` bei reinen Server-Änderungen), gilt als erfüllt. Hätte der Workflow laut Filter laufen müssen, bleibt das Fehlen des Checks blockierend — es wird nie simuliert, sondern nur korrekt eingeordnet.

Bei einem fehlgeschlagenen Check wird die Änderung korrigiert oder der Pull Request als blockiert markiert. Ein grüner Check darf nicht durch das Überspringen regulärer Tests simuliert werden. Credential-Livetests bleiben opt-in und sind kein Ersatz für deterministische Mock-Tests.

## Pflichtprüfungen

| Prüfung            | Zweck                         |
| ------------------ | ----------------------------- |
| `pnpm check`       | TypeScript ohne Emit          |
| `pnpm test`        | Unit- und Regressionstests    |
| `pnpm build`       | Produktionsartefakt           |
| `git diff --check` | Whitespace- und Patch-Hygiene |

## Rollback

Vor riskanten Änderungen wird ein Commit oder Checkpoint festgehalten. Ein Rollback wird durch Wiederherstellung eines bekannten Commit- oder Checkpoint-Stands durchgeführt. Datenbankmigrationen werden nicht rückwärts ausgeführt, solange kein getesteter Rückwärtsweg vorhanden ist.
