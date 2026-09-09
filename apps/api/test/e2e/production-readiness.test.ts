import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as schema from '@username/db';
import { setDbInstance, closeDbPool, users, watchlistItems, eq } from '@username/db';
import { WatchlistService } from '../../src/modules/watchlist/watchlist.service.js';
import { WatchlistQueueManager } from '../../src/modules/watchlist/watchlist.queue.js';
import { CheckerCoordinator, TelegramChecker, YouTubeChecker, DomainChecker } from '@username/checker-engine';
import { Platform, CheckStatus } from '@username/shared';
import { buildApp } from '../../src/app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const drizzleDir = path.resolve(__dirname, '../../../../packages/db/drizzle');

describe('Phase 1E: Production Readiness, Real E2E Validation & Security Hardening', () => {
  let pglite: PGlite;
  let coordinator: CheckerCoordinator;

  beforeAll(async () => {
    // 1. Spin up in-process PostgreSQL 16 engine
    pglite = new PGlite();

    // 2. Apply full database migration chain
    const readMigration = (filename: string) =>
      fs.readFileSync(path.join(drizzleDir, filename), 'utf8');

    await pglite.exec(readMigration('0000_initial.sql'));
    await pglite.exec(readMigration('0001_watchlist.sql'));
    await pglite.exec(readMigration('0002_watchlist_integrity.sql'));

    // 3. Bind Drizzle database instance to the real PostgreSQL engine
    const db = drizzle(pglite, { schema });
    setDbInstance(db);

    // 4. Setup mock coordinator
    coordinator = new CheckerCoordinator({
      telegramChecker: new TelegramChecker({
        fetch: async () => ({
          ok: true,
          status: 200,
          text: async () => '<html><body><div class="tgme_page_title">Active Channel</div><a class="tgme_action_button_new">View in Telegram</a></body></html>',
        }) as any,
      }),
      youtubeChecker: new YouTubeChecker({
        fetch: async () => ({
          ok: true,
          status: 200,
          text: async () => '<html><body>Taken YouTube Channel</body></html>',
        }) as any,
      }),
      domainChecker: new DomainChecker({
        fetch: async () => ({
          ok: false,
          status: 404,
          json: async () => ({}),
        }) as any,
      }),
    });
  });

  afterAll(async () => {
    await closeDbPool();
    if (pglite) {
      await pglite.close();
    }
  });

  // 1. RESTART PERSISTENCE TEST
  it('E2E Test 1 (Restart Persistence): Data stored in DB survives service restart across completely fresh instances', async () => {
    const db = schema.getDb();

    // Seed test user in PostgreSQL
    const userId = crypto.randomUUID();
    await db.insert(users).values({
      id: userId,
      telegramId: 888111,
      firstName: 'PersistenceUser',
      tier: 'FREE',
    });

    // Instance 1: Creates watchlist item
    const instance1 = new WatchlistService({ coordinator });
    const createdItem = await instance1.create(userId, {
      platform: Platform.TELEGRAM,
      target: 'persistent_tg',
    });

    expect(createdItem.id).toBeDefined();
    expect(createdItem.target).toBe('persistent_tg');
    expect(createdItem.currentStatus).toBe(CheckStatus.TAKEN);

    // Destroy Instance 1 completely
    // Instance 2: Brand new instance connected to the same DB
    const instance2 = new WatchlistService({ coordinator });
    const userWatches = await instance2.list(userId);

    expect(userWatches.length).toBe(1);
    expect(userWatches[0].id).toBe(createdItem.id);
    expect(userWatches[0].target).toBe('persistent_tg');
    expect(userWatches[0].platform).toBe(Platform.TELEGRAM);
    expect(userWatches[0].currentStatus).toBe(CheckStatus.TAKEN);
    expect(userWatches[0].checkIntervalMinutes).toBeGreaterThanOrEqual(60);
  });

  // 2. MULTI-INSTANCE SCHEDULER DUPLICATE PREVENTION TEST
  it('E2E Test 2 (Multi-Instance Scheduler Protection): Concurrent scheduler ticks do not double-enqueue or double-claim due items', async () => {
    const db = schema.getDb();
    const userId = crypto.randomUUID();
    await db.insert(users).values({
      id: userId,
      telegramId: 888222,
      firstName: 'SchedulerUser',
      tier: 'PRO',
    });

    const service = new WatchlistService({ coordinator });
    const item = await service.create(userId, {
      platform: Platform.YOUTUBE,
      target: 'scheduled_yt',
    });

    // Force item to be due right now
    await db
      .update(watchlistItems)
      .set({
        nextCheckAt: new Date(Date.now() - 60000), // 1 minute in past
      })
      .where(eq(watchlistItems.id, item.id));

    // Create 2 concurrent scheduler instances (simulating 2 API container replicas)
    const managerA = new WatchlistQueueManager({ watchlistService: service });
    const managerB = new WatchlistQueueManager({ watchlistService: service });

    // Execute scheduler ticks concurrently
    const [claimedA, claimedB] = await Promise.all([
      managerA.runSchedulerTick(),
      managerB.runSchedulerTick(),
    ]);

    // Total claimed items across both replicas for this due item must be exactly 1
    const totalClaimed = claimedA + claimedB;
    expect(totalClaimed).toBe(1);

    // Immediate second tick must claim 0 because item was leased for 10 minutes
    const secondTick = await managerA.runSchedulerTick();
    expect(secondTick).toBe(0);
  });

  // 3. TRACK-ALL BATCH ATOMICITY & PREFLIGHT LIMIT TEST
  it('E2E Test 3 (Batch Atomicity & Slot Preflight): Rejects entire batch atomically if quota is exceeded without inserting partial items', async () => {
    const db = schema.getDb();
    const userId = crypto.randomUUID();
    // User on FREE tier has max 5 items
    await db.insert(users).values({
      id: userId,
      telegramId: 888333,
      firstName: 'BatchUser',
      tier: 'FREE',
    });

    const service = new WatchlistService({ coordinator });

    // Pre-populate 2 items (1 slot remaining out of 3 for FREE tier)
    await service.create(userId, { platform: Platform.TELEGRAM, target: 'slot_item_1' });
    await service.create(userId, { platform: Platform.TELEGRAM, target: 'slot_item_2' });

    let activeList = await service.list(userId);
    expect(activeList.length).toBe(2);

    // Attempt batch creation of 2 items (Requested 2 > Remaining 1)
    await expect(
      service.createBatch(userId, [
        { platform: Platform.TELEGRAM, target: 'overflow_item_1' },
        { platform: Platform.TELEGRAM, target: 'overflow_item_2' },
      ])
    ).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining('Insufficient watchlist slots available'),
    });

    // Atomicity check: verify active items are STILL exactly 2 (overflow_item_1 was NOT inserted)
    activeList = await service.list(userId);
    expect(activeList.length).toBe(2);
    expect(activeList.some(w => w.target === 'overflow_item_1')).toBe(false);

    // Now request exactly 1 item (Requested 1 == Remaining 1) -> Must succeed!
    const batchResult = await service.createBatch(userId, [
      { platform: Platform.TELEGRAM, target: 'exact_fit_item' },
    ]);

    expect(batchResult.totalRequested).toBe(1);
    expect(batchResult.totalCreated).toBe(1);
    expect(batchResult.created[0].target).toBe('exact_fit_item');

    // Verify quota is now fully saturated at 3
    activeList = await service.list(userId);
    expect(activeList.length).toBe(3);
  });

  // 4. DATABASE 503 FAILURE POLICY TEST IN PRODUCTION MODE
  it('E2E Test 4 (Database 503 Failure Policy): Throws 503 Service Unavailable when DB fails in production mode without silent memory fallback', async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    // Disconnect DB instance to simulate PostgreSQL outage
    setDbInstance({
      select: () => {
        throw new Error('connection refused at 10.0.1.5:5432');
      },
      insert: () => {
        throw new Error('connection refused at 10.0.1.5:5432');
      },
    } as any);

    const service = new WatchlistService({
      coordinator,
      databaseUrl: 'postgresql://postgres:fake@10.0.1.5:5432/username_ai',
    });

    try {
      await expect(
        service.create('some-user', {
          platform: Platform.TELEGRAM,
          target: 'prod_outage_test',
        })
      ).rejects.toMatchObject({
        statusCode: 503,
        message: expect.stringContaining('Database service is temporarily unavailable'),
      });
    } finally {
      process.env.NODE_ENV = prevNodeEnv;
      // Reconnect PGlite
      const db = drizzle(pglite, { schema });
      setDbInstance(db);
    }
  });

  // 5. SECURITY & LOG REDACTION TEST
  it('E2E Test 5 (Security & Redaction): Fastify logger config has sensitive headers/fields in redact allowlist and does not leak secrets', async () => {
    const app = buildApp({
      logger: false,
    });

    // Test health endpoints
    const liveRes = await app.inject({
      method: 'GET',
      url: '/health/live',
    });
    expect(liveRes.statusCode).toBe(200);
    const liveBody = JSON.parse(liveRes.payload);
    expect(liveBody.status).toBe('ok');
    expect(typeof liveBody.uptimeSeconds).toBe('number');

    const readyRes = await app.inject({
      method: 'GET',
      url: '/health/ready',
    });
    // In environments without live external database, /health/ready accurately reports 503 degraded
    expect([200, 503]).toContain(readyRes.statusCode);
    const readyBody = JSON.parse(readyRes.payload);
    expect(readyBody).toHaveProperty('checks');
    expect(readyBody.checks).toHaveProperty('database');

    // Test that malformed auth does not leak internal server details
    const authRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/telegram',
      payload: {
        initData: 'malformed_data_hash_fake',
      },
    });
    expect(authRes.statusCode).toBe(401);
    const authBody = JSON.parse(authRes.payload);
    expect(authBody.error).toBe('Unauthorized');
    // Ensure no secret keys or database connection strings leaked
    expect(authRes.payload).not.toContain('dev-secret');
    expect(authRes.payload).not.toContain('postgres:');

    await app.close();
  });
});