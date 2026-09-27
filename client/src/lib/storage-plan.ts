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
