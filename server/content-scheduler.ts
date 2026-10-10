/**
 * Sprint 103 / Master-Prompt Abschnitt 3.2 — Content-Scheduling.
 *
 * Deterministischer Slot-Planer (Persona × Kanal × Theme) und Draft-Erzeugung
 * ueber die Agent-Engine (Ollama-First-Routing, Token-Budget aus Abschnitt 2).
 *
 * HARTE REGEL: Drafts werden NIE autonom veroeffentlicht. Ein Slot geht erst
 * nach expliziter Admin-Freigabe auf 'published'. Das ist strukturell so —
 * es gibt keinen Codepfad, der 'published' ohne review setzt.
 */

import type { Persona } from "../drizzle/schema";

export type SlotStatus = "planned" | "drafted" | "approved" | "rejected" | "published";

export type PlannedSlot = {
  personaId: number;
  channel: string;
  theme: string;
  scheduledFor: Date;
  status: SlotStatus;
};

/** Kanal-spezifische Formate und Laengen fuer konsistente Drafts. */
const CHANNEL_FORMAT: Record<string, { format: string; maxChars: number }> = {
  youtube: { format: "Skript fuer ein kurzes Video (Hook, 3 Kernaussagen, Call-to-Action)", maxChars: 2400 },
  instagram: { format: "Carousel-Caption mit 3-5Slides-Gliederung", maxChars: 900 },
  tiktok: { format: "Sprechtext fuer 45 Sekunden", maxChars: 500 },
  blog: { format: "Blog-Artikel mit Ueberschriften", maxChars: 4000 },
  podcast: { format: "Sprechnotizen fuer eine 10-Minuten-Folge", maxChars: 2000 },
};

/**
 * Deterministischer Slot-Plan: verteilt Themes ueber Kanaele und Zeitfenster.
 * Rein funktional — keine DB, keine Seiteneffekte (Testbarkeit).
 *
 * @param personas aktive Personas (id, themes, channels)
 * @param slotsPerPersonaAndDay Slots pro Persona und Tag (Default 2)
 * @param now Startzeitpunkt (Default: jetzt)
 */
export function planSlots(
  personas: Pick<Persona, "id" | "themes" | "channels">[],
  options: { slotsPerDay?: number; now?: Date } = {}
): PlannedSlot[] {
  const perDay = options.slotsPerDay ?? 2;
  const now = options.now ?? new Date();
  const slots: PlannedSlot[] = [];
  for (const persona of personas) {
    if (!persona.themes?.length || !persona.channels?.length) continue;
    const hourStep = Math.max(1, Math.floor(24 / perDay));
    persona.channels.forEach((channel, channelIndex) => {
      persona.themes.forEach((theme, themeIndex) => {
        const dayIndex = themeIndex;
        const hour = ((channelIndex * hourStep) + (themeIndex % perDay) * hourStep) % 24;
        const scheduledFor = new Date(now);
        scheduledFor.setDate(scheduledFor.getDate() + dayIndex);
        scheduledFor.setHours(hour, 0, 0, 0);
        slots.push({
          personaId: persona.id,
          channel,
          theme,
          scheduledFor,
          status: "planned",
        });
      });
    });
  }
  return slots;
}

/** Prompt fuer die Draft-Generierung eines Slots (nutzt Persona-Dossier). */
export function buildSlotPrompt(
  persona: Pick<Persona, "displayName" | "tagline" | "systemPrompt" | "handle">,
  slot: Pick<PlannedSlot, "channel" | "theme">
): string {
  const channelSpec = CHANNEL_FORMAT[slot.channel] ?? { format: "Post", maxChars: 1200 };
  return [
    persona.systemPrompt,
    `Erstelle Content zum Theme "${slot.theme}" fuer den Kanal "${slot.channel}".`,
    `Format: ${channelSpec.format}. Maximal ${channelSpec.maxChars} Zeichen.`,
    "Kennzeichne dich als KI im Text, wenn es natuerlich passt (z. B. Signatur oder Hinweis).",
    "Keine erfundenen Zitate, Statistiken oder Behauptungen ueber dich als Person.",
  ].join("\n\n");
}

/**
 * Status-Uebergang fuer Slots mit erzwungener Admin-Freigabe:
 * planned → drafted (Autonom erlaubt), → approved/published NUR durch
 * Admin-Review. Es gibt keinen Autonom-Pfad zu 'approved'.
 */
export function nextSlotStatus(
  current: SlotStatus,
  event: "drafted" | "approve" | "reject" | "publish"
): SlotStatus {
  if (event === "drafted" && current === "planned") return "drafted";
  if (event === "approve" && current === "drafted") return "approved";
  if (event === "reject" && (current === "drafted" || current === "approved")) return "rejected";
  if (event === "publish" && current === "approved") return "published";
  throw new Error(`Ungueltiger Uebergang: ${current} + ${event}`);
}
