import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { createDemoRequest, listDemoRequests, setDemoRequestStatus } from "./demo-store";

export const demoRequestInput = z.object({
  name: z.string().trim().min(2).max(100),
  company: z.string().trim().min(2).max(120),
  email: z.email().trim().toLowerCase().max(320),
  projectIdea: z.string().trim().min(20).max(4000),
  contactConsent: z.literal(true),
  website: z.string().max(200).default(""), // hidden honeypot: never persist
}).strict();

function requireAdmin(user: { role: string }) {
  // The role is set only after verified Google authentication. A matching
  // e-mail alone must never grant CRM access.
  if (user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Nur Administratoren können Demoanfragen verwalten." });
  }
}

function storageError(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Die Demoanfrage ist momentan nicht verfügbar. Bitte später erneut versuchen." });
}

export const demoRouter = router({
  submit: publicProcedure.input(demoRequestInput).mutation(async ({ input }) => {
    if (input.website.trim()) return { accepted: true as const };
    try {
      await createDemoRequest({
        name: input.name,
        company: input.company,
        email: input.email,
        projectIdea: input.projectIdea,
      });
    } catch (error) {
      storageError(error);
    }
    return { accepted: true as const };
  }),

  list: protectedProcedure.query(async ({ ctx }) => {
    requireAdmin(ctx.user);
    try {
      return await listDemoRequests();
    } catch (error) {
      storageError(error);
    }
  }),

  setStatus: protectedProcedure.input(z.object({
    id: z.number().int().positive(),
    status: z.enum(["new", "contacted", "closed", "opted_out"]),
  }).strict()).mutation(async ({ ctx, input }) => {
    requireAdmin(ctx.user);
    try {
      const updated = await setDemoRequestStatus(input.id, input.status);
      if (!updated) throw new TRPCError({ code: "CONFLICT", message: "Anfrage nicht gefunden oder Kontaktwiderspruch bereits gesetzt." });
      return updated;
    } catch (error) {
      storageError(error);
    }
  }),
});
