ALTER TABLE "villa_test_runs" ADD COLUMN "releasedForResumeAt" timestamp;--> statement-breakpoint
ALTER TABLE "villa_test_runs" ADD COLUMN "resumedFromRunId" integer;