import { describe, it, expect } from 'vitest';
import { WatchlistQueueManager } from '../../src/modules/watchlist/watchlist.queue.js';
import { WatchlistService } from '../../src/modules/watchlist/watchlist.service.js';
import { CheckerCoordinator } from '@username/checker-engine';

describe('WatchlistQueueManager', () => {
  const coordinator = new CheckerCoordinator();
  const watchlistService = new WatchlistService({ coordinator });

  it('runs safely in offline/mock mode when Redis URL is not configured', async () => {
    const manager = new WatchlistQueueManager({
      watchlistService,
      redisUrl: 'offline://mock',
    });

    // Should not throw or crash
    await manager.start();
    expect(manager.metrics.watchChecksTotal).toBe(0);

    const dueCount = await manager.runSchedulerTick();
    expect(dueCount).toBeGreaterThanOrEqual(0);

    await manager.stop();
  });
});
