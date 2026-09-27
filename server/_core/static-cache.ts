/**
 * Cache-Header fuer produktive Assets:
 * - /assets/* (Vite-Hash-Dateien): 1 Jahr immutable
 * - index.html: no-cache (App-Updates sofort sichtbar, SPA-Fallback ebenso)
 * - Manifest/Icons: 1 Tag
 * - alles andere: 5 Minuten
 */
export function cacheControlForFile(filePath: string): string {
  const normalized = filePath.split(/[\\/]/).join("/");
  if (normalized.includes("/assets/")) {
    return "public, max-age=31536000, immutable";
  }
  if (/(^|\/)index\.html$/.test(normalized)) {
    return "no-cache";
  }
  if (/\.(webmanifest|png|svg|ico|jpg|jpeg|webp)$/.test(normalized)) {
    return "public, max-age=86400";
  }
  return "public, max-age=300";
}
