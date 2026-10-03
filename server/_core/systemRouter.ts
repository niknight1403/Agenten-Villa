import { z } from "zod";
import { notifyOwner } from "./notification";
import { adminProcedure, publicProcedure, router } from "./trpc";
import {
  clearRouteOverride,
  getRouteOverride,
  pinnableProviders,
  setRouteOverride,
} from "../route-override";

export const systemRouter = router({
  health: publicProcedure
    .input(
      z.object({
        timestamp: z.number().min(0, "timestamp cannot be negative"),
      })
    )
    .query(() => ({
      ok: true,
    })),

  /** Sprint 079 — Routing-Status: aktueller Admin-Pin (Pin-By nur fuer Admins). */
  routingStatus: publicProcedure.query(() => ({
    pinned: getRouteOverride()?.provider ?? null,
    pinnable: pinnableProviders(),
  })),

  /**
   * Sprint 079 — Admin-Pin auf EINEN Anbieter setzen (null = Auto-Kette).
   * Nur Admin; der Pin aendert keine Consent-/Schluesselregeln.
   */
  routingOverride: adminProcedure
    .input(
      z.object({
        provider: z
          .enum(["openrouter", "groq", "gemini", "huggingface"])
          .nullable(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (input.provider === null) {
        clearRouteOverride();
        return { pinned: null };
      }
      const by = ctx.user?.email ?? "admin";
      const override = setRouteOverride(input.provider, by);
      if (!override)
        throw new (await import("@trpc/server")).TRPCError({
          code: "BAD_REQUEST",
          message:
            "Anbieter nicht pinnbar (unbekannt oder im Register nicht aktiv).",
        });
      return { pinned: input.provider };
    }),

  notifyOwner: adminProcedure
    .input(
      z.object({
        title: z.string().min(1, "title is required"),
        content: z.string().min(1, "content is required"),
      })
    )
    .mutation(async ({ input }) => {
      const delivered = await notifyOwner(input);
      return {
        success: delivered,
      } as const;
    }),
});
