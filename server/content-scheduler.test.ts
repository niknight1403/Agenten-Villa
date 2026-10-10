import { describe, it, expect } from "vitest";
import { planSlots, buildSlotPrompt, nextSlotStatus } from "./content-scheduler";

const persona = {
  id: 7,
  displayName: "Nova Vale",
  tagline: "KI-Stimme",
  handle: "nova",
  systemPrompt: "Du bist eine KI-Entitaet namens Nova Vale.",
  themes: ["Tech", "Zukunft"],
  channels: ["youtube", "blog"],
};

describe("Content-Scheduler (Abschnitt 3.2)", () => {
  it("plant deterministisch Slots fuer jede Persona/Kanal/Theme-Kombi", () => {
    const slots = planSlots([persona], { now: new Date("2026-10-10T08:00:00Z") });
    expect(slots).toHaveLength(4); // 2 Kanaele × 2 Themes
    expect(new Set(slots.map((s) => s.channel))).toEqual(new Set(["youtube", "blog"]));
    for (const s of slots) {
      expect(s.status).toBe("planned");
      expect(s.personaId).toBe(7);
    }
    // Determinismus: gleiche Eingabe → gleiche Zeiten
    const again = planSlots([persona], { now: new Date("2026-10-10T08:00:00Z") });
    expect(again.map((s) => s.scheduledFor.toISOString())).toEqual(
      slots.map((s) => s.scheduledFor.toISOString())
    );
  });

  it("skips Personas ohne Themes oder Kanaele", () => {
    expect(planSlots([{ ...persona, themes: [] }])).toHaveLength(0);
    expect(planSlots([{ ...persona, channels: [] }])).toHaveLength(0);
  });

  it("buildSlotPrompt enthaelt System-Prompt, Theme, Kanal-Format und KI-Hinweis", () => {
    const prompt = buildSlotPrompt(persona, { channel: "instagram", theme: "Zukunft" });
    expect(prompt).toContain("KI-Entitaet");
    expect(prompt).toContain("Zukunft");
    expect(prompt).toContain("instagram");
    expect(prompt).toContain("Carousel-Caption");
  });

  it("erkennt unbekannte Kanaele mit Fallback-Format", () => {
    const prompt = buildSlotPrompt(persona, { channel: "threads", theme: "Tech" });
    expect(prompt).toContain("Post");
  });

  it("zulaesst 'published' NUR nach Admin-Freigabe (kein Autonom-Pfad)", () => {
    expect(nextSlotStatus("planned", "drafted")).toBe("drafted");
    expect(nextSlotStatus("drafted", "approve")).toBe("approved");
    expect(nextSlotStatus("approved", "publish")).toBe("published");
    expect(nextSlotStatus("drafted", "reject")).toBe("rejected");
    expect(() => nextSlotStatus("planned", "publish")).toThrow();
    expect(() => nextSlotStatus("planned", "approve")).toThrow();
    expect(() => nextSlotStatus("drafted", "publish")).toThrow();
    expect(() => nextSlotStatus("approved", "drafted")).toThrow();
  });
});
