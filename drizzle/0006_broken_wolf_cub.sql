CREATE TABLE "limit_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"maxVillas" integer DEFAULT 20 NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "limit_configs_userId_unique" UNIQUE("userId")
);
--> statement-breakpoint
CREATE INDEX "limit_configs_userId_idx" ON "limit_configs" USING btree ("userId");