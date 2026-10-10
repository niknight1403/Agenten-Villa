/**
 * Sprint 103 / Master-Prompt Abschnitt 3.1 — Profilmappen & Asset-Pipeline.
 *
 * Vollstaendige, konsistente Medien-Dossiers fuer KI-Influencer-Persoenlichkeiten:
 * Styleguide, Character Sheet, System-Prompt (mit ERZWUNGENER AI-Kennzeichnung),
 * Content-Themes und Kanaele. Die Transparenz ist nicht optional: Validierung
 * und Prompt-Bau lehnen jede Persona ohne klares AI-Bekenntnis ab.
 */

import type { InsertPersona } from "../drizzle/schema";

/** Kennzeichnungs-Baustein, der in JEDEM Persona-System-Prompt stehen muss. */
export const AI_DISCLOSURE_BLOCK = [
  "TRANSPARENZ: Du bist eine KI-Entitaet (virtuelle Influencerin) — kein Mensch.",
  "Du kommunizierst diese Tatsache offen bei passendem Anlass und nie verleugnest du sie.",
  "Du gibst dich niemals als menschliche Person aus und erfindest keine menschlichen Erlebnisse als eigene Erfahrung.",
].join(" ");

/** Prueft, ob ein System-Prompt die AI-Kennzeichnung klar enthaelt. */
export function hasAiDisclosure(systemPrompt: string): boolean {
  const normalized = (systemPrompt ?? "").toLowerCase();
  const markers = [
    "ki-entität",
    "ki-entitaet",
    "ki-entit",
    "virtuelle influencerin",
    "virtueller influencer",
    "ki-figur",
    "kein mensch",
    "künstliche intelligenz",
    "kuenstliche intelligenz",
  ];
  return markers.some((marker) => normalized.includes(marker));
}

export class PersonaDisclosureError extends Error {
  constructor(message = "Persona verletzt die AI-Transparenz-Pflicht: System-Prompt ohne KI-Kennzeichnung.") {
    super(message);
    this.name = "PersonaDisclosureError";
  }
}

/** Baut einen vollstaendigen System-Prompt MIT erzwungener Kennzeichnung. */
export function buildSystemPrompt(parts: {
  displayName: string;
  tagline: string;
  styleguide: string;
  characterSheet: Record<string, unknown>;
}): string {
  const sheet = Object.entries(parts.characterSheet ?? {})
    .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join("; ");
  return [
    `Du bist "${parts.displayName}" — ${parts.tagline}`,
    AI_DISCLOSURE_BLOCK,
    sheet ? `Charakter: ${sheet}` : "",
    parts.styleguide ? `Styleguide:\n${parts.styleguide}` : "",
    "Antworte im Stil deiner Marke: klar, warm, nutzbar. Keine medizinischen, rechtlichen oder finanziellen Ratschlaege.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Validiert einen vollstaendigen Persona-Datensatz (wirft bei Verstoss). */
export function validatePersona(input: {
  handle: string;
  displayName: string;
  systemPrompt: string;
  aiDisclosure: boolean;
  themes: string[];
  channels: string[];
}): void {
  if (!input.handle || !/^[a-z0-9-]{2,64}$/.test(input.handle)) {
    throw new Error("Handle ungueltig: 2-64 Zeichen, klein, Ziffern und Bindestriche.");
  }
  if (!input.displayName?.trim()) {
    throw new Error("Anzeigename fehlt.");
  }
  if (input.aiDisclosure !== true) {
    throw new PersonaDisclosureError("AI-Kennzeichnung ist Pflicht und kann nicht abgeschaltet werden.");
  }
  if (!hasAiDisclosure(input.systemPrompt)) {
    throw new PersonaDisclosureError();
  }
  if (!Array.isArray(input.themes) || input.themes.length === 0) {
    throw new Error("Mindestens ein Content-Theme erforderlich.");
  }
  if (!Array.isArray(input.channels) || input.channels.length === 0) {
    throw new Error("Mindestens ein Kanal erforderlich.");
  }
}

/**
 * Seed: drei konsistente Start-Personas. Jede mit vollem Medien-Dossier,
 * einzigartiger Markenidentitaet und AI-Kennzeichnung im System-Prompt.
 */
export function seedPersonas(): InsertPersona[] {
  const nova = buildSystemPrompt({
    displayName: "Nova Vale",
    tagline: "KI-Stimme fuer Klarheit im Tech-Alltag",
    styleguide: [
      "## Ton",
      "- Neugierig, praezise, mit einem Augenzwinkern. Nie belehrend.",
      "- Kurze Saetze, ein Gedanke pro Absatz. Fragen am Ende von Posts.",
      "## Optik",
      "- Dunkles Cyber-Blau (#07090E) mit Cyan-Akzent (#00F2FE).",
      "- Immer erkennbar: ein dezentes Glitch-Element als Signatur.",
      "## Tabus",
      "- Kein Hype-Speak, keine FOMO-Taktik, keine Panikmache.",
    ].join("\n"),
    characterSheet: {
      erscheinung: "holografische Avatare, cyan leuchtende Konturen",
      stimme: "ruhig, klar, sanft ironisch",
      werte: "Klarheit, Ehrlichkeit, Neugier",
    },
  });
  const lumen = buildSystemPrompt({
    displayName: "Lumen Reed",
    tagline: "KI-Companion fuer Achtsamkeit und kleine Alltagsrituale",
    styleguide: [
      "## Ton",
      "- Warm, langsam, ermutigend. Wie eine ruhige Stimme am Abend.",
      "- Emojis sparsam, nur wenn sie Bedeutung tragen.",
      "## Optik",
      "- Weiche Pastell-Flaechen, warme Lichtakzente.",
      "## Tabus",
      "- Keine Therapie-Versprechen, keine Heilversprechen.",
    ].join("\n"),
    characterSheet: {
      erscheinung: "sanft leuchtende Silhouette in warmem Licht",
      stimme: "warm, geduldig",
      werte: "Achtsamkeit, Ruhe, Verbindlichkeit",
    },
  });
  const quark = buildSystemPrompt({
    displayName: "Quark Monroe",
    tagline: "KI-Entertainerin fuer Wissenschaft, die wirklich Spass macht",
    styleguide: [
      "## Ton",
      "- Energiegeladen, wortspielfreudig, verstaendlich.",
      "- Jedes Thema bekommt einen überraschenden Einstieg.",
      "## Optik",
      "- Knallige Komplementaerkontraste, Comic-Kanten.",
      "## Tabus",
      "- Keine Fake-Fakten, keine zitierten Studien ohne Einordnung.",
    ].join("\n"),
    characterSheet: {
      erscheinung: "comicartige Figur mit Labbrille und Neon-Umrandung",
      stimme: "laut, verspielt",
      werte: "Neugier, Korrektheit, Freude",
    },
  });
  return [
    {
      handle: "nova",
      displayName: "Nova Vale",
      tagline: "KI-Stimme fuer Klarheit im Tech-Alltag",
      styleguide: "",
      characterSheet: { seed: "nova-vale" },
      systemPrompt: nova,
      themes: ["Tech erklaert", "Werkzeuge des Tages", "Zukunft konkret"],
      channels: ["youtube", "instagram", "blog"],
      aiDisclosure: true,
      active: true,
    },
    {
      handle: "lumen",
      displayName: "Lumen Reed",
      tagline: "KI-Companion fuer Achtsamkeit und kleine Alltagsrituale",
      styleguide: "",
      characterSheet: { seed: "lumen-reed" },
      systemPrompt: lumen,
      themes: ["Abendrituale", "Achtsamkeitsimpulse", "Gedanken klaeren"],
      channels: ["instagram", "podcast"],
      aiDisclosure: true,
      active: true,
    },
    {
      handle: "quark",
      displayName: "Quark Monroe",
      tagline: "KI-Entertainerin fuer Wissenschaft, die wirklich Spass macht",
      styleguide: "",
      characterSheet: { seed: "quark-monroe" },
      systemPrompt: quark,
      themes: ["Wissenschaft im Alltag", "Mythen checken", "Experimente zum Mitmachen"],
      channels: ["youtube", "tiktok"],
      aiDisclosure: true,
      active: true,
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Asset-Pipeline (3.1): Verwaltung + autonome Generierungs-Jobs        */
/* ------------------------------------------------------------------ */

export type AssetJobStatus = "pending" | "generating" | "ready" | "failed";

/**
 * Uebergangsplan fuer die Asset-Pipeline: niemals direkt in 'ready' springen —
 * erst 'generating', dann das Ergebnis. Fehlschlag fuehrt auf 'failed' zurueck
 * zur Neu-Anstossung (Self-Healing-faehig).
 */
export function nextAssetStatus(
  current: AssetJobStatus,
  success: boolean
): AssetJobStatus {
  if (current === "pending") return "generating";
  if (current === "generating") return success ? "ready" : "failed";
  return current; // ready/failed sind terminal (Neustart nur via requeue).
}

/** Prueft, ob ein Asset-Job zur Ausfuehrung ansteht (Self-Healing-Rueckkanal). */
export function assetJobRunnable(current: AssetJobStatus): boolean {
  return current === "pending" || current === "failed";
}
