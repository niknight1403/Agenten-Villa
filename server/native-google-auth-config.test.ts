import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regressionstest fuer den Android-Absturz beim Antippen von "Anmelden".
 *
 * GoogleAuth.java liest die Scopes mit `getConfig().getString("scopes")`.
 * Wird dort ein Array hinterlegt, wirft org.json eine JSONException, der
 * Default "" greift, und der Plugin-Code bildet daraus `scopeArray = [""]`.
 * Der anschliessende Aufruf `new Scope("")` wirft in Google Play Services
 * IllegalArgumentException; Capacitor reicht das als RuntimeException weiter
 * und der App-Prozess beendet sich. Die Scopes muessen daher als String
 * vorliegen — in der Capacitor-Konfiguration und im initialize()-Aufruf.
 */
const root = path.resolve(import.meta.dirname, "..");

function read(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf8");
}

describe("native Google-Anmeldung", () => {
  it("konfiguriert die Scopes als String, nicht als Array", () => {
    const config = read("capacitor.config.ts");
    const match = config.match(/scopes:\s*(\[[^\]]*\]|"[^"]*")/);

    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/^"/);
    expect(match![1]).not.toMatch(/^\[/);
  });

  it("uebergibt im initialize()-Aufruf einen nicht-leeren Scope-String", () => {
    const auth = read("client/src/pages/Auth.tsx");
    const match = auth.match(/const scopes = "([^"]*)" as unknown as string\[\]/);

    expect(match).not.toBeNull();
    expect(match![1].split(",").filter(Boolean).length).toBeGreaterThan(0);
  });

  it("behaelt die Konfiguration und den Aufruf synchron", () => {
    const config = read("capacitor.config.ts").match(/scopes:\s*"([^"]*)"/);
    const auth = read("client/src/pages/Auth.tsx").match(/const scopes = "([^"]*)"/);

    expect(config).not.toBeNull();
    expect(auth).not.toBeNull();
    expect(auth![1]).toBe(config![1]);
  });
});
