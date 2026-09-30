CREATE TABLE "villa_test_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"villaId" integer NOT NULL,
	"actorId" integer NOT NULL,
	"status" varchar(16) NOT NULL,
	"result" jsonb,
	"errorCode" varchar(40),
	"startedAt" timestamp DEFAULT now() NOT NULL,
	"endedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "villa_test_runs_villaId_idx" ON "villa_test_runs" USING btree ("villaId");--> statement-breakpoint
CREATE INDEX "villa_test_runs_actorId_idx" ON "villa_test_runs" USING btree ("actorId");