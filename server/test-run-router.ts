import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "./_core/trpc";
import {
  finishTestRun,
  getTestRun,
  listTestRuns,
  startTestRun,
  TestRunError,
} from "./test-run-store";

const idSchema = z.number().int().positive();
/** Sprint 021 — Abschlussstatus; „running" kann nur vom System gesetzt werden. */
const finishStatusSchema = z.enum(["succeeded", "failed", "cancelled"]);

/** Maximale Ergebnisgröße, damit ein Laufbericht die Datenbank nicht aufbläht. */
const MAX_RESULT_BYTES = 20_000;

function storeError(error: unknown): never {
  if (error instanceof TestRunError) {
    const code =
      error.reason === "NOT_FOUND"
        ? "NOT_FOUND"
        : error.reason === "ARCHIVED"
          ? "FORBIDDEN"
          : "CONFLICT";
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
});
