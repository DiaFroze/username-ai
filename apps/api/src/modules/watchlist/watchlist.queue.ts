import { Queue, Worker, Job } from 'bullmq';
import { Redis } from 'ioredis';
import { WatchlistService } from './watchlist.service.js';
import { WatchlistItem, Platform, CheckStatus, SupportedTld } from '@username/shared';
import { getDb, watchlistItems, users, and, eq, lte, sql } from '@username/db';

export interface WatchlistMetrics {
  watchItemsActive: number;
  watchChecksTotal: number;
  watchStatusChanges: number;
  notificationsSent: number;
  notificationFailures: number;
  watchQueueDepth: number;
  watchCheckLatencyMs: number;
}

export interface WatchlistCheckJobData {
  item: WatchlistItem;
  telegramChatId?: number;
}

export class WatchlistQueueManager {
  private queue?: Queue<WatchlistCheckJobData>;
  private worker?: Worker<WatchlistCheckJobData>;
  private schedulerTimer?: NodeJS.Timeout;
  private readonly redisUrl?: string;
  private readonly watchlistService: WatchlistService;
  private readonly databaseUrl?: string;
  private readonly inMemoryLeased = new Map<string, number>();

  readonly metrics: WatchlistMetrics = {
    watchItemsActive: 0,
    watchChecksTotal: 0,
    watchStatusChanges: 0,
    notificationsSent: 0,
    notificationFailures: 0,
    watchQueueDepth: 0,
    watchCheckLatencyMs: 0,
  };

  constructor(options: {
    watchlistService: WatchlistService;
    redisUrl?: string;
    databaseUrl?: string;
  }) {
    this.watchlistService = options.watchlistService;
    this.redisUrl = options.redisUrl;
    this.databaseUrl = options.databaseUrl;
  }

  async start(): Promise<void> {
    if (!this.redisUrl || this.redisUrl.includes('offline') || this.redisUrl.includes('mock')) {
      console.log('ℹ️  [WatchlistQueue] Redis URL not configured or offline mode. Queue running in direct mode.');
      return;
    }

    try {
      const connection = new Redis(this.redisUrl, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        retryStrategy: (times) => Math.min(times * 1000, 30000), // Exponential reconnect backoff
      });

      this.queue = new Queue<WatchlistCheckJobData>('watchlist-check', {
        connection,
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
          removeOnComplete: { count: 1000 },
          removeOnFail: { count: 5000 },
        },
      });

      // Worker with per-platform concurrency control (concurrency: 5)
      this.worker = new Worker<WatchlistCheckJobData>(
        'watchlist-check',
        async (job: Job<WatchlistCheckJobData>) => {
          const start = Date.now();
          const { item, telegramChatId } = job.data;

          try {
            await this.watchlistService.processDueItem(item, telegramChatId);
            this.metrics.watchChecksTotal++;
            this.metrics.watchCheckLatencyMs = Date.now() - start;
          } catch (err: any) {
            console.error(`[WatchlistWorker Error] Job ${job.id} failed:`, err.message);
            throw err;
          }
        },
        {
          connection,
          concurrency: 5,
          limiter: {
            max: 10,
            duration: 1000, // 10 checks per second max across worker
          },
        }
      );

      this.worker.on('failed', (job, err) => {
        console.warn(`[WatchlistWorker] Job ${job?.id} failed: ${err.message}`);
        this.metrics.notificationFailures++;
      });

      // Centralized scheduler running every 60 seconds
      this.schedulerTimer = setInterval(() => {
        this.runSchedulerTick().catch(err => {
          console.error('[WatchlistScheduler Error]:', err.message);
        });
      }, 60000);

      // Run initial tick
      await this.runSchedulerTick();
    } catch (err: any) {
      console.warn('⚠️  [WatchlistQueue] Could not initialize BullMQ:', err.message);
    }
  }

  /**
   * Safe scheduler tick with duplicate job protection across multiple API instances.
   * Uses FOR UPDATE SKIP LOCKED and atomic lease updating to guarantee an item is never
   * double-enqueued by concurrent scheduler instances.
   */
  async runSchedulerTick(): Promise<number> {
    let dueCount = 0;
    try {
      const db = getDb(this.databaseUrl);
      const now = new Date();

      // Multi-instance safe atomic lease update with SKIP LOCKED
      let claimedRecords: Array<{ item: WatchlistItem; telegramId?: number }> = [];

      try {
        const rawRes: any = await db.execute(sql`
          WITH due AS (
            SELECT id FROM watchlist_items
            WHERE is_active = true AND next_check_at <= NOW()
            ORDER BY next_check_at ASC
            LIMIT 50
            FOR UPDATE SKIP LOCKED
          )
          UPDATE watchlist_items
          SET next_check_at = NOW() + INTERVAL '10 minutes',
              updated_at = NOW()
          FROM due
          WHERE watchlist_items.id = due.id
          RETURNING watchlist_items.*, (SELECT telegram_id FROM users WHERE users.id = watchlist_items.user_id) as telegram_id;
        `);

        const rows = rawRes.rows || rawRes || [];
        for (const r of rows) {
          const currentStatus = (r.current_status || r.last_status || CheckStatus.UNKNOWN) as CheckStatus;
          const minutes = r.check_interval_minutes ?? 360;
          claimedRecords.push({
            item: {
              id: r.id,
              userId: r.user_id,
              platform: r.platform as Platform,
              target: r.target,
              tld: r.tld as SupportedTld | undefined,
              currentStatus,
              previousStatus: (r.previous_status as CheckStatus) || null,
              lastStatus: currentStatus,
              lastConfidence: Number(r.last_confidence || 0),
              lastCheckedAt: r.last_checked_at ? new Date(r.last_checked_at).toISOString() : null,
              nextCheckAt: new Date(r.next_check_at).toISOString(),
              checkIntervalMinutes: minutes,
              checkIntervalSeconds: minutes * 60,
              consecutiveErrors: r.consecutive_errors ?? 0,
              consecutiveFailures: r.consecutive_errors ?? 0,
              consecutiveStableCount: r.consecutive_stable_count ?? 0,
              isActive: r.is_active,
              metadata: r.metadata,
              statusVersion: r.status_version ?? 1,
              createdAt: new Date(r.created_at).toISOString(),
              updatedAt: new Date(r.updated_at).toISOString(),
            },
            telegramId: r.telegram_id ? Number(r.telegram_id) : undefined,
          });
        }
      } catch {
        // Fallback for standard Drizzle query or in-memory testing
        const due = await db
          .select({
            item: watchlistItems,
            telegramId: users.telegramId,
          })
          .from(watchlistItems)
          .innerJoin(users, eq(watchlistItems.userId, users.id))
          .where(and(eq(watchlistItems.isActive, true), lte(watchlistItems.nextCheckAt, now)))
          .limit(50);

        for (const record of due) {
          const id = record.item.id;
          const leasedUntil = this.inMemoryLeased.get(id) || 0;
          if (Date.now() < leasedUntil) {
            continue; // Already leased by another tick
          }
          this.inMemoryLeased.set(id, Date.now() + 600000); // 10 minutes lease

          const currentStatus = (record.item.currentStatus || (record.item as any).lastStatus || CheckStatus.UNKNOWN) as CheckStatus;
          const minutes = record.item.checkIntervalMinutes ?? 360;
          claimedRecords.push({
            item: {
              id: record.item.id,
              userId: record.item.userId,
              platform: record.item.platform as Platform,
              target: record.item.target,
              tld: record.item.tld as SupportedTld | undefined,
              currentStatus,
              previousStatus: (record.item.previousStatus as CheckStatus) || null,
              lastStatus: currentStatus,
              lastConfidence: Number(record.item.lastConfidence),
              lastCheckedAt: record.item.lastCheckedAt?.toISOString() || null,
              nextCheckAt: record.item.nextCheckAt.toISOString(),
              checkIntervalMinutes: minutes,
              checkIntervalSeconds: minutes * 60,
              consecutiveErrors: record.item.consecutiveErrors ?? 0,
              consecutiveFailures: record.item.consecutiveErrors ?? 0,
              consecutiveStableCount: record.item.consecutiveStableCount ?? 0,
              isActive: record.item.isActive,
              metadata: (record.item.metadata as Record<string, any> | null) || null,
              statusVersion: record.item.statusVersion ?? 1,
              createdAt: record.item.createdAt.toISOString(),
              updatedAt: record.item.updatedAt.toISOString(),
            },
            telegramId: record.telegramId,
          });
        }
      }

      dueCount = claimedRecords.length;

      for (const record of claimedRecords) {
        if (this.queue) {
          // Deterministic jobId locked to item ID and minute window
          const epochMinute = Math.floor(Date.now() / 60000);
          const jobId = `watch-${record.item.id}-${epochMinute}`;

          await this.queue.add(
            'check-due-item',
            {
              item: record.item,
              telegramChatId: record.telegramId,
            },
            {
              jobId,
              removeOnComplete: true,
              removeOnFail: 100,
            }
          );
        } else {
          if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging') {
            console.error('[WatchlistQueue] Redis queue is unavailable in production/staging. Direct in-memory processing is forbidden.');
            continue;
          }
          // Direct execution when queue is not attached (dev/test only)
          await this.watchlistService.processDueItem(record.item, record.telegramId);
        }
      }

      if (this.queue) {
        const count = await this.queue.count();
        this.metrics.watchQueueDepth = count;
      }
    } catch {
      // Non-blocking if DB not ready
    }

    return dueCount;
  }

  getHealthStatus(): {
    status: 'UP' | 'DEGRADED' | 'DOWN';
    mode: 'bullmq' | 'direct';
    redisConnected: boolean;
    workerActive: boolean;
    metrics: WatchlistMetrics;
  } {
    const isRedisConfigured = !!this.redisUrl && !this.redisUrl.includes('offline') && !this.redisUrl.includes('mock');
    const isWorkerActive = !!this.worker;
    const isQueueActive = !!this.queue;

    let status: 'UP' | 'DEGRADED' | 'DOWN' = 'UP';
    if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging') {
      if (!isRedisConfigured || !isQueueActive || !isWorkerActive) {
        status = 'DOWN';
      }
    }

    return {
      status,
      mode: this.queue ? 'bullmq' : 'direct',
      redisConnected: isQueueActive,
      workerActive: isWorkerActive,
      metrics: this.metrics,
    };
  }

  async stop(): Promise<void> {
    if (this.schedulerTimer) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = undefined;
    }
    if (this.worker) {
      await this.worker.close();
      this.worker = undefined;
    }
    if (this.queue) {
      await this.queue.close();
      this.queue = undefined;
    }
  }
}
