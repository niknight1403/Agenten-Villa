CREATE TABLE "telemetry_consents" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"opted_in" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
