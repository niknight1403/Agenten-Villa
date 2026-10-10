/**
 * Sprint 097 — Nutzer-Onboarding: Neue Nutzer koennen eine Villa ohne
 * Sackgasse erstellen. Diese Helfer sind reine Funktionen (Logik in /lib):
 *
 *  - normalizeRepositoryInput: forgives eingeklebte GitHub-URLs und
 *    haelt trotzdem das Server-Format „owner/repo“ ein.
 *  - validateNewVillaForm: prueft das Erstellungsformular VOR dem Absenden
 *    mit klaren deutschen Meldungen — kein Nutzer landet in einer
 *    Zod-Fehlermeldung.
 *  - onboardingSteps: sagt einer frischen Villa ehrlich, was der naechste
 *    sinnvolle Schritt ist (keine Sackgasse nach dem Erstellen).
 */
import { VILLA_REPOSITORY_PATTERN } from "@shared/villa-repository";

/** GitHub-URL/„.git“-Praefixe, die Nutzer real einkopieren. */
const URL_PREFIXES = [
  "https://github.com/",
  "http://github.com/",
  "https://www.github.com/",
  "http://www.github.com/",
  "github.com/",
  "www.github.com/",
];

/**
 * Verzeiht Eingabedrumherum und liefert „owner/repo“ oder null, wenn sich
 * auch nach Normalisierung kein gueltiges Format ergibt.
 */
export function normalizeRepositoryInput(raw: string): string | null {
  let value = raw.trim();
  if (!value) return null;
  for (const prefix of URL_PREFIXES) {
    if (value.toLowerCase().startsWith(prefix)) {
      value = value.slice(prefix.length);
      break;
    }
  }
  value = value.replace(/\.git$/i, "");
  value = value.replace(/\/+$/, "");
  return VILLA_REPOSITORY_PATTERN.test(value) ? value : null;
}

export interface NewVillaFormInput {
  name: string;
  repository: string;
  projectBrief: string;
  description: string;
}

export interface NewVillaFormValidation {
  ok: boolean;
  /** Normalisiertes Repository („owner/repo“), wenn Feld gefuellt und gueltig. */
  normalizedRepository: string | null;
  errors: {
    name?: string;
    repository?: string;
    projectBrief?: string;
    description?: string;
  };
}

/** Prueft das Formular vor dem Absenden. Leere Optionalfelder sind okay. */
export function validateNewVillaForm(
  input: NewVillaFormInput
): NewVillaFormValidation {
  const errors: NewVillaFormValidation["errors"] = {};
  const name = input.name.trim();
  const brief = input.projectBrief.trim();
  const description = input.description.trim();
  const rawRepository = input.repository.trim();

  if (!name) errors.name = "Gib deiner Villa einen Namen.";
  else if (name.length > 80) errors.name = "Maximal 80 Zeichen.";

  let normalizedRepository: string | null = null;
  if (rawRepository) {
    normalizedRepository = normalizeRepositoryInput(rawRepository);
    if (!normalizedRepository) {
      errors.repository =
        "Repository im Format „owner/repo“ angeben (z. B. niknight1403/CyberSarah-control-center) — GitHub-Links werden automatisch gekuerzt.";
    }
  }

  if (brief.length > 4000) errors.projectBrief = "Maximal 4000 Zeichen.";
  else if (brief.length > 0 && brief.length < 3) {
    errors.projectBrief = "Projektidee leer lassen oder mit mindestens 3 Zeichen beschreiben.";
  }

  if (description.length > 1000) errors.description = "Maximal 1000 Zeichen.";

  return {
    ok: Object.keys(errors).length === 0,
    normalizedRepository,
    errors,
  };
}

export interface OnboardingVilla {
  name: string;
  repository: string | null;
  projectBrief: string | null;
}

/**
 * Konkrete naechste Schritte fuer eine frische Villa. Ehrlichkeit: Ohne
 * Repository gilt der geschuetzte Server-Default — das ist keine Blockade,
 * sondern wird als gueltiger Weg benannt.
 */
export function onboardingSteps(villa: OnboardingVilla): string[] {
  const steps: string[] = [];
  if (!villa.projectBrief?.trim()) {
    steps.push(
      `Beschreibe „${villa.name}“ ein Projektziel — davon profitieren Chat und autonome Missionen.`
    );
  }
  if (!villa.repository) {
    steps.push(
      "Ohne eigenes Repository nutzt die Villa das Server-Standard-Repository; verbinde ein eigenes („owner/repo“), sobald eines existiert."
    );
  }
  if (steps.length === 0) {
    steps.push(
      "Alles verbunden: Starte die Repository-Analyse oder eine autonome Mission."
    );
  }
  return steps;
}
