import { describe, expect, it } from "vitest";
import { cacheControlForFile } from "./_core/static-cache";

describe("static cache headers", () => {
  it("markiert gehashte Vite-Assets als 1 Jahr immutable", () => {
    expect(
      cacheControlForFile("/app/dist/public/assets/index-Ab12Cd34.js")
    ).toBe("public, max-age=31536000, immutable");
  });

  it("laesst index.html immer neu validieren", () => {
    expect(cacheControlForFile("/app/dist/public/index.html")).toBe("no-cache");
    expect(cacheControlForFile("dist\\public\\index.html")).toBe("no-cache");
  });

  it("cacht Manifest und Bilder einen Tag", () => {
    expect(cacheControlForFile("/app/public/manifest.webmanifest")).toBe(
      "public, max-age=86400"
    );
    expect(cacheControlForFile("/app/public/icons/icon-512.png")).toBe(
      "public, max-age=86400"
    );
  });

  it("cacht uebrige Dateien kurz (5 Minuten)", () => {
    expect(cacheControlForFile("/app/public/sitemap.xml")).toBe(
      "public, max-age=300"
    );
  });
});
