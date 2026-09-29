CREATE TABLE "demo_contact_opt_outs" (
	"email" varchar(320) PRIMARY KEY NOT NULL,
	"optedOutAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "demo_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"company" varchar(120) NOT NULL,
	"email" varchar(320) NOT NULL,
	"projectIdea" text NOT NULL,
	"consentedAt" timestamp NOT NULL,
	"consentVersion" varchar(32) NOT NULL,
	"consentText" text NOT NULL,
	"status" varchar(16) DEFAULT 'new' NOT NULL,
	"optedOutAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "demo_requests_createdAt_idx" ON "demo_requests" USING btree ("createdAt");