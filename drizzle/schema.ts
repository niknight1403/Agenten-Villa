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
  /** Sprint 012 — kurze Beschreibung der Villa (max. 1000 Zeichen). */
  description: text("description"),
  /** Sprint 012 — Kapazitätsgrenze (1–25), Standard 8; Basis für Sprint 017. */
  capacity: integer("capacity").notNull().default(8),
  /** Sprint 014 — Archivierungszeitpunkt; null = aktiv. */
  archivedAt: timestamp("archivedAt"),
  /** Sprint 015 — zugeordnetes Projekt; eine Villa hat höchstens ein Projekt. */
  projectId: integer("projectId"),
  icon: varchar("icon", { length: 8 }).$type<"villa" | "bot">().default("bot").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
}, (table) => [index("villas_createdBy_idx").on(table.createdBy)]);

export type Villa = typeof villas.$inferSelect;
export type InsertVilla = typeof villas.$inferInsert;

/**
 * Sprint 015 — Projekte: einem Projekt des Eigentümers können eine oder
 * mehrere seiner Villen zugeordnet werden (villa.projectId).
 */
export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  createdBy: integer("createdBy").notNull(),
  name: varchar("name", { length: 80 }).notNull(),
  brief: text("brief"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").$onUpdate(() => new Date()).notNull(),
}, (table) => [index("projects_createdBy_idx").on(table.createdBy)]);

export type Project = typeof projects.$inferSelect;
export type InsertProject = typeof projects.$inferInsert;

/**
 * Sprint 013 — Audit-Spur pro Villa: jede ändernde Aktion (create, update,
 * archive, delete, import) wird mit Zeit, Akteur und serialisiertem Detail
 * festgehalten. Detail enthält ausschließlich nicht-geheime Feldnamen und
 * Werte der Villa selbst.
 */
export const villaEvents = pgTable("villa_events", {
  id: serial("id").primaryKey(),
  villaId: integer("villaId").notNull(),
  actorId: integer("actorId").notNull(),
  action: varchar("action", { length: 32 }).notNull(),
  detail: text("detail").notNull().default("{}"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [index("villa_events_villaId_idx").on(table.villaId)]);

export type VillaEvent = typeof villaEvents.$inferSelect;
export type InsertVillaEvent = typeof villaEvents.$inferInsert;

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
