export type StorageEntry = {
  id: string;
  name: string;
  size: number;
  modified: number;
  mime: string;
  directory: boolean;
};

export type Category = "Bilder" | "Videos" | "Audio" | "Dokumente" | "Archive" | "Andere";
export type FileAction = { id: string; name: string; size: number; operation: "move" | "delete"; category?: Category };
export type FilePlan = { title: string; explanation: string; actions: FileAction[]; potentialBytes: number };

export function categoryOf(file: StorageEntry): Category {
  const mime = file.mime.toLowerCase();
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (mime.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp", "heic"].includes(ext)) return "Bilder";
  if (mime.startsWith("video/") || ["mp4", "mov", "mkv", "webm"].includes(ext)) return "Videos";
  if (mime.startsWith("audio/") || ["mp3", "wav", "m4a", "flac", "ogg"].includes(ext)) return "Audio";
  if (["zip", "7z", "rar", "tar", "gz"].includes(ext)) return "Archive";
  if (["pdf", "doc", "docx", "txt", "xls", "xlsx", "ppt", "pptx", "csv"].includes(ext) || mime.startsWith("text/")) return "Dokumente";
  return "Andere";
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const unit = Math.min(3, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** unit).toLocaleString("de-DE", { maximumFractionDigits: 1 })} ${["B", "KB", "MB", "GB"][unit]}`;
}

/** Local rules only: never send filenames to a remote model or infer broad destructive intent. */
export function planFromPrompt(prompt: string, entries: StorageEntry[]): FilePlan | null {
  const normalized = prompt.trim().toLowerCase();
  const files = entries.filter(entry => !entry.directory);
  if (/\b(sortier|ordne|organisier)/.test(normalized)) {
    const match = normalized.match(/\b(bilder|fotos|videos|audio|musik|dokumente|archive)\b/);
    const wanted: Category | null = match ? ({ bilder: "Bilder", fotos: "Bilder", videos: "Videos", audio: "Audio", musik: "Audio", dokumente: "Dokumente", archive: "Archive" } as Record<string, Category>)[match[1]] : null;
    const actions = files.filter(file => !wanted || categoryOf(file) === wanted)
      .map(file => ({ id: file.id, name: file.name, size: file.size, operation: "move" as const, category: categoryOf(file) }));
    return { title: "Dateien nach Typ sortieren", explanation: "Dateien werden innerhalb des gewählten Ordners in neue Typ-Ordner verschoben. Freier Speicherplatz ändert sich dabei nicht.", actions, potentialBytes: 0 };
  }
  if (/\b(lösch|entfern)/.test(normalized)) {
    // Sprint 053 — Alters-Filter: "lösche Dateien älter als 6 Monate".
    const ageMatch = normalized.match(/(?:älter|aelter)\s*(?:als\s*)?(\d+)\s*(tag|tage|woche[n]?|monat[e]?|jahr[e]?)\b/);
    if (ageMatch) {
      const unitDays = { tag: 1, tage: 1, woche: 7, wochen: 7, monat: 30, monate: 30, jahr: 365, jahre: 365 }[ageMatch[2].replace(/n$/, "").replace(/^tage$/, "tage") as never] ?? 1;
      const days = Number(ageMatch[1]) * unitDays;
      if (!Number.isFinite(days) || days <= 0) return null;
      const cutoff = Date.now() - days * 86_400_000;
      const actions = files.filter(file => file.modified < cutoff)
        .map(file => ({ id: file.id, name: file.name, size: file.size, operation: "delete" as const }));
      return { title: `Dateien älter als ${ageMatch[1]} ${ageMatch[2]} löschen`, explanation: "Die ausgewählten Dateien wären endgültig gelöscht. Prüfe jede Datei vor der Bestätigung.", actions, potentialBytes: actions.reduce((sum, file) => sum + file.size, 0) };
    }
    // Sprint 053 — Kategorie-Filter: "lösche alle Videos".
    const categoryMatch = normalized.match(/\balle\s+(bilder|fotos|videos|audio|musik|dokumente|archive)\b/);
    if (categoryMatch) {
      const wanted: Category = ({ bilder: "Bilder", fotos: "Bilder", videos: "Videos", audio: "Audio", musik: "Audio", dokumente: "Dokumente", archive: "Archive" } as Record<string, Category>)[categoryMatch[1]];
      const actions = files.filter(file => categoryOf(file) === wanted)
        .map(file => ({ id: file.id, name: file.name, size: file.size, operation: "delete" as const }));
      return { title: `Alle ${wanted} löschen`, explanation: "Die ausgewählten Dateien wären endgültig gelöscht. Prüfe jede Datei vor der Bestätigung.", actions, potentialBytes: actions.reduce((sum, file) => sum + file.size, 0) };
    }
    const match = normalized.match(/(?:größer|groesser|über|ueber|ab)\s*(?:als\s*)?(\d+(?:[,.]\d+)?)\s*(mb|gb)\b/);
    if (!match) return null; // No interpretation of "alles löschen" or vague requests.
    const threshold = Number(match[1].replace(",", ".")) * (match[2] === "gb" ? 1024 ** 3 : 1024 ** 2);
    if (!Number.isFinite(threshold) || threshold <= 0) return null;
    const actions = files.filter(file => file.size > threshold)
      .map(file => ({ id: file.id, name: file.name, size: file.size, operation: "delete" as const }));
    return { title: `Dateien über ${formatBytes(threshold)} löschen`, explanation: "Die ausgewählten Dateien würden endgültig gelöscht. Prüfe jede Datei vor der Bestätigung.", actions, potentialBytes: actions.reduce((sum, file) => sum + file.size, 0) };
  }
  return null;
}

export function storageSuggestions(entries: StorageEntry[]): FilePlan[] {
  const files = entries.filter(entry => !entry.directory);
  const large = files.filter(file => file.size >= 100 * 1024 ** 2).sort((a, b) => b.size - a.size).slice(0, 20);
  const result: FilePlan[] = [];
  if (large.length) {
    result.push({ title: "Große Dateien prüfen", explanation: "Diese Dateien belegen besonders viel Platz. Eine Löschung braucht deine ausdrückliche Bestätigung.", actions: large.map(file => ({ id: file.id, name: file.name, size: file.size, operation: "delete" })), potentialBytes: large.reduce((sum, file) => sum + file.size, 0) });
  }
  if (files.length) {
    result.push({ title: "Ordner übersichtlich sortieren", explanation: "Dateien nach Typ verschieben; dabei wird kein Speicherplatz frei.", actions: files.map(file => ({ id: file.id, name: file.name, size: file.size, operation: "move", category: categoryOf(file) })), potentialBytes: 0 });
  }
  return result;
}

// ——— Sprint 053: KI-Speicher-Berater (anonymisiert, lokal angewandt) ———

import type { AdvisorRule, AdvisorStats } from "@shared/storage-advisor";

const DAY_MS = 86_400_000;

/** Anonymisierte Statistiken fuer den Server: keine Namen, keine Pfade. */
export function storageStats(entries: StorageEntry[], directories: number): AdvisorStats {
  const files = entries.filter(entry => !entry.directory);
  const now = Date.now();
  const categories = new Map<Category, { count: number; bytes: number; old: number; over100MB: number; over1GB: number }>();
  for (const file of files) {
    const category = categoryOf(file);
    const bucket = categories.get(category) ?? { count: 0, bytes: 0, old: 0, over100MB: 0, over1GB: 0 };
    bucket.count += 1;
    bucket.bytes += file.size;
    if (now - file.modified > 180 * DAY_MS) bucket.old += 1;
    if (file.size > 100 * 1024 ** 2) bucket.over100MB += 1;
    if (file.size > 1024 ** 3) bucket.over1GB += 1;
    categories.set(category, bucket);
  }
  return {
    totalFiles: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.size, 0),
    directories,
    categories: Array.from(categories.entries()).map(([category, bucket]) => ({
      category,
      count: bucket.count,
      bytes: bucket.bytes,
      oldRatio: bucket.count ? bucket.old / bucket.count : 0,
      over100MB: bucket.over100MB,
      over1GB: bucket.over1GB,
    })),
  };
}

function daysOld(entry: StorageEntry): number {
  return Math.max(0, Math.floor((Date.now() - entry.modified) / DAY_MS));
}

/**
 * Wendet Berater-Regeln LOKAL an. Verteidigung in zwei Schichten: Der Server
 * verwirft ungefilterte Delete-Regeln bereits; hier gilt dasselbe nochmal,
 * weil der Client dem LLM-Ergebnis nie blind vertraut.
 */
export function planFromRules(rules: AdvisorRule[], entries: StorageEntry[]): FilePlan | null {
  const files = entries.filter(entry => !entry.directory);
  const matched = new Map<string, FileAction>();
  let explanationParts: string[] = [];
  let deleteBytes = 0;
  for (const rule of rules) {
    if (rule.operation === "delete") {
      const hasFilter = rule.category !== undefined || rule.minSizeMB !== undefined || rule.olderThanDays !== undefined;
      if (!hasFilter) continue; // "alles loeschen" ist nie eine Regel.
    }
    let candidates = files.filter(file => {
      if (rule.category && categoryOf(file) !== rule.category) return false;
      if (rule.minSizeMB !== undefined && file.size < rule.minSizeMB * 1024 ** 2) return false;
      if (rule.olderThanDays !== undefined && daysOld(file) < rule.olderThanDays) return false;
      return true;
    });
    if (rule.operation === "delete") candidates = [...candidates].sort((a, b) => b.size - a.size);
    if (rule.top) candidates = candidates.slice(0, rule.top);
    for (const file of candidates) {
      if (rule.operation === "move" && rule.category && categoryOf(file) !== rule.category) continue;
      if (rule.operation === "move") {
        matched.set(file.id, { id: file.id, name: file.name, size: file.size, operation: "move", category: categoryOf(file) });
      } else if (!matched.has(file.id)) {
        matched.set(file.id, { id: file.id, name: file.name, size: file.size, operation: "delete" });
        deleteBytes += file.size;
      }
    }
    if (rule.reason) explanationParts.push(rule.reason);
  }
  if (!matched.size) return null;
  const allActions = Array.from(matched.values());
  const moves = allActions.some(action => action.operation === "move");
  const deletes = allActions.some(action => action.operation === "delete");
  explanationParts = explanationParts.slice(0, 5);
  return {
    title: deletes && moves ? "KI-Plan: aufräumen und sortieren" : deletes ? "KI-Plan: Speicher freigeben" : "KI-Plan: Ordner strukturieren",
    explanation: `${explanationParts.join(" ")} Jede Aktion wird vor der Ausfuehrung von dir bestaetigt.`.trim(),
    actions: allActions,
    potentialBytes: deleteBytes,
  };
}
