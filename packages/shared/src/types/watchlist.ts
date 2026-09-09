import { Platform, CheckStatus } from './platform.js';
import { CheckerResult } from './checker.js';
import { SupportedTld } from './coordinator.js';

export interface WatchlistItem {
  id: string;
  userId: string;
  platform: Platform;
  target: string;
  tld?: SupportedTld;
  currentStatus: CheckStatus;
  previousStatus?: CheckStatus | null;
  lastConfidence: number;
  lastCheckedAt?: string | null;
  nextCheckAt: string;
  checkIntervalMinutes: number;
  consecutiveErrors: number;
  consecutiveStableCount: number;
  isActive: boolean;
  metadata?: Record<string, any> | null;
  statusVersion: number;
  createdAt: string;
  updatedAt: string;

  // Backwards-compatibility aliases
  lastStatus?: CheckStatus;
  checkIntervalSeconds?: number;
  consecutiveFailures?: number;
}

export interface CreateWatchlistDto {
  platform: Platform;
  target: string;
  tld?: SupportedTld;
}

export interface UpdateWatchlistDto {
  isActive?: boolean;
  checkIntervalMinutes?: number;
  checkIntervalSeconds?: number;
}

export interface WatchlistCheckNowResponse {
  item: WatchlistItem;
  checkResult: CheckerResult;
  statusChanged: boolean;
  oldStatus: CheckStatus;
  newStatus: CheckStatus;
}

export type NotificationEventType =
  | 'STATUS_CHANGED_AVAILABLE'
  | 'STATUS_CHANGED_TAKEN'
  | 'STATUS_CHANGED_UNKNOWN';

export type NotificationDeliveryStatus = 'DELIVERED' | 'FAILED' | 'BLOCKED' | 'SKIPPED';

export interface NotificationLog {
  id: string;
  watchlistItemId: string;
  userId: string;
  eventType: NotificationEventType;
  oldStatus: CheckStatus;
  newStatus: CheckStatus;
  statusVersion: number;
  sentAt: string;
  telegramMessageId?: string;
  status: NotificationDeliveryStatus;
  errorMessage?: string;
  idempotencyKey: string;
}

export interface WatchlistPlanPolicy {
  maxActiveWatches: number;
  minIntervalMinutes: number;
  defaultIntervalMinutes: number;
  checkNowCooldownSeconds: number;

  // Backwards-compatibility aliases
  minIntervalSeconds?: number;
  defaultIntervalSeconds?: number;
}

