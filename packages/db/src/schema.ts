import { pgTable, uuid, varchar, bigint, integer, boolean, timestamp, numeric, text, index, uniqueIndex, jsonb } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  telegramId: bigint('telegram_id', { mode: 'number' }).notNull().unique(),
  username: varchar('username', { length: 64 }),
  firstName: varchar('first_name', { length: 128 }).notNull(),
  lastName: varchar('last_name', { length: 128 }),
  languageCode: varchar('language_code', { length: 8 }).default('en'),
  tier: varchar('tier', { length: 16 }).notNull().default('FREE'),
  dailySearchesUsed: integer('daily_searches_used').notNull().default(0),
  isBlocked: boolean('is_blocked').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table: any) => [
  index('idx_users_telegram_id').on(table.telegramId),
]);

export const searches = pgTable('searches', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  query: varchar('query', { length: 128 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table: any) => [
  index('idx_searches_user_id').on(table.userId),
]);

export const platformChecks = pgTable('platform_checks', {
  id: uuid('id').primaryKey().defaultRandom(),
  searchId: uuid('search_id').references(() => searches.id, { onDelete: 'set null' }),
  platform: varchar('platform', { length: 32 }).notNull(),
  username: varchar('username', { length: 64 }).notNull(),
  status: varchar('status', { length: 16 }).notNull(),
  confidence: numeric('confidence', { precision: 3, scale: 2 }).notNull().default('1.00'),
  source: varchar('source', { length: 32 }).notNull(),
  responseTimeMs: integer('response_time_ms').notNull(),
  checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
}, (table: any) => [
  index('idx_checks_platform_username').on(table.platform, table.username),
  index('idx_checks_checked_at').on(table.checkedAt),
]);

export const watchlistItems = pgTable('watchlist_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  platform: varchar('platform', { length: 32 }).notNull(),
  target: varchar('target', { length: 255 }).notNull(),
  tld: varchar('tld', { length: 16 }),
  currentStatus: varchar('current_status', { length: 32 }).notNull().default('UNKNOWN'),
  previousStatus: varchar('previous_status', { length: 32 }),
  lastConfidence: numeric('last_confidence', { precision: 3, scale: 2 }).notNull().default('0.00'),
  lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
  nextCheckAt: timestamp('next_check_at', { withTimezone: true }).notNull().defaultNow(),
  checkIntervalMinutes: integer('check_interval_minutes').notNull().default(360), // default 6h = 360m
  consecutiveErrors: integer('consecutive_errors').notNull().default(0),
  consecutiveStableCount: integer('consecutive_stable_count').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  metadata: jsonb('metadata'),
  statusVersion: integer('status_version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table: any) => [
  index('idx_watchlist_user_id').on(table.userId),
  index('idx_watchlist_next_check_at').on(table.nextCheckAt),
  index('idx_watchlist_platform').on(table.platform),
  index('idx_watchlist_is_active').on(table.isActive),
  uniqueIndex('idx_watchlist_user_platform_target_active').on(table.userId, table.platform, table.target).where(sql`is_active = true`),
]);

export const notificationLogs = pgTable('notification_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  watchlistItemId: uuid('watchlist_item_id').notNull().references(() => watchlistItems.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  eventType: varchar('event_type', { length: 32 }).notNull(),
  oldStatus: varchar('old_status', { length: 32 }).notNull(),
  newStatus: varchar('new_status', { length: 32 }).notNull(),
  statusVersion: integer('status_version').notNull().default(1),
  sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  telegramMessageId: varchar('telegram_message_id', { length: 64 }),
  status: varchar('status', { length: 32 }).notNull(),
  errorMessage: text('error_message'),
  idempotencyKey: varchar('idempotency_key', { length: 255 }).notNull().unique(),
}, (table: any) => [
  index('idx_notifications_user_id').on(table.userId),
  index('idx_notifications_watchlist_item_id').on(table.watchlistItemId),
  index('idx_notifications_sent_at').on(table.sentAt),
]);

