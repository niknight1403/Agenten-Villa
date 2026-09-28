CREATE TABLE "agent_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"createdBy" integer NOT NULL,
	"name" varchar(80) NOT NULL,
	"role" varchar(20) DEFAULT 'entwicklung' NOT NULL,
	"taskProfile" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "villas" ADD COLUMN "profileId" integer;--> statement-breakpoint
CREATE INDEX "agent_profiles_createdBy_idx" ON "agent_profiles" USING btree ("createdBy");