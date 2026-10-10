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
import {
  listPersonas,
  createPersona,
  updatePersona,
  seedPersonasIfMissing,
  listAssets,
  createAssetJob,
  advanceAsset,
  listSlots,
  persistPlannedSlots,
  setSlotDraft,
  reviewSlot,
  TRPCSlotError,
  PersonaDisclosureError,
} from "./persona-store";
import { planSlots, buildSlotPrompt } from "./content-scheduler";
import {
  listAffiliateLinks,
  createAffiliateLink,
  registerAffiliateClick,
  listSponsorshipDeals,
  createSponsorshipLead,
  advanceSponsorship,
  listMerch,
  createMerchProduct,
} from "./monetization-store";
import { TIER_BENEFITS, contentTierForPlan } from "./monetization";
import {
  recordSignals,
  listSignals,
  listHypotheses,
  generateHypotheses,
  decideHypothesis,
  listLoopRuns,
  executiveLoopTick,
} from "./revenue-store";
import { discoveryPeriod } from "./revenue-discovery";
import { LOOP_ORDER } from "./executive-loop";

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

  /* ================================================================
   * Sprint 103 / Master-Prompt Abschnitt 3 —
   * Transparenz KI-Influencer & Reichweiten-Engine
   * ================================================================ */

  /** 3.1 — Personas auflisten (Schreibzugriff nur Admin). */
  personaList: protectedProcedure.query(async () => {
    try {
      return { personas: await listPersonas() };
    } catch {
      throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Personas sind gerade nicht abrufbar." });
    }
  }),

  /** 3.1 — Idempotenter Seed der drei Start-Personas (nur Admin). */
  personaSeed: protectedProcedure.mutation(async ({ ctx }) => {
    if (ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: "Nur Administratoren pflegen Personas." });
    }
    try {
      return await seedPersonasIfMissing();
    } catch {
      throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Seed fehlgeschlagen (DB nicht erreichbar)." });
    }
  }),

  /** 3.1 — Persona anlegen (Admin; AI-Kennzeichnung ist Pflicht). */
  personaCreate: protectedProcedure
    .input(
      z.object({
        handle: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,64}$/),
        displayName: z.string().trim().min(1).max(120),
        tagline: z.string().trim().max(240).optional(),
        styleguide: z.string().max(20000).optional(),
        characterSheet: z.record(z.string(), z.unknown()).optional(),
        systemPrompt: z.string().min(1),
        themes: z.array(z.string().trim().min(1).max(120)).min(1),
        channels: z.array(z.string().trim().min(1).max(32)).min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Nur Administratoren legen Personas an." });
      }
      try {
        const persona = await createPersona(input);
        return { id: persona.id, handle: persona.handle };
      } catch (error) {
        if (error instanceof PersonaDisclosureError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
        }
        throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Persona konnte nicht gespeichert werden." });
      }
    }),

  /** 3.1 — Asset-Pipeline: Jobs auflisten/anlegen/weiterfuehren (Admin). */
  assetList: protectedProcedure.query(async ({ ctx, input }) => {
    if (ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: "Asset-Verwaltung ist Administratoren vorbehalten." });
    }
    return { assets: await listAssets((input as { personaId?: number } | undefined)?.personaId) };
  }),

  assetCreate: protectedProcedure
    .input(z.object({ personaId: z.number().int().positive(), kind: z.enum(["image", "text", "style"]), prompt: z.string().trim().min(1).max(2000) }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Asset-Verwaltung ist Administratoren vorbehalten." });
      }
      return createAssetJob(input);
    }),

  /** 3.2 — Slots planen (deterministisch) und als 'planned' speichern. */
  contentPlan: protectedProcedure.mutation(async ({ ctx }) => {
    if (ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: "Content-Planung ist Administratoren vorbehalten." });
    }
    try {
      const personas = await listPersonas();
      const planned = planSlots(personas.filter((p) => p.active));
      const rows = await persistPlannedSlots(planned);
      return { planned: rows.length };
    } catch {
      throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Slot-Planung fehlgeschlagen." });
    }
  }),

  /** 3.2 — Slots abrufen (Review-Queue im Dashboard). */
  contentSlots: protectedProcedure.query(async () => {
    try {
      return { slots: await listSlots() };
    } catch {
      throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Slots gerade nicht abrufbar." });
    }
  }),

  /** 3.2 — Slot-Review: approve/reject/publish — NUR Admin (Freigabe-Pflicht). */
  contentReview: protectedProcedure
    .input(z.object({ slotId: z.number().int().positive(), decision: z.enum(["approve", "reject", "publish"]) }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Freigabe und Veroeffentlichung sind Administratoren vorbehalten." });
      }
      try {
        const slot = await reviewSlot(input.slotId, ctx.user.id, input.decision);
        if (!slot) throw new TRPCError({ code: "NOT_FOUND", message: "Slot nicht gefunden." });
        return { id: slot.id, status: slot.status };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        if (error instanceof TRPCSlotError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
        }
        throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Review fehlgeschlagen." });
      }
    }),

  /** 3.2 — Monetarisierung: Affiliate (Admin), Sponsoring (Admin), Merch (alle lesend). */
  affiliateList: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: "Affiliate-Verwaltung ist Administratoren vorbehalten." });
    }
    return { links: await listAffiliateLinks() };
  }),

  affiliateCreate: protectedProcedure
    .input(z.object({ personaId: z.number().int().positive(), label: z.string().trim().min(1).max(120), url: z.string().trim().min(1).max(2000) }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Affiliate-Verwaltung ist Administratoren vorbehalten." });
      }
      try {
        return await createAffiliateLink(input);
      } catch {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Affiliate-Link ungueltig." });
      }
    }),

  affiliateClick: protectedProcedure
    .input(z.object({ linkId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const link = await registerAffiliateClick(input.linkId);
      if (!link) throw new TRPCError({ code: "NOT_FOUND", message: "Link nicht gefunden." });
      return { url: link.url };
    }),

  sponsorshipList: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: "Sponsoring-Pipeline ist Administratoren vorbehalten." });
    }
    return { deals: await listSponsorshipDeals() };
  }),

  sponsorshipCreate: protectedProcedure
    .input(z.object({ personaId: z.number().int().positive(), sponsor: z.string().trim().min(1).max(160), notes: z.string().max(2000).optional() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Sponsoring-Pipeline ist Administratoren vorbehalten." });
      }
      return createSponsorshipLead(input);
    }),

  sponsorshipAdvance: protectedProcedure
    .input(z.object({ dealId: z.number().int().positive(), to: z.enum(["lead", "contacted", "negotiating", "closed", "declined"]), valueCents: z.number().int().nonnegative().optional() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Sponsoring-Pipeline ist Administratoren vorbehalten." });
      }
      try {
        const deal = await advanceSponsorship(input.dealId, input.to, input.valueCents);
        if (!deal) throw new TRPCError({ code: "NOT_FOUND", message: "Deal nicht gefunden." });
        return { id: deal.id, stage: deal.stage };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({ code: "BAD_REQUEST", message: (error as Error).message });
      }
    }),

  /** Merch-Katalog: alle lesend, Pflege (Admin) via merchCreate. */
  merchList: protectedProcedure.query(async () => {
    return { products: await listMerch(true) };
  }),

  merchCreate: protectedProcedure
    .input(z.object({ name: z.string().trim().min(1).max(160), description: z.string().max(4000).optional(), priceCents: z.number().int().positive(), kind: z.enum(["digital", "physical"]).optional() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Merch-Pflege ist Administratoren vorbehalten." });
      }
      try {
        return await createMerchProduct(input);
      } catch {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Produkt ungueltig (Name, Preis in Cent)." });
      }
    }),

  /** 3.2 — Content-Tiers transparent machen (an Subscription aus 2.2). */
  contentTierBenefits: protectedProcedure.query(async ({ ctx }) => {
    const tier = contentTierForPlan(ctx.user.role === "admin" ? "pro" : "free");
    return { tier, benefits: TIER_BENEFITS[tier] };
  }),

  /* ================================================================
   * Sprint 103 / Master-Prompt Abschnitt 4 —
   * Autonome Umsatzgenerierung & Executive Master-Loop (24/7)
   * ================================================================ */

  /** 4.1 — Loop-Status (Phasen, Intervall) fuer alle lesbar. */
  loopStatus: protectedProcedure.query(async () => {
    return {
      phases: LOOP_ORDER,
      intervalMinutes: 15,
      autonomous: ["analyze", "hypothesize", "simulate", "verify_revenue"],
      adminGated: ["deploy", "refactor_scale"],
    };
  }),

  /** 4.2 — Loop-Verlauf (Admin-Sicht). */
  loopHistory: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: "Loop-Verlauf ist Administratoren vorbehalten." });
    }
    try {
      return { runs: await listLoopRuns(50) };
    } catch {
      throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Loop-Verlauf gerade nicht abrufbar." });
    }
  }),

  /** 4.1 — Signale erfassen (Admin, z. B. aus internen Quellen). */
  revenueSignalRecord: protectedProcedure
    .input(
      z.object({
        signals: z
          .array(
            z.object({
              source: z.enum(["billing", "affiliate", "sponsorship", "merch", "reach", "trading"]),
              key: z.string().trim().min(1).max(64),
              value: z.number().int().nonnegative(),
              period: z.string().regex(/^\d{4}-\d{2}$/).optional(),
            })
          )
          .min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Signalerfassung ist Administratoren vorbehalten." });
      }
      const recorded = await recordSignals(input.signals);
      return { recorded, period: discoveryPeriod() };
    }),

  /** 4.1 — Hypothesen-Liste (Admin). */
  revenueHypothesisList: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: "Hypothesen sind Administratoren vorbehalten." });
    }
    return { hypotheses: await listHypotheses() };
  }),

  /** 4.1 — Hypothesen aus aktuellem Quellenbild ableiten (Admin-Ausstoss). */
  revenueHypothesisGenerate: protectedProcedure.mutation(async ({ ctx }) => {
    if (ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: "Hypothesen-Generierung ist Administratoren vorbehalten." });
    }
    const result = await generateHypotheses({ tradingSimGatePassed: false });
    return { created: result.created.length, skipped: result.skipped };
  }),

  /** 4.1/4.2 — Admin-Entscheidung ueber eine Hypothese (Freigabe-Pflicht). */
  revenueHypothesisDecide: protectedProcedure
    .input(z.object({ hypothesisId: z.number().int().positive(), decision: z.enum(["approve", "reject", "deploy", "scale", "park"]) }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Hypothesen-Freigabe ist Administratoren vorbehalten." });
      }
      try {
        const hypothesis = await decideHypothesis(input.hypothesisId, ctx.user.id, input.decision);
        if (!hypothesis) throw new TRPCError({ code: "NOT_FOUND", message: "Hypothese nicht gefunden." });
        return { id: hypothesis.id, status: hypothesis.status };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({ code: "BAD_REQUEST", message: (error as Error).message });
      }
    }),

  /** 4.2 — Ein Loop-Tick manuell anstossen (Admin; deploy bleibt Gate). */
  loopTick: protectedProcedure
    .input(z.object({ phase: z.enum(["analyze", "hypothesize", "simulate", "deploy", "verify_revenue", "refactor_scale"]) }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Loop-Steuerung ist Administratoren vorbehalten." });
      }
      try {
        const signals = await listSignals();
        const drafts = await listHypotheses("draft");
        const summary: Record<string, number> = {};
        for (const s of signals) {
          const key = `${s.source}:${s.key}`;
          summary[key] = (summary[key] ?? 0) + s.value;
        }
        const approved = await listHypotheses("approved");
        const deployed = await listHypotheses("deployed");
        const expected = [...approved, ...deployed].reduce((sum, h) => sum + h.expectedMonthlyCents, 0);
        const actual = (summary["affiliate:revenue_cents"] ?? 0) + (summary["sponsorship:revenue_cents"] ?? 0) + (summary["merch:revenue_cents"] ?? 0);
        return await executiveLoopTick(
          {
            signalSummary: summary,
            tradingSimGatePassed: false, // Sim-Gate laeuft im Trading-Modul
            draftHypotheses: drafts.length,
            actualMonthlyCents: actual,
            expectedMonthlyCents: expected,
          },
          input.phase
        );
      } catch {
        throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Loop-Tick fehlgeschlagen (DB nicht erreichbar)." });
      }
    }),
});
