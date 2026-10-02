/**
 * Sprint 054 — Konsistenz-Schutz fuer den nativen Google-Sign-In.
 *
 * Der Server verifiziert das ID-Token gegen GOOGLE_CLIENT_ID (Web-Client).
 * Fordert die App den Token mit einer ANDEREN Client-ID an (z. B. der
 * Android-Client-ID), lehnt jwtVerify das Token mit einer Audience-Abweichung
 * ab — die Anmeldung scheitert mit 401. Dieser Test verhindert genau diese
 * Diskrepanz zwischen capacitor.config.ts und strings.xml.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Oeffentliche Produktions-Web-Client-ID (sichtbar im Login-Redirect, kein Secret). */
export const PRODUCTION_WEB_CLIENT_ID = "656137332727-vhip14vrtgmdc65rsbdlpqud4tss0v4q.apps.googleusercontent.com";

const repoRoot = join(__dirname, "..", "..");

describe("native Google client configuration", () => {
  it("capacitor.config.ts und strings.xml verwenden dieselbe Web-Client-ID", () => {
    const config = readFileSync(join(repoRoot, "capacitor.config.ts"), "utf8");
    const strings = readFileSync(
      join(repoRoot, "android", "app", "src", "main", "res", "values", "strings.xml"),
      "utf8"
    );
    const configMatch = config.match(/clientId:\s*"([^"]+)"/);
    const stringsMatch = strings.match(/server_client_id">([^<]+)</);
    expect(configMatch?.[1]).toBeTruthy();
    expect(stringsMatch?.[1]).toBeTruthy();
    // Beide Quellen muessen identisch sein und dem Web-Client entsprechen,
    // gegen den der Server das aud-Claim prueft (ENV.GOOGLE_CLIENT_ID).
    expect(configMatch?.[1]).toBe(stringsMatch?.[1]);
    expect(configMatch?.[1]).toBe(PRODUCTION_WEB_CLIENT_ID);
  });
});
