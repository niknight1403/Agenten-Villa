CREATE TABLE "villa_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"villaId" integer NOT NULL,
	"actorId" integer NOT NULL,
	"action" varchar(32) NOT NULL,
	"detail" text DEFAULT '{}' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "villa_events_villaId_idx" ON "villa_events" USING btree ("villaId");