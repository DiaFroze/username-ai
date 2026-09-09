-- Watchlist & Notification migration for Phase 1D
CREATE TABLE IF NOT EXISTS "watchlist_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "platform" varchar(32) NOT NULL,
  "target" varchar(255) NOT NULL,
  "tld" varchar(16),
  "last_status" varchar(32) DEFAULT 'UNKNOWN' NOT NULL,
  "last_confidence" numeric(3, 2) DEFAULT '0.00' NOT NULL,
  "last_checked_at" timestamp with time zone,
  "next_check_at" timestamp with time zone DEFAULT now() NOT NULL,
  "check_interval_seconds" integer DEFAULT 21600 NOT NULL,
  "consecutive_failures" integer DEFAULT 0 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_watchlist_user_id" ON "watchlist_items" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_watchlist_next_check_at" ON "watchlist_items" ("next_check_at");
CREATE INDEX IF NOT EXISTS "idx_watchlist_platform" ON "watchlist_items" ("platform");
CREATE INDEX IF NOT EXISTS "idx_watchlist_is_active" ON "watchlist_items" ("is_active");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_watchlist_user_platform_target_active" ON "watchlist_items" ("user_id", "platform", "target") WHERE is_active = true;

CREATE TABLE IF NOT EXISTS "notification_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "watchlist_item_id" uuid NOT NULL REFERENCES "watchlist_items"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "event_type" varchar(32) NOT NULL,
  "old_status" varchar(32) NOT NULL,
  "new_status" varchar(32) NOT NULL,
  "sent_at" timestamp with time zone DEFAULT now() NOT NULL,
  "telegram_message_id" varchar(64),
  "status" varchar(32) NOT NULL,
  "error_message" text,
  "idempotency_key" varchar(255) NOT NULL UNIQUE
);

CREATE INDEX IF NOT EXISTS "idx_notifications_user_id" ON "notification_logs" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_notifications_watchlist_item_id" ON "notification_logs" ("watchlist_item_id");
CREATE INDEX IF NOT EXISTS "idx_notifications_sent_at" ON "notification_logs" ("sent_at");
