# Branch-Schutz und Merge-Anforderungen

Der Default-Branch ist `main`. Änderungen werden bevorzugt über Pull Requests eingebracht. Ein Pull Request gilt erst als bereit, wenn TypeScript-Prüfung, Tests und Produktionsbuild in der CI erfolgreich waren. Format- und Diff-Fehler müssen vor dem Merge behoben werden.

Direkte Änderungen an `main` sind nur für ausdrücklich beauftragte Wartungsarbeiten zulässig. Agentenwerkzeuge arbeiten, sofern sie für ein Repository aktiviert werden, ausschließlich auf `agent/*`-Branches und erstellen keine automatischen Merges. Änderungen an Secrets, Berechtigungen, Actions-Workflows oder Repository-Einstellungen benötigen eine separate Administratorentscheidung.

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
