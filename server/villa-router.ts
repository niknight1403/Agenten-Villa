import { z } from "zod";
import { villaRepositorySchema } from "../shared/villa-repository";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "./_core/trpc";
import { validRating } from "./agent-engine";
import {
  appendMessages,
  createVilla,
  createVillaFromTemplate,
  deleteVilla,
  ensureStarterVilla,
  exportVilla,
  importVilla,
  listMessages,
  getLimitConfig,
  getVilla,
  listVillaEvents,
  villaActivity,
  listVillas,
  rateMessage,
  setLimitConfig,
  setVillaArchived,
  updateVilla,
  VillaLimitError,
} from "./villa-store";
import { VILLA_TEMPLATES, findTemplate } from "./templates";
import {
  getSubscription,
  cancelAtPeriodEnd,
  resumeSubscription,
  upgradeToPro,
} from "./subscription";
import { billingSummary, checkoutAvailability, planCatalog } from "./billing";

const villaNameSchema = z.string().trim().min(1).max(80);
const specialtySchema = z.string().trim().min(1).max(80);
/** Sprint 012 — Kapazitätsgrenze 1–25, Standard 8. */
const capacitySchema = z.number().int().min(1).max(25).default(8);
const descriptionSchema = z.string().trim().max(1000).optional();

function storeError(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  throw new TRPCError({
    code: "SERVICE_UNAVAILABLE",
    message:
      "Die Datenbank ist gerade nicht erreichbar. Villen und Verläufe konnten nicht gespeichert werden.",
  });
}

export const villaRouter = router({
  /** Sprint 017 — eigene Kapazitaetsgrenzen lesen (Nutzer-Sicht). */
  limits: protectedProcedure.query(async ({ ctx }) => {
    try {
      return await getLimitConfig(ctx.user.id);
    } catch (error) {
      storeError(error);
    }
  }),

  /** Sprint 017 — Limit-Konfiguration aendern (nur Admin). */
  setLimits: protectedProcedure
    .input(
      z.object({
        userId: z.number().int().positive(),
        maxVillas: z.number().int().min(1).max(50),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Nur Administratoren dürfen Limits ändern.",
        });
      }
      try {
        return await setLimitConfig(input.userId, input.maxVillas);
      } catch (error) {
        storeError(error);
      }
    }),

  list: protectedProcedure.query(async ({ ctx }) => {
    try {
      return await listVillas(ctx.user.id);
    } catch (error) {
      storeError(error);
    }
  }),

  /**
   * Creates the default project villa for a user who has none yet. Idempotent
   * from the client's perspective (it is only requested when the list is
   * empty); the normal villa limit still applies.
   */
  /** Sprint 103 — SaaS: Subscription-Status + Abrechnung des eigenen Tenants. */
  subscription: protectedProcedure.query(async ({ ctx }) => {
    const state = await getSubscription(ctx.user.id);
    const summary = await billingSummary(ctx.user.id);
    return {
      subscription: {
        plan: state.plan,
        status: state.status,
        trialEndsAt: state.trialEndsAt,
        currentPeriodEnd: state.currentPeriodEnd,
        graceEndsAt: state.graceEndsAt,
        cancelAtPeriodEnd: state.cancelAtPeriodEnd,
      },
      usage: summary,
      checkout: checkoutAvailability(),
    };
  }),

  /** Sprint 103 — Tier-Katalog fuer Onboarding/Paywall. */
  plans: protectedProcedure.query(() => planCatalog()),

  /** Sprint 103 — Kuendigung zum Periodenende (Fairness, nie sofort). */
  subscriptionCancel: protectedProcedure.mutation(async ({ ctx }) => {
    const state = await cancelAtPeriodEnd(ctx.user.id);
    return { status: state.status, cancelAtPeriodEnd: state.cancelAtPeriodEnd };
  }),

  /** Sprint 103 — Kuendigung zuruecknehmen. */
  subscriptionResume: protectedProcedure.mutation(async ({ ctx }) => {
    const state = await resumeSubscription(ctx.user.id);
    return { status: state.status, cancelAtPeriodEnd: state.cancelAtPeriodEnd };
  }),

  /** Sprint 103 — Upgrade auf Pro (nur Admin, bis der Checkout freigegeben ist). */
  subscriptionUpgrade: protectedProcedure.mutation(async ({ ctx }) => {
    if (ctx.user.role !== "admin") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message:
          "Upgrades laufen über den Checkout (nach Admin-Freigabe) oder durch einen Administrator.",
      });
    }
    const state = await upgradeToPro(ctx.user.id);
    return { plan: state.plan, status: state.status };
  }),

  ensureStarter: protectedProcedure.mutation(async ({ ctx }) => {
    try {
      return await ensureStarterVilla(ctx.user.id);
    } catch (error) {
      if (error instanceof VillaLimitError) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Limit erreicht: maximal ${error.maxVillas} Villen. Bitte alte Villen archivieren oder löschen.`,
        });
      }
      storeError(error);
    }
  }),

  create: protectedProcedure
    .input(
      z.object({
        name: villaNameSchema,
        specialty: specialtySchema.default("Neuer Agent"),
        icon: z.enum(["villa", "bot"]).default("bot"),
        projectBrief: z.string().trim().min(3).max(4000).optional(),
        description: descriptionSchema,
        capacity: capacitySchema,
        repository: villaRepositorySchema.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await createVilla({
          createdBy: ctx.user.id,
          name: input.name,
          specialty: input.specialty,
          icon: input.icon,
          projectBrief: input.projectBrief,
          description: input.description,
          capacity: input.capacity,
          repository: input.repository ?? null,
        });
      } catch (error) {
        if (error instanceof VillaLimitError) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `Limit erreicht: maximal ${error.maxVillas} Villen. Bitte alte Villen archivieren oder löschen.`,
          });
        }
        storeError(error);
      }
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        name: villaNameSchema.optional(),
        specialty: specialtySchema.optional(),
        description: z.string().trim().max(1000).nullable().optional(),
        capacity: z.number().int().min(1).max(25).optional(),
        repository: villaRepositorySchema.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const villa = await updateVilla(input.id, ctx.user.id, {
          name: input.name,
          specialty: input.specialty,
          description: input.description,
          capacity: input.capacity,
          repository: input.repository,
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

  /** Sprint 014 — Villa archivieren oder wiederherstellen. */
  archive: protectedProcedure
    .input(z.object({ id: z.number().int().positive(), archived: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const villa = await setVillaArchived(input.id, ctx.user.id, input.archived);
        if (!villa) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Villa nicht gefunden." });
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

  /** Sprint 019 — Aktivitätsübersicht: Zähler je Villa, ohne Inhalte. */
  activity: protectedProcedure.query(async ({ ctx }) => {
    try {
      return await villaActivity(ctx.user.id);
    } catch (error) {
      storeError(error);
    }
  }),

  /** Sprint 018 — Villa als JSON exportieren (nur eigene Villen). */
  export: protectedProcedure
    .input(z.object({ villaId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      try {
        const data = await exportVilla(input.villaId, ctx.user.id);
        if (!data) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Villa nicht gefunden.",
          });
        }
        return data;
      } catch (error) {
        storeError(error);
      }
    }),

  /** Sprint 018 — Villa aus Export anlegen (Kapazität wird erzwungen). */
  import: protectedProcedure
    .input(
      z.object({
        name: villaNameSchema,
        specialty: specialtySchema.default("Importierte Villa"),
        icon: z.enum(["villa", "bot"]).default("bot"),
        projectBrief: z.string().trim().min(3).max(4000).nullable().optional(),
        description: descriptionSchema,
        capacity: capacitySchema,
        messages: z
          .array(
            z.object({
              role: z.enum(["user", "assistant"]),
              content: z.string().min(1).max(25000),
            })
          )
          .max(200)
          .default([]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const villa = await importVilla(ctx.user.id, {
          name: input.name,
          specialty: input.specialty,
          icon: input.icon,
          projectBrief: input.projectBrief,
          description: input.description,
          capacity: input.capacity,
          messages: input.messages,
        });
        return villa;
      } catch (error) {
        if (error instanceof VillaLimitError) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `Limit erreicht: maximal ${error.maxVillas} Villen. Bitte alte Villen archivieren oder löschen.`,
          });
        }
        storeError(error);
      }
    }),

  /** Sprint 013 — Audit-Spur der Villa (letzte 50 Einträge). */
  events: protectedProcedure
    .input(z.object({ villaId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      try {
        return await listVillaEvents(input.villaId, ctx.user.id);
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
        const villa = await getVilla(input.villaId, ctx.user.id);
        if (!villa) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Villa nicht gefunden.",
          });
        }
        if (villa.archivedAt) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Diese Villa ist archiviert und nimmt keine neuen Nachrichten an.",
          });
        }
        // Sprint 017 — Kapazität der Villa erzwingen (Tausend Zeichen je Nachricht).
        const capacityChars = (villa.capacity ?? 8) * 1000;
        for (const message of input.messages) {
          if (message.content.length > capacityChars) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Nachricht überschreitet die Kapazität der Villa (max. ${capacityChars} Zeichen je Nachricht).`,
            });
          }
        }
        const rows = await appendMessages(input.villaId, ctx.user.id, input.messages);
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
  /** Sprint 091 — Verfügbare Projektvorlagen auflisten. */
  templatesList: protectedProcedure.query(() => {
    return VILLA_TEMPLATES.map(t => ({
      id: t.id,
      name: t.name,
      description: t.description,
      villaName: t.villaName,
      specialty: t.specialty,
      icon: t.icon,
      capacity: t.capacity,
    }));
  }),

  /** Sprint 091 — Villa aus einer Vorlage anlegen. */
  createFromTemplate: protectedProcedure
    .input(z.object({ templateId: z.string().trim().min(1).max(40) }))
    .mutation(async ({ ctx, input }) => {
      if (!findTemplate(input.templateId)) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Unbekannte Vorlage.",
        });
      }
      try {
        return await createVillaFromTemplate(ctx.user.id, input.templateId);
      } catch (error) {
        if (error instanceof VillaLimitError) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `Limit erreicht: maximal ${error.maxVillas} Villen. Bitte alte Villen archivieren oder löschen.`,
          });
        }
        storeError(error);
      }
    }),
});
