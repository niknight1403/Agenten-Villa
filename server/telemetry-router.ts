import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "./_core/trpc";
import {
  getTelemetryConsent,
  setTelemetryConsent,
} from "./telemetry-consent";

function storeError(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  throw new TRPCError({
    code: "SERVICE_UNAVAILABLE",
    message:
      "Die Einwilligung konnte nicht gespeichert werden. Die Telemetrie bleibt solange aus.",
  });
}

/**
 * Sprint 098 — Produkt-Telemetrie: optionale, datenschutzkonforme Metriken.
 * Einwilligung ist pro Nutzer, Standard AUS. Der Datenschutz-Hinweis wird
 * unveraendert mitgeliefert — der Client zeigt ihn direkt am Schalter.
 */
export const telemetryRouter = router({
  consent: protectedProcedure.query(async ({ ctx }) => {
    try {
      return await getTelemetryConsent(ctx.user.id);
    } catch (error) {
      storeError(error);
    }
  }),

  setConsent: protectedProcedure
    .input(z.object({ optedIn: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await setTelemetryConsent(ctx.user.id, input.optedIn);
      } catch (error) {
        storeError(error);
      }
    }),
});
