# Android-APK erstellen und signieren

## Automatisch (GitHub Actions)

Jeder Push auf `main` baut zwei APKs als Workflow-Artifacts:

| Artifact | Inhalt | Zweck |
|---|---|---|
| `agenten-villa-release-apk` | signierte `app-release.apk` | Installation, Weitergabe |
| `agenten-villa-debug-apk` | `app-debug.apk` | Debug-Zwecke |

Die Release-APK wird mit dem Signaturschlüssel aus den GitHub-Secrets signiert:

- `ANDROID_KEYSTORE_BASE64` – Keystore (PKCS12), Base64
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS` (`agenten-villa`)
- `ANDROID_KEY_PASSWORD`

Fehlen die Secrets, bleibt der Build grün und die Release-APK ist unsigniert.

## Signaturschlüssel sichern (wichtig)

Der Keystore liegt ausschließlich verschlüsselt in den GitHub-Secrets – niemals im
Repository. Für ein Backup:

1. **GitHub → Actions → „Generate signing keystore" → Run workflow** (erzeugt einen NEUEN Schlüssel) oder
2. Den vorhandenen Schlüssel einmalig aus dem Artifact `agenten-villa-signing-keystore` herunterladen und sicher verwahren.

> Verlierst du den Schlüssel, kann die App nicht mehr als Update derselben Signatur
> installiert werden (Deinstallation nötig). Da die App nicht im Play Store liegt,
> kann ersatzweise ein neuer Schlüssel generiert werden.

## Manuell bauen

```bash
pnpm install
VITE_API_URL=https://agenten-villa.onrender.com pnpm exec vite build
pnpm exec cap sync android
cd android && ./gradlew assembleRelease
```

Für eine signierte lokale Release-APK die vier Umgebungsvariablen von oben setzen
und zusätzlich `ANDROID_KEYSTORE_FILE` auf den Keystore-Pfad zeigen lassen.

## Google-Anmeldung (nativer Sign-In) einrichten

Der native Sign-In läuft über `@codetrix-studio/capacitor-google-auth`. Damit er
funktioniert, müssen im **selben Google-Cloud-Projekt** zwei OAuth-Clients existieren:

1. **Web-Client** – dessen ID steht in `capacitor.config.ts` unter
   `plugins.GoogleAuth.clientId` und in der Server-Umgebung als `GOOGLE_CLIENT_ID`.
   Der Server prüft das `aud`-Claim des ID-Tokens gegen diesen Wert.
2. **Android-Client** – mit dem Paketnamen `de.niknight1403.agentenvilla` und dem
   SHA-1-Fingerprint des **signierenden** Keystores.

Fehlt der Android-Client oder passt der Fingerprint nicht, liefert Google
`ApiException` mit Code 10 (`DEVELOPER_ERROR`). Die App zeigt dafür einen eigenen
Hinweis statt einer generischen Fehlermeldung.

### Fingerprints der Keystores

| Keystore | SHA-1 | SHA-256 |
|---|---|---|
| Lokaler Release-Keystore (Berlin) | `c51dacfc5712138a2eee8476d25df6d6319f7bdf` | `26b1346f7847ff7bc5e2906c6f3f3cdd8ec5447d81b45ccf4917754bdbd0ce85` |
| CI-Keystore (Frankfurt, GitHub-Secrets) | `B7:60:BF:24:1E:50:A8:04:FF:68:25:5A:52:C9:97:20:CA:17:AE:65` | `5A:5E:9D:B1:DC:19:F7:B9:C0:93:7A:77:2C:16:09:2C:FD:EB:52:C5:D5:EA:C9:27:7F:79:61:99:1D:8E:87:87` |

Den SHA-1 des jeweils verteilten APKs prüfen mit:

```bash
$ANDROID_HOME/build-tools/<version>/apksigner verify --print-certs app-release.apk
```

Der CI-Workflow gibt die Fingerprints beim Build zusätzlich im Log aus.

### Scopes müssen ein String sein

`GoogleAuth.java` liest die Scopes mit `getConfig().getString("scopes")`, obwohl der
TypeScript-Typ `string[]` deklariert. Wird dort ein Array hinterlegt, wirft `org.json`
eine `JSONException`, der Default `""` greift, und das Plugin bildet daraus
`scopeArray = [""]`. Der Aufruf `new Scope("")` wirft in Google Play Services
`IllegalArgumentException`, was Capacitor als `RuntimeException` weiterreicht und den
App-Prozess beendet — die App stürzt beim Antippen von „Anmelden" ab.

Deshalb in `capacitor.config.ts` **und** im `initialize()`-Aufruf:

```ts
scopes: "profile,email"
```

`server/native-google-auth-config.test.ts` verhindert einen Rückfall auf Array-Scopes.
