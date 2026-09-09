-- Phase 1D.1 / 1E: Watchlist Data Integrity & Reliability Non-Destructive Migration

-- Safely add check_interval_minutes and convert existing check_interval_seconds
ALTER TABLE "watchlist_items" 
  ADD COLUMN IF NOT EXISTS "check_interval_minutes" integer DEFAULT 360 NOT NULL;

DO $$ 
BEGIN 
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='watchlist_items' AND column_name='check_interval_seconds'
  ) THEN 
    UPDATE "watchlist_items" 
    SET "check_interval_minutes" = GREATEST(60, ROUND("check_interval_seconds" / 60.0))
    WHERE "check_interval_minutes" = 360;

    ALTER TABLE "watchlist_items" DROP COLUMN "check_interval_seconds";
  END IF; 
END $$;

-- Safely rename last_status to current_status if last_status exists
DO $$ 
BEGIN 
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='watchlist_items' AND column_name='last_status'
  ) THEN 
    ALTER TABLE "watchlist_items" RENAME COLUMN "last_status" TO "current_status"; 
  END IF; 
END $$;

-- Safely rename consecutive_failures to consecutive_errors if consecutive_failures exists
DO $$ 
BEGIN 
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='watchlist_items' AND column_name='consecutive_failures'
  ) THEN 
    ALTER TABLE "watchlist_items" RENAME COLUMN "consecutive_failures" TO "consecutive_errors"; 
  END IF; 
END $$;

-- Add new columns with safe defaults
ALTER TABLE "watchlist_items"
  ADD COLUMN IF NOT EXISTS "previous_status" varchar(32),
  ADD COLUMN IF NOT EXISTS "consecutive_stable_count" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "metadata" jsonb,
  ADD COLUMN IF NOT EXISTS "status_version" integer DEFAULT 1 NOT NULL;

-- Notification logs status version
ALTER TABLE "notification_logs"
  ADD COLUMN IF NOT EXISTS "status_version" integer DEFAULT 1 NOT NULL;

-- Partial unique index for active watches: user_id, platform, target
DROP INDEX IF EXISTS "idx_watchlist_user_platform_target_active";
CREATE UNIQUE INDEX IF NOT EXISTS "idx_watchlist_user_platform_target_active"
  ON "watchlist_items" ("user_id", "platform", "target")
  WHERE is_active = true;
