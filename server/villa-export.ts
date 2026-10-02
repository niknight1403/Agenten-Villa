import { z } from "zod";

/**
 * Sprint 057 — Export-Schutz.
 *
 * villa.export liefert ein portables JSON. Bislang war die Form nur
 * implizit (Konstruktion im Store) — interne Felder wie Datenbank-IDs,
 * createdBy, Anbieter-/Modell-Metadaten oder ein zukuenftig ergaenzter
 * Spaltenwert des select() waren nur durch Konvention ausgeschlossen.
 *
 * Dieser Layer macht die Freigabe explizit: Der Export wird vor der
 * Rueckgabe durch ein versioniertes Schema geparsed (whitelist, nicht
 * blacklist) — alles Unbekannte wird garantiert entfernt, Rollen sind
 * auf user/assistant beschraenkt, und der Ausschnitt ist auf 2000
 * Nachrichten begrenzt (Import akzeptiert ohnehin nur 200).
 */

export const VILLA_EXPORT_VERSION = 1;

export const villaExportMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(25000),
  createdAt: z.date(),
});

export const villaExportSchema = z.object({
  name: z.string().min(1).max(200),
  specialty: z.string().min(1).max(200),
  icon: z.enum(["villa", "bot"]),
  projectBrief: z.string().max(4000).nullable(),
  description: z.string().max(1000).nullable(),
  capacity: z.number().int().min(1).max(25),
  messages: z.array(villaExportMessageSchema).max(2000),
  exportedAt: z.date(),
  version: z.literal(VILLA_EXPORT_VERSION),
});

export type VillaExport = z.infer<typeof villaExportSchema>;

/**
 * Redigiert einen Roh-Export: unbekannte Felder werden entfernt,
 * unzulaessige Rollen (z. B. zukuenftige system-Eintraege) herausgefiltert.
 * Nachfolgende Validierung stellt sicher, dass nur die Whitelist uebrig
 * bleibt — ein vollstaendiges Objekt garantiert.
 */
export function sanitizeVillaExport(raw: {
  name: string;
  specialty: string;
  icon: "villa" | "bot";
  projectBrief: string | null;
  description: string | null;
  capacity: number;
  messages: {
    role: string;
    content: string;
    createdAt: Date;
  }[];
  exportedAt: Date;
  version: number;
}): VillaExport {
  const allowedMessages = raw.messages.filter(
    (m): m is { role: "user" | "assistant"; content: string; createdAt: Date } =>
      (m.role === "user" || m.role === "assistant") &&
      typeof m.content === "string" &&
      m.content.length > 0
  );

  return villaExportSchema.parse({
    ...raw,
    version: VILLA_EXPORT_VERSION,
    messages: allowedMessages,
  });
}
