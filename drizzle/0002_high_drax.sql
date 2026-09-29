ALTER TABLE "villas" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "villas" ADD COLUMN "capacity" integer DEFAULT 8 NOT NULL;--> statement-breakpoint
ALTER TABLE "villas" ADD COLUMN "archivedAt" timestamp;