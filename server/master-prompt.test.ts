import { describe, expect, it } from "vitest";
import {
  approveSection,
  canExecuteSection,
  canPlanSection,
  completeSection,
  initialMasterPromptProgress,
  isMasterPromptComplete,
  MASTER_PROMPT_SECTIONS,
} from "./master-prompt";

describe("Master-Prompt-Charter (Sprint 101)", () => {
  it("definiert die vier Abschnitte in fester Reihenfolge", () => {
    expect(MASTER_PROMPT_SECTIONS.map((section) => section.id)).toEqual([
      "audit",
      "integration",
      "influencer",
      "revenue",
    ]);
  });

  it("startet komplett offen und ist nicht komplett", () => {
    const progress = initialMasterPromptProgress();
    expect(Object.values(progress.sections).every((status) => status === "pending")).toBe(true);
    expect(isMasterPromptComplete(progress)).toBe(false);
  });

  it("verbietet Code-Ausfuehrung ohne Freigabe", () => {
    const progress = initialMasterPromptProgress();
    expect(canExecuteSection(progress, "audit")).toBe(false);
  });

  it("erlaubt Planung nur fuer den naechsten offenen Abschnitt (kein Ueberspringen)", () => {
    const progress = initialMasterPromptProgress();
    expect(canPlanSection(progress, "audit")).toBe(true);
    expect(canPlanSection(progress, "integration")).toBe(false);
    expect(canPlanSection(progress, "revenue")).toBe(false);
  });

  it("Freigabe ohne vorgelegten Plan wird still abgelehnt", () => {
    const progress = initialMasterPromptProgress();
    const approved = approveSection(progress, "audit");
    expect(approved.sections.audit).toBe("pending");
    expect(canExecuteSection(approved, "audit")).toBe(false);
  });

  it("absolvierter Zyklus: Plan → Freigabe → Ausfuehrung → gruen → done", () => {
    let progress = initialMasterPromptProgress();
    // Plan vorlegen: Uebergang pending → planned
    progress = { ...progress, sections: { ...progress.sections, audit: "planned" } };
    progress = approveSection(progress, "audit");
    expect(progress.sections.audit).toBe("approved");
    expect(canExecuteSection(progress, "audit")).toBe(true);

    // Abschnitt ohne gruenem Verifikationsergebnis wird NICHT done
    const notDone = completeSection(progress, "audit", false);
    expect(notDone.sections.audit).toBe("approved");

    progress = completeSection(progress, "audit", true);
    expect(progress.sections.audit).toBe("done");
    expect(progress.lastApprovedSection).toBe("audit");
    expect(canPlanSection(progress, "integration")).toBe(true);
  });

  it("ist erst komplett, wenn alle vier Abschnitte verifiziert gruen sind", () => {
    let progress = initialMasterPromptProgress();
    for (const section of MASTER_PROMPT_SECTIONS) {
      progress = { ...progress, sections: { ...progress.sections, [section.id]: "planned" } };
      progress = approveSection(progress, section.id);
      progress = completeSection(progress, section.id, true);
    }
    expect(isMasterPromptComplete(progress)).toBe(true);
  });
});
