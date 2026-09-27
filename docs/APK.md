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
