-- Initial schema for Phase 1A
CREATE TABLE IF NOT EXISTS "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "telegram_id" bigint NOT NULL UNIQUE,
  "username" varchar(64),
  "first_name" varchar(128) NOT NULL,
  "last_name" varchar(128),
  "language_code" varchar(8) DEFAULT 'en',
  "tier" varchar(16) DEFAULT 'FREE' NOT NULL,
  "daily_searches_used" integer DEFAULT 0 NOT NULL,
  "is_blocked" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_users_telegram_id" ON "users" ("telegram_id");

CREATE TABLE IF NOT EXISTS "searches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "query" varchar(128) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_searches_user_id" ON "searches" ("user_id");

CREATE TABLE IF NOT EXISTS "platform_checks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "search_id" uuid REFERENCES "searches"("id") ON DELETE SET NULL,
  "platform" varchar(32) NOT NULL,
  "username" varchar(64) NOT NULL,
  "status" varchar(16) NOT NULL,
  "confidence" numeric(3, 2) DEFAULT '1.00' NOT NULL,
  "source" varchar(32) NOT NULL,
  "response_time_ms" integer NOT NULL,
  "checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_checks_platform_username" ON "platform_checks" ("platform", "username");
CREATE INDEX IF NOT EXISTS "idx_checks_checked_at" ON "platform_checks" ("checked_at");
