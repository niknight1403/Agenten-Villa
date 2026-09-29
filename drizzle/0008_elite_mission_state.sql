CREATE TABLE "elite_mission_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"idempotencyKey" varchar(100) NOT NULL,
	"requestHash" varchar(64) NOT NULL,
	"input" jsonb NOT NULL,
	"status" varchar(16) NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"ownerId" varchar(36) NOT NULL,
	"leaseUntil" timestamp NOT NULL,
	"result" jsonb,
	"errorCode" varchar(40),
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"finishedAt" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX "elite_mission_user_key_unique" ON "elite_mission_runs" USING btree ("userId","idempotencyKey");--> statement-breakpoint
CREATE INDEX "elite_mission_user_created_idx" ON "elite_mission_runs" USING btree ("userId","createdAt");