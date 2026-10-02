import { useEffect, useState } from "react";

/**
 * Sprint 064 — Offline-Chatcache.
 *
 * Der Chatverlauf wird aus der React-Query-Cache gespeist. Bei
 * Verbindungsabbruch soll der Verlauf lesbar bleiben und der Nutzer
 * erkennen, dass aktuell keine Verbindung besteht — statt eines leeren
 * oder "kaputten" Chats.
 */

/** Reine Entscheidungslogik für das Offline-Banner (getestet). */
export function offlineBannerMessage(
  online: boolean,
  hasMessages: boolean
): string | null {
  if (online || !hasMessages) return null;
  return "Keine Verbindung — dein Verlauf bleibt lesbar.";
}

/** true, solange der Browser eine Netzverbindung meldet (SSR-sicher). */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine
  );

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return online;
}
