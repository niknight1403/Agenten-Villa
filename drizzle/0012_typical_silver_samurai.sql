CREATE TABLE "villa_run_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"runId" integer NOT NULL,
	"level" varchar(16) DEFAULT 'info' NOT NULL,
	"message" varchar(400) NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "villa_run_events_runId_idx" ON "villa_run_events" USING btree ("runId");