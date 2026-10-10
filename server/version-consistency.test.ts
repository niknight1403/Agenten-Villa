/**
 * Drift-Schutz: App-Version darf nicht auseinanderlaufen.
 * shared/const.ts ist die Quelle der Login-Seiten-Anzeige; package.json und
 * android/app/build.gradle muessen dieselbe Version tragen, sonst installiert
 * der Nutzer scheinbar "immer noch die alte Version" (Passiert 10.10.2026:
 * v1.2.1 APK zeigte 1.2.0 weil const.ts nicht mitgezogen wurde).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");

describe("version consistency", () => {
  it("shared/const.ts, package.json und build.gradle tragen dieselbe Version", () => {
    const pkg = JSON.parse(read("package.json")) as { version: string };
    const constTs = read("shared/const.ts");
    const gradle = read("android/app/build.gradle");

    const constMatch = constTs.match(/APP_VERSION = "([^"]+)"/);
    const buildMatch = constTs.match(/APP_BUILD = (\d+)/);
    const gradleMatch = gradle.match(/versionName "([^"]+)"/);
    const gradleCode = gradle.match(/versionCode (\d+)/);

    expect(constMatch?.[1]).toBe(pkg.version);
    expect(gradleMatch?.[1]).toBe(pkg.version);
    expect(Number(buildMatch?.[1])).toBeGreaterThan(0);
    // versionCode > APP_BUILD-1 gewaehrleistet monoton steigende Builds
    expect(Number(gradleCode?.[1])).toBeGreaterThanOrEqual(Number(buildMatch?.[1]));
  });
});
