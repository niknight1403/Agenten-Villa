CREATE TABLE "projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"createdBy" integer NOT NULL,
	"name" varchar(80) NOT NULL,
	"brief" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "villas" ADD COLUMN "projectId" integer;--> statement-breakpoint
CREATE INDEX "projects_createdBy_idx" ON "projects" USING btree ("createdBy");