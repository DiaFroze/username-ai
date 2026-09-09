import { describe, it, expect, vi, afterEach } from 'vitest';
import { WatchlistQueueManager } from '../../src/modules/watchlist/watchlist.queue.js';
import { WatchlistService } from '../../src/modules/watchlist/watchlist.service.js';
import { CheckerCoordinator, TelegramChecker } from '@username/checker-engine';
import { buildApp } from '../../src/app.js';

describe('Strict Redis Production Failure Policy & Readiness Probe', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    vi.restoreAllMocks();
  });

  it('1. In production mode: queueManager reports status DOWN when Redis is not configured or offline', () => {
    process.env.NODE_ENV = 'production';

    const service = new WatchlistService({
      coordinator: new CheckerCoordinator({
        telegramChecker: new TelegramChecker(),
      }),
    });

    const queueManager = new WatchlistQueueManager({
      watchlistService: service,
      redisUrl: 'redis://127.0.0.1:6379/offline',
    });

    const health = queueManager.getHealthStatus();
    expect(health.status).toBe('DOWN');
    expect(health.mode).toBe('direct');
    expect(health.workerActive).toBe(false);
  });

  it('2. In production mode: /health/ready returns 503 when Redis/Queue is DOWN', async () => {
    process.env.NODE_ENV = 'production';

    const app = buildApp({
      logger: false,
      redisUrl: 'redis://127.0.0.1:6399/offline',
    });
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/health/ready',
    });

    expect(response.statusCode).toBe(503);
    const body = JSON.parse(response.payload);
    expect(body.status).toBe('degraded');
    expect(body.checks.redis).toBe('DOWN');
    expect(body.checks.queue).toBe('DOWN');

    await app.close();
  });

  it('3. In production mode: runSchedulerTick forbids direct in-memory background processing', async () => {
    process.env.NODE_ENV = 'production';

    const processDueSpy = vi.fn();
    const mockService = {
      processDueItem: processDueSpy,
    } as unknown as WatchlistService;

    const queueManager = new WatchlistQueueManager({
      watchlistService: mockService,
      redisUrl: undefined, // no redis
    });

    // Directly test direct mode branch when db records would be processed
    const _errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // In production without queue, scheduler tick must never fall back to direct processing
    const _dueCount = await queueManager.runSchedulerTick();
    expect(processDueSpy).not.toHaveBeenCalled();
  });

  it('4. In test/dev mode: queueManager reports status UP and allows direct mode for developer velocity', () => {
    process.env.NODE_ENV = 'test';

    const service = new WatchlistService({
      coordinator: new CheckerCoordinator({
        telegramChecker: new TelegramChecker(),
      }),
    });

    const queueManager = new WatchlistQueueManager({
      watchlistService: service,
    });

    const health = queueManager.getHealthStatus();
    expect(health.status).toBe('UP');
    expect(health.mode).toBe('direct');
  });
});
