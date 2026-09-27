import { index, integer, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";

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
  role: varchar("role", { length: 10 }).$type<"user" | "admin">().default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;


/**
 * A villa is one persisted agent workspace ("Agenten-Villa") of a user.
 * Villas are per-user (createdBy = users.id) and store a display name,
 * a specialty label and an icon key used by the client.
 */
export const villas = pgTable("villas", {
  id: serial("id").primaryKey(),
  createdBy: integer("createdBy").notNull(),
  name: varchar("name", { length: 80 }).notNull(),
  specialty: varchar("specialty", { length: 80 }).notNull().default("Neuer Agent"),
  projectBrief: text("projectBrief"),
  icon: varchar("icon", { length: 8 }).$type<"villa" | "bot">().default("bot").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
}, (table) => [index("villas_createdBy_idx").on(table.createdBy)]);

export type Villa = typeof villas.$inferSelect;
export type InsertVilla = typeof villas.$inferInsert;

/**
 * Persisted chat history per villa. Ratings are stored per assistant
 * message (-1 or 1, null = unrated).
 */
export const villaMessages = pgTable("villa_messages", {
  id: serial("id").primaryKey(),
  villaId: integer("villaId").notNull(),
  role: varchar("role", { length: 10 }).$type<"user" | "assistant">().notNull(),
  content: text("content").notNull(),
  provider: varchar("provider", { length: 40 }),
  model: varchar("model", { length: 128 }),
  rating: integer("rating"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [index("villa_messages_villaId_idx").on(table.villaId)]);

export type VillaMessage = typeof villaMessages.$inferSelect;
export type InsertVillaMessage = typeof villaMessages.$inferInsert;

/** Inbound demo requests are private CRM data; only administrators may read them. */
export const demoRequests = pgTable("demo_requests", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  company: varchar("company", { length: 120 }).notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  projectIdea: text("projectIdea").notNull(),
  consentedAt: timestamp("consentedAt").notNull(),
  consentVersion: varchar("consentVersion", { length: 32 }).notNull(),
  consentText: text("consentText").notNull(),
  status: varchar("status", { length: 16 }).$type<"new" | "contacted" | "closed" | "opted_out">().default("new").notNull(),
  optedOutAt: timestamp("optedOutAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
}, (table) => [index("demo_requests_createdAt_idx").on(table.createdAt)]);

export type DemoRequest = typeof demoRequests.$inferSelect;

/** Separate suppression list: prevents new inquiries from reactivating contact. */
export const demoContactOptOuts = pgTable("demo_contact_opt_outs", {
  email: varchar("email", { length: 320 }).primaryKey(),
  optedOutAt: timestamp("optedOutAt").defaultNow().notNull(),
});
