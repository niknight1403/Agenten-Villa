#!/usr/bin/env bash
set -euo pipefail

adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n de.niknight1403.agentenvilla/.MainActivity
trap 'adb exec-out screencap -p > villa-smoke.png || true' EXIT

ready=0
for attempt in {1..9}; do
  sleep 10
  if ! adb shell pidof de.niknight1403.agentenvilla >/dev/null; then
    echo "App-Start läuft noch (${attempt}/9)."
    continue
  fi
  if adb shell uiautomator dump /data/local/tmp/villa-ui.xml >/dev/null 2>&1; then
    adb exec-out cat /data/local/tmp/villa-ui.xml > villa-ui.xml
    # The emulator launcher can raise its own ANR dialog over a healthy app.
    # Dismiss only that launcher dialog, then inspect the actual foreground UI.
    if grep -q 'Quickstep.*responding' villa-ui.xml; then
      adb shell input tap 350 1330
      continue
    fi
    if grep -Eq 'Willkommen zurück|Mit Google anmelden|Agenten Villa|Agenten-Villa|Erste Villa erstellen' villa-ui.xml; then
      ready=1
      break
    fi
  fi
  # Android WebView text is not always surfaced in UIAutomator. Confirm the
  # actual rendered screenshot with OCR instead of equating process start to UI.
  adb exec-out screencap -p > villa-smoke.png
  if command -v tesseract >/dev/null; then
    tesseract villa-smoke.png stdout -l deu+eng 2>/dev/null > villa-ocr.txt || true
    if grep -qi 'Quickstep.*responding' villa-ocr.txt; then
      adb shell input tap 350 1330
      continue
    fi
    if grep -Eqi 'Agenten.?Villa|Willkommen zurück|Erste Villa erstellen' villa-ocr.txt; then
      ready=1
      break
    fi
  fi
done

adb exec-out screencap -p > villa-smoke.png
test -s villa-smoke.png
if [ "$ready" -ne 1 ]; then
  echo 'App-Prozess gestartet, aber keine sichtbare App-Oberfläche erkannt.' >&2
  cat villa-ocr.txt >&2 2>/dev/null || true
  adb logcat -d -t 500 -v brief | grep -E 'AndroidRuntime|Capacitor|chromium|MainActivity' | tail -60 >&2 || true
  exit 1
fi
