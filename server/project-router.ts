import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "./_core/trpc";
import {
  assignProjectToVilla,
  createProject,
  listProjects,
} from "./project-store";

function storeError(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  throw new TRPCError({
    code: "SERVICE_UNAVAILABLE",
    message:
      "Die Datenbank ist gerade nicht erreichbar. Projekte konnten nicht gespeichert werden.",
  });
}

/**
 * Sprint 015 — Projektzuordnung: Ein Projekt kann genau einer oder
 * mehreren erlaubten (eigenen) Villen zugeordnet werden.
 */
export const projectRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    try {
      return await listProjects(ctx.user.id);
    } catch (error) {
      storeError(error);
    }
  }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(80),
        brief: z.string().trim().max(2000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await createProject({
          createdBy: ctx.user.id,
          name: input.name,
          brief: input.brief,
        });
      } catch (error) {
        storeError(error);
      }
    }),

  /** Ordnet ein eigenes Projekt einer eigenen Villa zu (null = Aufheben). */
  assign: protectedProcedure
    .input(
      z.object({
        villaId: z.number().int().positive(),
        projectId: z.number().int().positive().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const villa = await assignProjectToVilla(
          input.villaId,
          input.projectId,
          ctx.user.id
        );
        if (!villa) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Villa oder Projekt nicht gefunden oder nicht berechtigt.",
          });
        }
        return villa;
      } catch (error) {
        storeError(error);
      }
    }),
});
