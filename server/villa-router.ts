import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "./_core/trpc";
import { validRating } from "./agent-engine";
import {
  appendMessages,
  createVilla,
  deleteVilla,
  listMessages,
  listVillas,
  rateMessage,
  updateVilla,
} from "./villa-store";

const villaNameSchema = z.string().trim().min(1).max(80);
const specialtySchema = z.string().trim().min(1).max(80);

function storeError(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  throw new TRPCError({
    code: "SERVICE_UNAVAILABLE",
    message:
      "Die Datenbank ist gerade nicht erreichbar. Villen und Verläufe konnten nicht gespeichert werden.",
  });
}

export const villaRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    try {
      return await listVillas(ctx.user.id);
    } catch (error) {
      storeError(error);
    }
  }),

  create: protectedProcedure
    .input(
      z.object({
        name: villaNameSchema,
        specialty: specialtySchema.default("Neuer Agent"),
        icon: z.enum(["villa", "bot"]).default("bot"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await createVilla({
          createdBy: ctx.user.id,
          name: input.name,
          specialty: input.specialty,
          icon: input.icon,
        });
      } catch (error) {
        storeError(error);
      }
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        name: villaNameSchema.optional(),
        specialty: specialtySchema.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const villa = await updateVilla(input.id, ctx.user.id, {
          name: input.name,
          specialty: input.specialty,
        });
        if (!villa) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Villa nicht gefunden oder keine Änderung übergeben.",
          });
        }
        return villa;
      } catch (error) {
        storeError(error);
      }
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const removed = await deleteVilla(input.id, ctx.user.id);
        if (!removed) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Villa nicht gefunden.",
          });
        }
        return { success: true as const };
      } catch (error) {
        storeError(error);
      }
    }),

  messages: protectedProcedure
    .input(z.object({ villaId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      try {
        const rows = await listMessages(input.villaId, ctx.user.id);
        return rows.sort((a, b) => a.id - b.id);
      } catch (error) {
        storeError(error);
      }
    }),

  appendMessages: protectedProcedure
    .input(
      z.object({
        villaId: z.number().int().positive(),
        messages: z
          .array(
            z.object({
              role: z.enum(["user", "assistant"]),
              content: z.string().min(1).max(20_000),
              provider: z.string().max(40).nullish(),
              model: z.string().max(128).nullish(),
            })
          )
          .min(1)
          .max(4),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const rows = await appendMessages(input.villaId, ctx.user.id, input.messages);
        if (rows.length === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Villa nicht gefunden.",
          });
        }
        return rows;
      } catch (error) {
        storeError(error);
      }
    }),

  rateMessage: protectedProcedure
    .input(
      z.object({
        messageId: z.number().int().positive(),
        rating: z.union([z.literal(-1), z.literal(1)]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!validRating(input.rating)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Ungültige Bewertung." });
      }
      try {
        const message = await rateMessage(input.messageId, ctx.user.id, input.rating);
        if (!message) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Nachricht nicht gefunden oder nicht bewertbar.",
          });
        }
        return { rating: message.rating };
      } catch (error) {
        storeError(error);
      }
    }),
});
