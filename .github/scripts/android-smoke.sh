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
    if adb exec-out cat /data/local/tmp/villa-ui.xml | grep -Eq 'Willkommen zurück|Mit Google anmelden|Agenten Villa|Agenten-Villa'; then
      ready=1
      break
    fi
  fi
done

adb exec-out screencap -p > villa-smoke.png
test -s villa-smoke.png
if [ "$ready" -ne 1 ]; then
  echo 'App-Prozess gestartet, aber keine sichtbare App-Oberfläche erkannt.' >&2
  adb logcat -d -t 500 -v brief | grep -E 'AndroidRuntime|Capacitor|chromium|MainActivity' | tail -60 >&2 || true
  exit 1
fi
