CREATE TABLE "executive_loop_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"phase" varchar(32) NOT NULL,
	"outcome" varchar(16) NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"hypothesis_id" integer,
	"started_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "revenue_hypotheses" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" varchar(32) NOT NULL,
	"title" varchar(200) NOT NULL,
	"rationale" text DEFAULT '' NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"expected_monthly_cents" integer DEFAULT 0 NOT NULL,
	"status" varchar(16) DEFAULT 'draft' NOT NULL,
	"reviewed_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "revenue_signals" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" varchar(32) NOT NULL,
	"key" varchar(64) NOT NULL,
	"value" integer NOT NULL,
	"period" varchar(7) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
