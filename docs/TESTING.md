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
