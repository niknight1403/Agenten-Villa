import {
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = pgTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: serial("id").primaryKey(),
  /** OAuth identifier (openId) returned from the OAuth callback (google:<sub>). Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: varchar("role", { length: 10 })
    .$type<"user" | "admin">()
    .default("user")
    .notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * A villa is one persisted agent workspace ("Agenten-Villa") of a user.
 * Villas are per-user (createdBy = users.id) and store a display name,
 * a specialty label and an icon key used by the client.
 */
export const villas = pgTable(
  "villas",
  {
    id: serial("id").primaryKey(),
    createdBy: integer("createdBy").notNull(),
    name: varchar("name", { length: 80 }).notNull(),
    specialty: varchar("specialty", { length: 80 })
      .notNull()
      .default("Neuer Agent"),
    projectBrief: text("projectBrief"),
    /** Sprint 012 — kurze Beschreibung der Villa (max. 1000 Zeichen). */
    description: text("description"),
    /** Sprint 012 — Kapazitätsgrenze (1–25), Standard 8; Basis für Sprint 017. */
    capacity: integer("capacity").notNull().default(8),
    /** Sprint 014 — Archivierungszeitpunkt; null = aktiv. */
    archivedAt: timestamp("archivedAt"),
    /** Sprint 015 — zugeordnetes Projekt; eine Villa hat höchstens ein Projekt. */
    projectId: integer("projectId"),
    /** Sprint 016 — Superagenten-Profil der Villa (Rolle + Aufgabenprofil). */
    profileId: integer("profileId"),
    icon: varchar("icon", { length: 8 })
      .$type<"villa" | "bot">()
      .default("bot")
      .notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => [index("villas_createdBy_idx").on(table.createdBy)]
);

export type Villa = typeof villas.$inferSelect;
export type InsertVilla = typeof villas.$inferInsert;

/**
 * Sprint 015 — Projekte: einem Projekt des Eigentümers können eine oder
 * mehrere seiner Villen zugeordnet werden (villa.projectId).
 */
export const projects = pgTable(
  "projects",
  {
    id: serial("id").primaryKey(),
    createdBy: integer("createdBy").notNull(),
    name: varchar("name", { length: 80 }).notNull(),
    brief: text("brief"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => [index("projects_createdBy_idx").on(table.createdBy)]
);

export type Project = typeof projects.$inferSelect;
export type InsertProject = typeof projects.$inferInsert;

/**
 * Sprint 016 — Superagenten-Profile: konfigurierbare Rollen und
 * Aufgabenprofile; eine Villa kann genau einem Profil folgen.
 */
export const agentProfiles = pgTable(
  "agent_profiles",
  {
    id: serial("id").primaryKey(),
    createdBy: integer("createdBy").notNull(),
    name: varchar("name", { length: 80 }).notNull(),
    role: varchar("role", { length: 20 })
      .$type<"strategie" | "entwicklung" | "review" | "support">()
      .notNull()
      .default("entwicklung"),
    taskProfile: text("taskProfile"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => [index("agent_profiles_createdBy_idx").on(table.createdBy)]
);

export type AgentProfile = typeof agentProfiles.$inferSelect;
export type InsertAgentProfile = typeof agentProfiles.$inferInsert;

/**
 * Sprint 017 — Kapazitätsgrenzen pro Nutzer, konfigurierbar und erzwungen:
 * maxVillas begrenzt die Zahl aktiver Villen, villa.capacity bleibt die
 * Eingabegrenze je Nachricht (Tausend Zeichen).
 */
export const limitConfigs = pgTable(
  "limit_configs",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId").notNull().unique(),
    maxVillas: integer("maxVillas").notNull().default(20),
    updatedAt: timestamp("updatedAt")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => [index("limit_configs_userId_idx").on(table.userId)]
);

export type LimitConfig = typeof limitConfigs.$inferSelect;

/**
 * Sprint 013 — Audit-Spur pro Villa: jede ändernde Aktion (create, update,
 * archive, delete, import) wird mit Zeit, Akteur und serialisiertem Detail
 * festgehalten. Detail enthält ausschließlich nicht-geheime Feldnamen und
 * Werte der Villa selbst.
 */
export const villaEvents = pgTable(
  "villa_events",
  {
    id: serial("id").primaryKey(),
    villaId: integer("villaId").notNull(),
    actorId: integer("actorId").notNull(),
    action: varchar("action", { length: 32 }).notNull(),
    detail: text("detail").notNull().default("{}"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("villa_events_villaId_idx").on(table.villaId)]
);

export type VillaEvent = typeof villaEvents.$inferSelect;
export type InsertVillaEvent = typeof villaEvents.$inferInsert;

/**
 * Persisted chat history per villa. Ratings are stored per assistant
 * message (-1 or 1, null = unrated).
 */
export const villaMessages = pgTable(
  "villa_messages",
  {
    id: serial("id").primaryKey(),
    villaId: integer("villaId").notNull(),
    role: varchar("role", { length: 10 })
      .$type<"user" | "assistant">()
      .notNull(),
    content: text("content").notNull(),
    provider: varchar("provider", { length: 40 }),
    model: varchar("model", { length: 128 }),
    rating: integer("rating"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("villa_messages_villaId_idx").on(table.villaId)]
);

export type VillaMessage = typeof villaMessages.$inferSelect;
export type InsertVillaMessage = typeof villaMessages.$inferInsert;

/** Inbound demo requests are private CRM data; only administrators may read them. */
export const demoRequests = pgTable(
  "demo_requests",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 100 }).notNull(),
    company: varchar("company", { length: 120 }).notNull(),
    email: varchar("email", { length: 320 }).notNull(),
    projectIdea: text("projectIdea").notNull(),
    consentedAt: timestamp("consentedAt").notNull(),
    consentVersion: varchar("consentVersion", { length: 32 }).notNull(),
    consentText: text("consentText").notNull(),
    status: varchar("status", { length: 16 })
      .$type<"new" | "contacted" | "closed" | "opted_out">()
      .default("new")
      .notNull(),
    optedOutAt: timestamp("optedOutAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => [index("demo_requests_createdAt_idx").on(table.createdAt)]
);

export type DemoRequest = typeof demoRequests.$inferSelect;

/** Separate suppression list: prevents new inquiries from reactivating contact. */
export const demoContactOptOuts = pgTable("demo_contact_opt_outs", {
  email: varchar("email", { length: 320 }).primaryKey(),
  optedOutAt: timestamp("optedOutAt").defaultNow().notNull(),
});

/** Durable ledger for synchronous Elite executions and explicit recovery. */
export const eliteMissionRuns = pgTable(
  "elite_mission_runs",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId").notNull(),
    idempotencyKey: varchar("idempotencyKey", { length: 100 }).notNull(),
    requestHash: varchar("requestHash", { length: 64 }).notNull(),
    input: jsonb("input").notNull(),
    status: varchar("status", { length: 16 })
      .$type<"running" | "completed" | "failed" | "interrupted">()
      .notNull(),
    attempt: integer("attempt").default(1).notNull(),
    ownerId: varchar("ownerId", { length: 36 }).notNull(),
    leaseUntil: timestamp("leaseUntil").notNull(),
    result: jsonb("result"),
    errorCode: varchar("errorCode", { length: 40 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
    finishedAt: timestamp("finishedAt"),
  },
  table => [
    uniqueIndex("elite_mission_user_key_unique").on(
      table.userId,
      table.idempotencyKey
    ),
    index("elite_mission_user_created_idx").on(table.userId, table.createdAt),
  ]
);

export type EliteMissionRun = typeof eliteMissionRuns.$inferSelect;

/**
 * Sprint 021 — Persisted, bounded test runs per villa. Status, start time,
 * end time and result survive restarts; one active run per villa.
 */
/**
 * Sprint 023 — Phasenmodell eines Testlaufs. „result" ist eine Systemphase und
 * wird ausschließlich beim Abschluss gesetzt (vorbereitung -> planung ->
 * ausfuehrung -> pruefung -> ergebnis, sichtbar in run.get/run.list).
 */
/** Sprint 026 — Abbrucharten: manuell (Anwender) vs. technisch. */
export type CancellationKind = "manual" | "technical";

export type RunPhase =
  | "preparation"
  | "planning"
  | "execution"
  | "review"
  | "result";

export const villaTestRuns = pgTable(
  "villa_test_runs",
  {
    id: serial("id").primaryKey(),
    villaId: integer("villaId").notNull(),
    actorId: integer("actorId").notNull(),
    status: varchar("status", { length: 16 })
      .$type<"running" | "succeeded" | "failed" | "cancelled">()
      .notNull(),
    /** Sprint 023 — sichtbare Phase des Laufs (preparation..result). */
    phase: varchar("phase", { length: 16 })
      .$type<RunPhase>()
      .notNull()
      .default("preparation"),
    /**
     * Sprint 024 — Zeitgrenze des Laufs in Sekunden. Fortschritt und Countdown
     * werden ausschließlich aus startedAt + timeLimitSeconds berechnet.
     */
    timeLimitSeconds: integer("timeLimitSeconds").notNull().default(600),
    /**
     * Sprint 026 — Art des Abbruchs, nur gesetzt wenn status = „cancelled":
     * „manual" (Anwender) oder „technical" (Zeitgrenze/Infrastruktur).
     */
    cancellationKind: varchar("cancellationKind", { length: 16 })
      .$type<"manual" | "technical">(),
    result: jsonb("result"),
    errorCode: varchar("errorCode", { length: 40 }),
    startedAt: timestamp("startedAt").defaultNow().notNull(),
    endedAt: timestamp("endedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("villa_test_runs_villaId_idx").on(table.villaId),
    index("villa_test_runs_actorId_idx").on(table.actorId),
  ]
);

/**
 * Sprint 025 — Live-Aktivitätsprotokoll: begrenzte, lokale Ereignisliste je
 * Testlauf. Nur laufende Läufe nehmen Ereignisse auf; die Historie eines
 * abgeschlossenen Laufs bleibt unverändert.
 */
export const villaRunEvents = pgTable(
  "villa_run_events",
  {
    id: serial("id").primaryKey(),
    runId: integer("runId").notNull(),
    level: varchar("level", { length: 16 })
      .$type<"info" | "warn" | "error">()
      .notNull()
      .default("info"),
    message: varchar("message", { length: 400 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("villa_run_events_runId_idx").on(table.runId)]
);

export type VillaRunEvent = typeof villaRunEvents.$inferSelect;
export type InsertVillaRunEvent = typeof villaRunEvents.$inferInsert;
export type VillaTestRun = typeof villaTestRuns.$inferSelect;
export type InsertVillaTestRun = typeof villaTestRuns.$inferInsert;
