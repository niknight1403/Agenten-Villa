/**
 * Sprint 064 — Regression: Offline-Chatcache.
 *
 * Invarianten:
 *  - Offline ohne Verlauf: kein Banner (nichts zu lesen, nichts zu melden).
 *  - Offline mit Verlauf: Banner versichert, dass der Chat lesbar bleibt.
 *  - Online: nie ein Offline-Banner, egal wie viel Verlauf existiert.
 */
import { describe, expect, it } from "vitest";
import { offlineBannerMessage } from "./useOnlineStatus";

describe("offlineBannerMessage", () => {
  it("zeigt offline mit Verlauf den Hinweis", () => {
    expect(offlineBannerMessage(false, true)).toBe(
      "Keine Verbindung — dein Verlauf bleibt lesbar."
    );
  });

  it("zeigt offline ohne Verlauf kein Banner", () => {
    expect(offlineBannerMessage(false, false)).toBeNull();
  });

  it("zeigt online nie ein Banner", () => {
    expect(offlineBannerMessage(true, true)).toBeNull();
    expect(offlineBannerMessage(true, false)).toBeNull();
  });
});
