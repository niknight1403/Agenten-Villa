CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"openId" varchar(64) NOT NULL,
	"name" text,
	"email" varchar(320),
	"loginMethod" varchar(64),
	"role" varchar(10) DEFAULT 'user' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"lastSignedIn" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_openId_unique" UNIQUE("openId")
);
--> statement-breakpoint
CREATE TABLE "villa_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"villaId" integer NOT NULL,
	"role" varchar(10) NOT NULL,
	"content" text NOT NULL,
	"provider" varchar(40),
	"model" varchar(128),
	"rating" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "villas" (
	"id" serial PRIMARY KEY NOT NULL,
	"createdBy" integer NOT NULL,
	"name" varchar(80) NOT NULL,
	"specialty" varchar(80) DEFAULT 'Neuer Agent' NOT NULL,
	"icon" varchar(8) DEFAULT 'bot' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "villa_messages_villaId_idx" ON "villa_messages" USING btree ("villaId");--> statement-breakpoint
CREATE INDEX "villas_createdBy_idx" ON "villas" USING btree ("createdBy");