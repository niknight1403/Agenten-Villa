# Demoanfragen: Freigabekriterien

Der B2B-Demo-Slice umfasst `/demo`, `demo.submit`, die geschützte Verwaltung
`/core/demo-requests` sowie `demo_requests` und `demo_contact_opt_outs`
(Migration `drizzle/0002_lean_thunderball.sql`).
Eine Anfrage begründet weder einen automatischen Versand noch ein Leistungs-
oder Demo-Versprechen. `demo.list` und `demo.setStatus` setzen die gespeicherte
Administratorrolle voraus. Ein Kontaktwiderspruch sperrt die normalisierte
E-Mail-Adresse dauerhaft, setzt vorhandene Anfragen derselben Adresse auf
`opted_out` und verhindert neue kontaktierbare Leads, ohne das öffentliche
Formular über die Sperre zu informieren.

## Vor einer öffentlichen Veröffentlichung

- Die Betreiberangaben und eine passende Datenschutzerklärung mit realem
  Verantwortlichen, Kontaktadresse, Zwecken, Aufbewahrungsfrist, Empfängern
  und Betroffenenrechten fehlen. Die tatsächlichen Angaben des Betreibers
  müssen eingebunden und die Formulartexte dagegen geprüft werden.
- Migration auf der Ziel-Datenbank anwenden und reale Einreichung, Admin-Zugriff,
  Statuswechsel und Opt-out mit getrennten Testkonten prüfen. Dabei keine
  echten Interessentendaten als Testdaten verwenden.
- Betriebliches Verfahren für Kontaktwidersprüche und Löschung sowie
  Aufbewahrungsdauer festlegen. Die App speichert und sperrt Opt-out, bietet
  jedoch noch keinen automatischen Löschlauf und keine Selbstbedienungsfunktion.
- Öffentliche IP-Begrenzung ist pro Serverprozess; bei mehreren Replikaten
  oder hohem Bot-Aufkommen wird ein geteilter Schutz am Gateway benötigt.
