import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "./_core/trpc";
import {
  assignProfileToVilla,
  createProfile,
  deleteProfile,
  listProfiles,
  updateProfile,
} from "./profile-store";

function storeError(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  throw new TRPCError({
    code: "SERVICE_UNAVAILABLE",
    message:
      "Die Datenbank ist gerade nicht erreichbar. Profile konnten nicht gespeichert werden.",
  });
}

const profileNameSchema = z.string().trim().min(1).max(80);
const roleSchema = z.enum(["strategie", "entwicklung", "review", "support"]);

/**
 * Sprint 016 — Superagenten-Profile: Rollen und Aufgabenprofile sind
 * konfigurierbar und einer Villa zuordenbar.
 */
export const profileRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    try {
      return await listProfiles(ctx.user.id);
    } catch (error) {
      storeError(error);
    }
  }),

  create: protectedProcedure
    .input(
      z.object({
        name: profileNameSchema,
        role: roleSchema.default("entwicklung"),
        taskProfile: z.string().trim().max(2000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await createProfile({
          createdBy: ctx.user.id,
          name: input.name,
          role: input.role,
          taskProfile: input.taskProfile,
        });
      } catch (error) {
        storeError(error);
      }
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        name: profileNameSchema.optional(),
        role: roleSchema.optional(),
        taskProfile: z.string().trim().max(2000).nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const profile = await updateProfile(input.id, ctx.user.id, {
          name: input.name,
          role: input.role,
          taskProfile: input.taskProfile,
        });
        if (!profile) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Profil nicht gefunden oder keine Änderung übergeben.",
          });
        }
        return profile;
      } catch (error) {
        storeError(error);
      }
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const removed = await deleteProfile(input.id, ctx.user.id);
        if (!removed) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Profil nicht gefunden.",
          });
        }
        return { success: true as const };
      } catch (error) {
        storeError(error);
      }
    }),

  /** Ordnet einer eigenen Villa ein eigenes Profil zu (null = Aufheben). */
  assign: protectedProcedure
    .input(
      z.object({
        villaId: z.number().int().positive(),
        profileId: z.number().int().positive().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const villa = await assignProfileToVilla(
          input.villaId,
          input.profileId,
          ctx.user.id
        );
        if (!villa) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Villa oder Profil nicht gefunden oder nicht berechtigt.",
          });
        }
        return villa;
      } catch (error) {
        storeError(error);
      }
    }),
});
