import crypto from 'node:crypto';
import {
  Platform,
  CheckStatus,
  WatchlistItem,
  CreateWatchlistDto,
  UpdateWatchlistDto,
  WatchlistCheckNowResponse,
  SupportedTld,
} from '@username/shared';
import { CheckerCoordinator } from '@username/checker-engine';
import {
  getDb,
  users,
  watchlistItems,
  eq,
  and,
} from '@username/db';
import { getPlanPolicy } from './user-limits.js';
import { AdaptiveIntervalStrategy } from './adaptive-interval.js';
import { StatusTransitionEngine } from './status-transition.js';
import { DoubleConfirmationService } from './double-confirmation.js';
import { NotificationService } from './notification.service.js';
import { TargetNormalizer } from './target-normalizer.js';

export interface WatchlistServiceOptions {
  coordinator: CheckerCoordinator;
  databaseUrl?: string;
  notificationService?: NotificationService;
  customDoubleConfirmation?: DoubleConfirmationService;
}

export class WatchlistService {
  private readonly coordinator: CheckerCoordinator;
  private readonly databaseUrl?: string;
  private readonly notificationService?: NotificationService;
  private readonly doubleConfirmation: DoubleConfirmationService;

  // In-memory store fallback for offline unit testing without live PostgreSQL
  private readonly inMemoryStore = new Map<string, WatchlistItem>();
  private readonly inMemoryUsers = new Map<string, { id: string; telegramId: number; tier: string }>();

  constructor(options: WatchlistServiceOptions) {
    this.coordinator = options.coordinator;
    this.databaseUrl = options.databaseUrl;
    this.notificationService = options.notificationService;
    this.doubleConfirmation =
      options.customDoubleConfirmation || new DoubleConfirmationService(this.coordinator);
  }

  /**
   * Helper to seed in-memory user for tests without PostgreSQL
   */
  seedUser(user: { id: string; telegramId: number; tier?: string }) {
    this.inMemoryUsers.set(user.id, {
      id: user.id,
      telegramId: user.telegramId,
      tier: user.tier || 'FREE',
    });
  }

  private mapDbRowToItem(r: any): WatchlistItem {
    const currentStatus = (r.currentStatus || r.lastStatus || CheckStatus.UNKNOWN) as CheckStatus;
    const minutes = r.checkIntervalMinutes ?? (r.checkIntervalSeconds ? Math.floor(r.checkIntervalSeconds / 60) : 360);
    const errors = r.consecutiveErrors ?? r.consecutiveFailures ?? 0;
    const stableCount = r.consecutiveStableCount ?? 0;
    const statusVersion = r.statusVersion ?? 1;

    return {
      id: r.id,
      userId: r.userId,
      platform: r.platform as Platform,
      target: r.target,
      tld: (r.tld as SupportedTld) || undefined,
      currentStatus,
      previousStatus: (r.previousStatus as CheckStatus) || null,
      lastConfidence: Number(r.lastConfidence),
      lastCheckedAt: r.lastCheckedAt instanceof Date ? r.lastCheckedAt.toISOString() : (r.lastCheckedAt || null),
      nextCheckAt: r.nextCheckAt instanceof Date ? r.nextCheckAt.toISOString() : r.nextCheckAt,
      checkIntervalMinutes: minutes,
      consecutiveErrors: errors,
      consecutiveStableCount: stableCount,
      isActive: r.isActive,
      metadata: r.metadata || null,
      statusVersion,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
      updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : r.updatedAt,
      // Backwards-compatibility aliases
      lastStatus: currentStatus,
      checkIntervalSeconds: minutes * 60,
      consecutiveFailures: errors,
    };
  }

  private isDbRequired(): boolean {
    const env = process.env.NODE_ENV;
    if (env === 'production' || env === 'staging') {
      return true;
    }
    if (env === 'test' || process.env.OFFLINE_DEV === 'true' || process.env.ALLOW_OFFLINE_STORAGE === 'true') {
      return false;
    }
    return !!(this.databaseUrl || process.env.DATABASE_URL);
  }

  async create(userId: string, dto: CreateWatchlistDto): Promise<WatchlistItem> {
    if (!dto.platform || !Object.values(Platform).includes(dto.platform)) {
      const err = new Error(`Unsupported platform: ${dto.platform}`);
      (err as any).statusCode = 400;
      throw err;
    }

    // Instagram is deferred to later phases
    if (dto.platform === Platform.INSTAGRAM) {
      const err = new Error('Platform INSTAGRAM is not supported in Phase 1D');
      (err as any).statusCode = 400;
      throw err;
    }

    // Platform-specific normalization and validation rules (Telegram, YouTube, Domain)
    const { target, tld } = TargetNormalizer.normalize(dto.platform, dto.target, dto.tld);

    // 1. Check user tier and active limits
    let userTier = 'FREE';
    try {
      const db = getDb(this.databaseUrl);
      const [dbUser] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (dbUser) {
        userTier = dbUser.tier;
      }
    } catch (err: any) {
      if (this.isDbRequired()) {
        console.error('[WatchlistService DB Error] user lookup failed:', err.message);
        const serviceErr = new Error('Database service is temporarily unavailable');
        (serviceErr as any).statusCode = 503;
        throw serviceErr;
      }
      const memUser = this.inMemoryUsers.get(userId);
      if (memUser) userTier = memUser.tier;
    }

    const policy = getPlanPolicy(userTier);

    // Count current active watches and check duplicates
    let activeCount = 0;
    try {
      const db = getDb(this.databaseUrl);
      const existingActive = await db
        .select()
        .from(watchlistItems)
        .where(and(eq(watchlistItems.userId, userId), eq(watchlistItems.isActive, true)));
      activeCount = existingActive.length;

      // Duplicate check: same (userId, platform, target)
      const duplicate = existingActive.find(
        w => w.platform === dto.platform && w.target.toLowerCase() === target.toLowerCase()
      );
      if (duplicate) {
        const err = new Error(`You are already monitoring ${target} on ${dto.platform}`);
        (err as any).statusCode = 409;
        throw err;
      }
    } catch (err: any) {
      if (err.statusCode === 409) throw err;
      if (this.isDbRequired()) {
        console.error('[WatchlistService DB Error] active count check failed:', err.message);
        const serviceErr = new Error('Database service is temporarily unavailable');
        (serviceErr as any).statusCode = 503;
        throw serviceErr;
      }
      // In-memory fallback
      const userItems = Array.from(this.inMemoryStore.values()).filter(
        w => w.userId === userId && w.isActive
      );
      activeCount = userItems.length;
      const dup = userItems.find(
        w => w.platform === dto.platform && w.target.toLowerCase() === target.toLowerCase()
      );
      if (dup) {
        const dupErr = new Error(`You are already monitoring ${target} on ${dto.platform}`);
        (dupErr as any).statusCode = 409;
        throw dupErr;
      }
    }

    if (activeCount >= policy.maxActiveWatches) {
      const err = new Error(
        `Active watchlist limit exceeded (${policy.maxActiveWatches} for ${userTier} plan)`
      );
      (err as any).statusCode = 403;
      throw err;
    }

    // 2. Perform initial check
    const initialCheck = await this.coordinator.checkSingle(dto.platform, target);

    const now = new Date();
    const intervalMinutes = Math.max(60, policy.defaultIntervalMinutes);
    const nextCheckDate = new Date(now.getTime() + intervalMinutes * 60000);

    const newItem: WatchlistItem = {
      id: crypto.randomUUID(),
      userId,
      platform: dto.platform,
      target,
      tld,
      currentStatus: initialCheck.status,
      previousStatus: null,
      lastConfidence: initialCheck.confidence,
      lastCheckedAt: now.toISOString(),
      nextCheckAt: nextCheckDate.toISOString(),
      checkIntervalMinutes: intervalMinutes,
      consecutiveErrors: initialCheck.status === CheckStatus.ERROR ? 1 : 0,
      consecutiveStableCount: initialCheck.status === CheckStatus.TAKEN ? 1 : 0,
      isActive: true,
      metadata: null,
      statusVersion: 1,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      // Aliases
      lastStatus: initialCheck.status,
      checkIntervalSeconds: intervalMinutes * 60,
      consecutiveFailures: initialCheck.status === CheckStatus.ERROR ? 1 : 0,
    };

    // 3. Persist to DB or in-memory
    try {
      const db = getDb(this.databaseUrl);
      const [inserted] = await db
        .insert(watchlistItems)
        .values({
          id: newItem.id,
          userId: newItem.userId,
          platform: newItem.platform,
          target: newItem.target,
          tld: newItem.tld,
          currentStatus: newItem.currentStatus,
          previousStatus: null,
          lastConfidence: newItem.lastConfidence.toFixed(2),
          lastCheckedAt: now,
          nextCheckAt: nextCheckDate,
          checkIntervalMinutes: newItem.checkIntervalMinutes,
          consecutiveErrors: newItem.consecutiveErrors,
          consecutiveStableCount: newItem.consecutiveStableCount,
          isActive: newItem.isActive,
          metadata: null,
          statusVersion: 1,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      if (inserted) {
        return this.mapDbRowToItem(inserted);
      }
    } catch (err: any) {
      if (err.statusCode) throw err;
      if (this.isDbRequired()) {
        console.error('[WatchlistService DB Error] insert item failed:', err.message);
        const serviceErr = new Error('Database service is temporarily unavailable');
        (serviceErr as any).statusCode = 503;
        throw serviceErr;
      }
      // Fallback
      this.inMemoryStore.set(newItem.id, newItem);
      return newItem;
    }

    this.inMemoryStore.set(newItem.id, newItem);
    return newItem;
  }

  /**
   * Batch watchlist creation with atomic quota preflight check and syntax validation.
   */
  async createBatch(
    userId: string,
    items: Array<{ target?: string; username?: string; platform: Platform; tld?: SupportedTld }>
  ): Promise<{
    created: WatchlistItem[];
    totalRequested: number;
    totalCreated: number;
  }> {
    if (!items || !Array.isArray(items) || items.length === 0) {
      const err = new Error('Field "items" must be a non-empty array of watchlist items');
      (err as any).statusCode = 400;
      throw err;
    }

    if (items.length > 20) {
      const err = new Error('Batch size cannot exceed 20 items per request');
      (err as any).statusCode = 400;
      throw err;
    }

    // 1. Validation & normalization upfront
    const normalizedItems: Array<{ target: string; platform: Platform; tld?: SupportedTld }> = [];
    const seenInBatch = new Set<string>();

    for (const it of items) {
      const rawTarget = it.target || it.username;
      if (!rawTarget || typeof rawTarget !== 'string' || !rawTarget.trim()) {
        const err = new Error('Each item must contain a valid non-empty "target" or "username"');
        (err as any).statusCode = 400;
        throw err;
      }
      if (!it.platform || !Object.values(Platform).includes(it.platform)) {
        const err = new Error(`Unsupported platform: ${it.platform}`);
        (err as any).statusCode = 400;
        throw err;
      }
      if (it.platform === Platform.INSTAGRAM) {
        const err = new Error('Platform INSTAGRAM is not supported in Phase 1D');
        (err as any).statusCode = 400;
        throw err;
      }

      const { target, tld } = TargetNormalizer.normalize(it.platform, rawTarget.trim(), it.tld);
      const batchKey = `${it.platform}:${target.toLowerCase()}`;
      if (seenInBatch.has(batchKey)) {
        const err = new Error(`Duplicate item within batch: ${target} on ${it.platform}`);
        (err as any).statusCode = 400;
        throw err;
      }
      seenInBatch.add(batchKey);
      normalizedItems.push({ target, platform: it.platform, tld });
    }

    // 2. Preflight Quota & Active Watches Check
    let userTier = 'FREE';
    let activeCount = 0;
    const existingWatches = new Set<string>();

    try {
      const db = getDb(this.databaseUrl);
      const [dbUser] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (dbUser) userTier = dbUser.tier;

      const activeList = await db
        .select()
        .from(watchlistItems)
        .where(and(eq(watchlistItems.userId, userId), eq(watchlistItems.isActive, true)));
      activeCount = activeList.length;
      for (const w of activeList) {
        existingWatches.add(`${w.platform}:${w.target.toLowerCase()}`);
      }
    } catch (err: any) {
      if (this.isDbRequired()) {
        console.error('[WatchlistService DB Error] createBatch preflight failed:', err.message);
        const serviceErr = new Error('Database service is temporarily unavailable');
        (serviceErr as any).statusCode = 503;
        throw serviceErr;
      }
      const memUser = this.inMemoryUsers.get(userId);
      if (memUser) userTier = memUser.tier;
      const memItems = Array.from(this.inMemoryStore.values()).filter(w => w.userId === userId && w.isActive);
      activeCount = memItems.length;
      for (const w of memItems) {
        existingWatches.add(`${w.platform}:${w.target.toLowerCase()}`);
      }
    }

    const policy = getPlanPolicy(userTier);
    const availableSlots = policy.maxActiveWatches - activeCount;

    // Reject entire batch atomically if remaining quota is exceeded
    if (normalizedItems.length > availableSlots) {
      const err = new Error(
        `Insufficient watchlist slots available. Requested: ${normalizedItems.length}, Available: ${Math.max(0, availableSlots)} (Plan: ${userTier}, Limit: ${policy.maxActiveWatches}). Please upgrade or reduce items.`
      );
      (err as any).statusCode = 400;
      throw err;
    }

    // Reject entire batch if any item is already being watched
    for (const it of normalizedItems) {
      const key = `${it.platform}:${it.target.toLowerCase()}`;
      if (existingWatches.has(key)) {
        const err = new Error(`You are already monitoring ${it.target} on ${it.platform}`);
        (err as any).statusCode = 409;
        throw err;
      }
    }

    // 3. Create all items sequentially
    const created: WatchlistItem[] = [];
    for (const it of normalizedItems) {
      const item = await this.create(userId, {
        platform: it.platform,
        target: it.target,
        tld: it.tld,
      });
      created.push(item);
    }

    return {
      created,
      totalRequested: items.length,
      totalCreated: created.length,
    };
  }

  async list(userId: string): Promise<WatchlistItem[]> {
    try {
      const db = getDb(this.databaseUrl);
      const rows = await db
        .select()
        .from(watchlistItems)
        .where(eq(watchlistItems.userId, userId));

      return rows.map(r => this.mapDbRowToItem(r));
    } catch (err: any) {
      if (this.isDbRequired()) {
        console.error('[WatchlistService DB Error] list items failed:', err.message);
        const serviceErr = new Error('Database service is temporarily unavailable');
        (serviceErr as any).statusCode = 503;
        throw serviceErr;
      }
      return Array.from(this.inMemoryStore.values())
        .filter(w => w.userId === userId)
        .map(w => this.mapDbRowToItem(w));
    }
  }

  async getById(userId: string, id: string): Promise<WatchlistItem> {
    try {
      const db = getDb(this.databaseUrl);
      const [r] = await db
        .select()
        .from(watchlistItems)
        .where(and(eq(watchlistItems.id, id), eq(watchlistItems.userId, userId)))
        .limit(1);

      if (!r) {
        const err = new Error('Watchlist item not found');
        (err as any).statusCode = 404;
        throw err;
      }

      return this.mapDbRowToItem(r);
    } catch (err: any) {
      if (err.statusCode === 404) throw err;
      if (this.isDbRequired()) {
        console.error('[WatchlistService DB Error] getById failed:', err.message);
        const serviceErr = new Error('Database service is temporarily unavailable');
        (serviceErr as any).statusCode = 503;
        throw serviceErr;
      }
      const mem = this.inMemoryStore.get(id);
      if (!mem || mem.userId !== userId) {
        const notFound = new Error('Watchlist item not found');
        (notFound as any).statusCode = 404;
        throw notFound;
      }
      return this.mapDbRowToItem(mem);
    }
  }

  async delete(userId: string, id: string): Promise<{ success: boolean; id: string }> {
    // IDOR protection: verifies item exists and belongs to requesting user
    await this.getById(userId, id);

    try {
      const db = getDb(this.databaseUrl);
      await db
        .delete(watchlistItems)
        .where(and(eq(watchlistItems.id, id), eq(watchlistItems.userId, userId)));
    } catch (err: any) {
      if (this.isDbRequired()) {
        console.error('[WatchlistService DB Error] delete item failed:', err.message);
        const serviceErr = new Error('Database service is temporarily unavailable');
        (serviceErr as any).statusCode = 503;
        throw serviceErr;
      }
      this.inMemoryStore.delete(id);
    }

    this.inMemoryStore.delete(id);
    return { success: true, id };
  }

  async update(userId: string, id: string, dto: UpdateWatchlistDto): Promise<WatchlistItem> {
    const existing = await this.getById(userId, id);

    const requestedMinutes =
      dto.checkIntervalMinutes ??
      (dto.checkIntervalSeconds ? Math.floor(dto.checkIntervalSeconds / 60) : undefined);

    const finalMinutes = requestedMinutes !== undefined
      ? Math.max(60, requestedMinutes)
      : existing.checkIntervalMinutes;

    const updated: WatchlistItem = {
      ...existing,
      isActive: dto.isActive !== undefined ? dto.isActive : existing.isActive,
      checkIntervalMinutes: finalMinutes,
      checkIntervalSeconds: finalMinutes * 60,
      updatedAt: new Date().toISOString(),
    };

    try {
      const db = getDb(this.databaseUrl);
      await db
        .update(watchlistItems)
        .set({
          isActive: updated.isActive,
          checkIntervalMinutes: updated.checkIntervalMinutes,
          updatedAt: new Date(),
        })
        .where(and(eq(watchlistItems.id, id), eq(watchlistItems.userId, userId)));
    } catch (err: any) {
      if (this.isDbRequired()) {
        console.error('[WatchlistService DB Error] update item failed:', err.message);
        const serviceErr = new Error('Database service is temporarily unavailable');
        (serviceErr as any).statusCode = 503;
        throw serviceErr;
      }
      this.inMemoryStore.set(id, updated);
    }

    this.inMemoryStore.set(id, updated);
    return updated;
  }

  /**
   * Immediate user-initiated check with cooldown rate limiting and double confirmation.
   */
  async checkNow(userId: string, id: string): Promise<WatchlistCheckNowResponse> {
    const item = await this.getById(userId, id);

    // Rate-limit check-now cooldown per policy
    let userTier = 'FREE';
    try {
      const db = getDb(this.databaseUrl);
      const [dbUser] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (dbUser) userTier = dbUser.tier;
    } catch {
      const memUser = this.inMemoryUsers.get(userId);
      if (memUser) userTier = memUser.tier;
    }

    const policy = getPlanPolicy(userTier);
    if (item.lastCheckedAt) {
      const lastCheckTime = new Date(item.lastCheckedAt).getTime();
      const elapsedSeconds = (Date.now() - lastCheckTime) / 1000;
      if (elapsedSeconds < policy.checkNowCooldownSeconds) {
        const remaining = Math.ceil(policy.checkNowCooldownSeconds - elapsedSeconds);
        const err = new Error(`Please wait ${remaining}s before checking this item again`);
        (err as any).statusCode = 429;
        throw err;
      }
    }

    // Force fresh check bypassing cache
    const checkResult = await this.coordinator.checkSingle(item.platform, item.target, {
      forceFresh: true,
    });

    const oldStatus = item.currentStatus || item.lastStatus || CheckStatus.UNKNOWN;
    let newStatus = checkResult.status;
    let confidence = checkResult.confidence;

    // Transition logic
    const decision = StatusTransitionEngine.evaluate(oldStatus, newStatus, confidence);

    if (decision.shouldNotify && decision.requiresDoubleConfirmation) {
      const doubleCheck = await this.doubleConfirmation.confirmAvailability(
        item.platform,
        item.target
      );
      if (!doubleCheck.confirmed) {
        // Did not pass double confirmation (e.g. Telegram Safe Hold or unstable availability)
        newStatus = doubleCheck.secondResult.status;
        confidence = doubleCheck.secondResult.confidence;
      }
    }

    const statusChanged = oldStatus !== newStatus;
    const consecutiveErrors =
      newStatus === CheckStatus.ERROR || newStatus === CheckStatus.RATE_LIMITED
        ? item.consecutiveErrors + 1
        : 0;

    const consecutiveStableCount =
      statusChanged
        ? (newStatus === CheckStatus.TAKEN ? 1 : 0)
        : (newStatus === CheckStatus.TAKEN ? item.consecutiveStableCount + 1 : 0);

    const statusVersion = statusChanged ? item.statusVersion + 1 : item.statusVersion;

    const nextIntervalMinutes = AdaptiveIntervalStrategy.calculateNextInterval({
      currentIntervalMinutes: item.checkIntervalMinutes,
      status: newStatus,
      consecutiveErrors,
      consecutiveStableCount,
      minIntervalMinutes: policy.minIntervalMinutes,
    });

    const now = new Date();
    const nextCheckDate = new Date(now.getTime() + nextIntervalMinutes * 60000);

    const updatedItem: WatchlistItem = {
      ...item,
      currentStatus: newStatus,
      previousStatus: statusChanged ? oldStatus : item.previousStatus,
      lastStatus: newStatus,
      lastConfidence: confidence,
      lastCheckedAt: now.toISOString(),
      nextCheckAt: nextCheckDate.toISOString(),
      checkIntervalMinutes: nextIntervalMinutes,
      checkIntervalSeconds: nextIntervalMinutes * 60,
      consecutiveErrors,
      consecutiveFailures: consecutiveErrors,
      consecutiveStableCount,
      statusVersion,
      updatedAt: now.toISOString(),
    };

    try {
      const db = getDb(this.databaseUrl);
      await db
        .update(watchlistItems)
        .set({
          currentStatus: newStatus,
          previousStatus: statusChanged ? oldStatus : item.previousStatus,
          lastConfidence: confidence.toFixed(2),
          lastCheckedAt: now,
          nextCheckAt: nextCheckDate,
          checkIntervalMinutes: nextIntervalMinutes,
          consecutiveErrors,
          consecutiveStableCount,
          statusVersion,
          updatedAt: now,
        })
        .where(eq(watchlistItems.id, id));
    } catch (err: any) {
      if (this.isDbRequired()) {
        console.error('[WatchlistService DB Error] checkNow update failed:', err.message);
        const serviceErr = new Error('Database service is temporarily unavailable');
        (serviceErr as any).statusCode = 503;
        throw serviceErr;
      }
      this.inMemoryStore.set(id, updatedItem);
    }

    this.inMemoryStore.set(id, updatedItem);

    return {
      item: updatedItem,
      checkResult,
      statusChanged,
      oldStatus,
      newStatus,
    };
  }

  /**
   * Internal worker execution for due items.
   */
  async processDueItem(item: WatchlistItem, telegramChatId?: number): Promise<void> {
    // Concurrency / staleness protection: verify item is still active in DB
    try {
      const db = getDb(this.databaseUrl);
      const [fresh] = await db
        .select({ isActive: watchlistItems.isActive })
        .from(watchlistItems)
        .where(eq(watchlistItems.id, item.id))
        .limit(1);
      if (fresh && !fresh.isActive) {
        return; // Item was deactivated or deleted concurrently while queued
      }
    } catch {
      const mem = this.inMemoryStore.get(item.id);
      if (mem && !mem.isActive) return;
    }

    const checkResult = await this.coordinator.checkSingle(item.platform, item.target, {
      forceFresh: true,
    });

    const oldStatus = item.currentStatus || item.lastStatus || CheckStatus.UNKNOWN;
    let newStatus = checkResult.status;
    let confidence = checkResult.confidence;

    const decision = StatusTransitionEngine.evaluate(oldStatus, newStatus, confidence);

    let confirmedForAlert = false;
    if (decision.shouldNotify && decision.requiresDoubleConfirmation) {
      const doubleCheck = await this.doubleConfirmation.confirmAvailability(
        item.platform,
        item.target
      );
      if (doubleCheck.confirmed) {
        confirmedForAlert = true;
      } else {
        newStatus = doubleCheck.secondResult.status;
        confidence = doubleCheck.secondResult.confidence;
      }
    } else if (decision.shouldNotify && !decision.requiresDoubleConfirmation) {
      confirmedForAlert = true;
    }

    const statusChanged = oldStatus !== newStatus;
    const statusVersion = statusChanged ? item.statusVersion + 1 : item.statusVersion;

    const consecutiveErrors =
      newStatus === CheckStatus.ERROR || newStatus === CheckStatus.RATE_LIMITED
        ? item.consecutiveErrors + 1
        : 0;

    const consecutiveStableCount =
      statusChanged
        ? (newStatus === CheckStatus.TAKEN ? 1 : 0)
        : (newStatus === CheckStatus.TAKEN ? item.consecutiveStableCount + 1 : 0);

    const nextIntervalMinutes = AdaptiveIntervalStrategy.calculateNextInterval({
      currentIntervalMinutes: item.checkIntervalMinutes,
      status: newStatus,
      consecutiveErrors,
      consecutiveStableCount,
      minIntervalMinutes: 60,
    });

    const now = new Date();
    const nextCheckDate = new Date(now.getTime() + nextIntervalMinutes * 60000);

    // Update DB
    try {
      const db = getDb(this.databaseUrl);
      await db
        .update(watchlistItems)
        .set({
          currentStatus: newStatus,
          previousStatus: statusChanged ? oldStatus : item.previousStatus,
          lastConfidence: confidence.toFixed(2),
          lastCheckedAt: now,
          nextCheckAt: nextCheckDate,
          checkIntervalMinutes: nextIntervalMinutes,
          consecutiveErrors,
          consecutiveStableCount,
          statusVersion,
          updatedAt: now,
        })
        .where(eq(watchlistItems.id, item.id));
    } catch {
      const mem = this.inMemoryStore.get(item.id);
      if (mem) {
        this.inMemoryStore.set(item.id, {
          ...mem,
          currentStatus: newStatus,
          previousStatus: statusChanged ? oldStatus : mem.previousStatus,
          lastStatus: newStatus,
          lastConfidence: confidence,
          lastCheckedAt: now.toISOString(),
          nextCheckAt: nextCheckDate.toISOString(),
          checkIntervalMinutes: nextIntervalMinutes,
          checkIntervalSeconds: nextIntervalMinutes * 60,
          consecutiveErrors,
          consecutiveFailures: consecutiveErrors,
          consecutiveStableCount,
          statusVersion,
        });
      }
    }

    // Send notification if confirmed
    if (confirmedForAlert && telegramChatId && this.notificationService && decision.eventType) {
      await this.notificationService.sendNotification({
        watchItemId: item.id,
        userId: item.userId,
        telegramChatId,
        platform: item.platform,
        target: item.target,
        eventType: decision.eventType,
        oldStatus,
        newStatus,
        statusVersion,
        confidence,
      });
    }
  }
}
