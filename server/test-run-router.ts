import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "./_core/trpc";
import {
  finishTestRun,
  getTestRun,
  listTestRuns,
  setRunPhase,
  startTestRun,
  TestRunError,
} from "./test-run-store";
import type { RunPhase } from "../drizzle/schema";

const idSchema = z.number().int().positive();
/** Sprint 021 — Abschlussstatus; „running" kann nur vom System gesetzt werden. */
const finishStatusSchema = z.enum(["succeeded", "failed", "cancelled"]);

/** Sprint 023 — anwenderseitige Phasen; „result" setzt nur der Abschluss. */
const phaseSchema = z.enum(["preparation", "planning", "execution", "review"]);

/** Maximale Ergebnisgröße, damit ein Laufbericht die Datenbank nicht aufbläht. */
const MAX_RESULT_BYTES = 20_000;

function storeError(error: unknown): never {
  if (error instanceof TestRunError) {
    const code =
      error.reason === "NOT_FOUND"
        ? "NOT_FOUND"
        : error.reason === "ARCHIVED"
          ? "FORBIDDEN"
          : "CONFLICT"; // STATUS_MISMATCH und PHASE_MISMATCH sind Konflikte
    throw new TRPCError({
      code,
      message: `Testlauf nicht möglich: ${error.reason}`,
    });
  }
  if (error instanceof TRPCError) throw error;
  throw new TRPCError({
    code: "SERVICE_UNAVAILABLE",
    message:
      "Die Datenbank ist gerade nicht erreichbar. Testläufe konnten nicht gespeichert werden.",
  });
}

/**
 * Sprint 021/022 — Begrenzte Testläufe: Status, Startzeit, Endzeit und
 * Ergebnis werden persistiert; Start und Abschluss sind idempotent —
 * wiederholte Aufrufe liefern denselben Zustand zurück, statt einen
 * inkonsistenten zu erzeugen.
 */
export const testRunRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          villaId: idSchema.optional(),
          limit: z.number().int().min(1).max(50).optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      try {
        return await listTestRuns(ctx.user.id, input?.villaId, input?.limit);
      } catch (error) {
        storeError(error);
      }
    }),

  get: protectedProcedure
    .input(z.object({ runId: idSchema }))
    .query(async ({ ctx, input }) => {
      try {
        const run = await getTestRun(input.runId, ctx.user.id);
        if (!run) throw new TestRunError("NOT_FOUND");
        return run;
      } catch (error) {
        storeError(error);
      }
    }),

  start: protectedProcedure
    .input(z.object({ villaId: idSchema }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await startTestRun(input.villaId, ctx.user.id);
      } catch (error) {
        storeError(error);
      }
    }),

  finish: protectedProcedure
    .input(
      z.object({
        runId: idSchema,
        status: finishStatusSchema,
        result: z.unknown().optional(),
        errorCode: z.string().trim().max(40).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        if (
          input.result !== undefined &&
          JSON.stringify(input.result).length > MAX_RESULT_BYTES
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Ergebnis ist zu groß (maximal ${MAX_RESULT_BYTES} Bytes).`,
          });
        }
        return await finishTestRun({
          runId: input.runId,
          userId: ctx.user.id,
          status: input.status,
          result: input.result,
          errorCode: input.errorCode,
        });
      } catch (error) {
        storeError(error);
      }
    }),

  /**
   * Sprint 023 — Phase eines laufenden Testlaufs vorwaerts schalten
   * (preparation -> planning -> execution -> review). „result" setzt nur
   * finish. Wiederholtes Setzen der aktuellen Phase ist idempotent;
   * abgeschlossene oder rückwärtige Sprünge sind Konflikte.
   */
  setPhase: protectedProcedure
    .input(z.object({ runId: idSchema, phase: phaseSchema }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await setRunPhase({
          runId: input.runId,
          userId: ctx.user.id,
          phase: input.phase as Exclude<RunPhase, "result">,
        });
      } catch (error) {
        storeError(error);
      }
    }),
});