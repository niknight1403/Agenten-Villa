import { z } from "zod";

/**
 * Sprint 071 — Verbundenes GitHub-Repository einer Villa.
 *
 * Format „owner/repo“: erlaubt Buchstaben, Ziffern, Punkt, Unter- und
 * Bindestrich in beiden Teilen (GitHub-Namensregeln, ohne Sonderzeichen).
 * null/leer = kein eigenes Repository; Missions- und Chat-Werkzeuge
 * der Villa nutzen dann den geschützten Server-Default (GITHUB_REPOSITORY).
 */
export const VILLA_REPOSITORY_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;

export const villaRepositorySchema = z
  .string()
  .trim()
  .regex(VILLA_REPOSITORY_PATTERN, {
    message:
      "Repository im Format „owner/repo“ angeben (z. B. niknight1403/CyberSarah-control-center).",
  })
  .max(120)
  .nullable();

/** Sichere Übersetzung in eine Werkzeug-Abhängigkeit: null bleibt null. */
export function villaRepositoryToToolTarget(
  repository: string | null | undefined
): { repository: string } | undefined {
  if (!repository) return undefined;
  return villaRepositorySchema.safeParse(repository).success
    ? { repository }
    : undefined;
}
