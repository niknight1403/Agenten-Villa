/**
 * Sprint 071/072 — Regression: Villa-Repository-Validierung und
 * Missions-Bausteine (Auftrag, Stopp-Bericht).
 */
import { describe, expect, it } from "vitest";
import {
  villaRepositorySchema,
  villaRepositoryToToolTarget,
} from "../shared/villa-repository";
import {
  buildStoppedMissionReport,
  buildVillaMissionObjective,
} from "./villa-mission";

describe("Sprint 071 — Villa-Repository-Validierung", () => {
  it.each([
    "niknight1403/CyberSarah-control-center",
    "a/b",
    "user.name/repo_name",
  ])("akzeptiert gültiges Format: %s", value => {
    expect(villaRepositorySchema.parse(value)).toBe(value);
  });

  it.each([
    "plainrepo",
    "owner/",
    "/repo",
    "owner/repo/extra",
    "owner/repo?hack=1",
    "owner repo",
  ])("lehnt ungültiges Format ab: %s", value => {
    expect(!villaRepositorySchema.safeParse(value).success).toBe(true);
  });

  it("null ist erlaubt (kein Repository = Server-Default)", () => {
    expect(villaRepositorySchema.parse(null)).toBeNull();
  });

  it("kürzt Leerzeichen vor der Prüfung", () => {
    expect(villaRepositorySchema.parse("  a/b ")).toBe("a/b");
  });

  it("toToolTarget: gültiges Repository wird durchgereicht", () => {
    expect(villaRepositoryToToolTarget("a/b")).toEqual({ repository: "a/b" });
  });

  it("toToolTarget: null/leer/ungültig bleibt ohne Override", () => {
    expect(villaRepositoryToToolTarget(null)).toBeUndefined();
    expect(villaRepositoryToToolTarget(undefined)).toBeUndefined();
    expect(villaRepositoryToToolTarget("")).toBeUndefined();
    expect(villaRepositoryToToolTarget("böses/format!")).toBeUndefined();
  });
});

describe("Sprint 072 — Missionsauftrag", () => {
  it("enthält Analyse zuerst, Verbesserung, Empfehlungen und Bericht", () => {
    const objective = buildVillaMissionObjective({
      villaName: "CyberSarah",
      projectBrief: "Umsatz steigern",
      repository: "niknight1403/CyberSarah-control-center",
    });
    expect(objective).toContain("Analysiere zuerst");
    expect(objective).toContain("Umsatz- und Autonomie-orientiert");
    expect(objective).toContain("niknight1403/CyberSarah-control-center");
    expect(objective).toContain("Umsatz steigern");
    expect(objective).toContain("CyberSarah");
    expect(objective).toContain("Empfehlungen");
    expect(objective).toContain("Bericht");
  });

  it("freiwilliger Auftrag wird eingebettet", () => {
    const objective = buildVillaMissionObjective(
      { villaName: "Villa X" },
      "Fokus auf Monetarisierung"
    );
    expect(objective).toContain("Fokus auf Monetarisierung");
    expect(objective).toContain("Villa X");
  });

  it("ohne Repository fehlt die Repository-Zeile", () => {
    const objective = buildVillaMissionObjective({ villaName: "V" });
    expect(!objective.includes("Verbundenes Repository")).toBe(true);
  });
});

describe("Sprint 072 — Stopp-Bericht", () => {
  it("ist ehrlich: kein Behaupten einer Vollendung", () => {
    const report = buildStoppedMissionReport({
      villaName: "CyberSarah",
      toolActions: 7,
      lastEvents: ["GitHub-Aktion 7: github_read_file"],
      lastEventAt: "2026-10-03T16:00:00.000Z",
    });
    expect(report).toContain("Stopp-Knopf");
    expect(report).toContain("7");
    expect(report).toContain("Draft-PRs");
    expect(report).toContain("github_read_file");
    // Keine trügerischen Abschlussformeln:
    expect(!report.includes("abgeschlossen und erfolgreich")).toBe(true);
  });

  it("ohne Ereignisse bleibt der Bericht trotzdem nützlich", () => {
    const report = buildStoppedMissionReport({
      villaName: "V",
      toolActions: 0,
      lastEvents: [],
    });
    expect(report).toContain("GitHub-Aktionen bis zum Stopp: 0.");
    expect(report).toContain("Nächste Schritte");
  });
});
