import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;


/**
 * A villa is one persisted agent workspace ("Agenten-Villa") of a user.
 * Villas are per-user (createdBy = users.id) and store a display name,
 * a specialty label and an icon key used by the client.
 */
export const villas = mysqlTable("villas", {
  id: int("id").autoincrement().primaryKey(),
  createdBy: int("createdBy").notNull(),
  name: varchar("name", { length: 80 }).notNull(),
  specialty: varchar("specialty", { length: 80 }).notNull().default("Neuer Agent"),
  icon: mysqlEnum("icon", ["villa", "bot"]).default("bot").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Villa = typeof villas.$inferSelect;
export type InsertVilla = typeof villas.$inferInsert;

/**
 * Persisted chat history per villa. Ratings are stored per assistant
 * message (-1 or 1, null = unrated).
 */
export const villaMessages = mysqlTable("villa_messages", {
  id: int("id").autoincrement().primaryKey(),
  villaId: int("villaId").notNull(),
  role: mysqlEnum("role", ["user", "assistant"]).notNull(),
  content: text("content").notNull(),
  provider: varchar("provider", { length: 40 }),
  model: varchar("model", { length: 128 }),
  rating: int("rating"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type VillaMessage = typeof villaMessages.$inferSelect;
export type InsertVillaMessage = typeof villaMessages.$inferInsert;
