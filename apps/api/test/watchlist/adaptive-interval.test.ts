import { describe, it, expect } from 'vitest';
import { AdaptiveIntervalStrategy } from '../../src/modules/watchlist/adaptive-interval.js';
import { CheckStatus } from '@username/shared';

describe('AdaptiveIntervalStrategy', () => {
  it('enforces minimum interval of at least 60 minutes (1 hour)', () => {
    const interval = AdaptiveIntervalStrategy.calculateNextInterval({
      currentIntervalMinutes: 10, // Requested too low
      status: CheckStatus.UNKNOWN,
      consecutiveErrors: 0,
      minIntervalMinutes: 30, // Policy attempted < 60
    });

    expect(interval).toBeGreaterThanOrEqual(60);
  });

  it('sets initial check interval to 6 hours (360 min) for standard handles', () => {
    const interval = AdaptiveIntervalStrategy.calculateNextInterval({
      currentIntervalMinutes: 60,
      status: CheckStatus.UNKNOWN,
      consecutiveErrors: 0,
    });

    expect(interval).toBe(360);
  });

  it('progressively backs off for stable TAKEN handles (6h -> 12h -> 24h)', () => {
    // Phase 1: Base 360m (6h)
    const step1 = AdaptiveIntervalStrategy.calculateNextInterval({
      currentIntervalMinutes: 60,
      status: CheckStatus.TAKEN,
      consecutiveErrors: 0,
    });
    expect(step1).toBe(360);

    // Phase 2: From 360m to 720m (12h)
    const step2 = AdaptiveIntervalStrategy.calculateNextInterval({
      currentIntervalMinutes: 360,
      status: CheckStatus.TAKEN,
      consecutiveErrors: 0,
    });
    expect(step2).toBe(720);

    // Phase 3: From 720m to 1440m (24h)
    const step3 = AdaptiveIntervalStrategy.calculateNextInterval({
      currentIntervalMinutes: 720,
      status: CheckStatus.TAKEN,
      consecutiveErrors: 0,
    });
    expect(step3).toBe(1440);
  });

  it('applies exponential backoff on consecutive failures and caps at 48 hours (2880 min)', () => {
    const error1 = AdaptiveIntervalStrategy.calculateNextInterval({
      currentIntervalMinutes: 360,
      status: CheckStatus.ERROR,
      consecutiveErrors: 1,
    });
    expect(error1).toBe(90); // 60 * 1.5^1 = 90 min

    const error3 = AdaptiveIntervalStrategy.calculateNextInterval({
      currentIntervalMinutes: 360,
      status: CheckStatus.ERROR,
      consecutiveErrors: 3,
    });
    expect(error3).toBe(203); // 60 * 1.5^3 = 202.5 -> 203 min

    const error10 = AdaptiveIntervalStrategy.calculateNextInterval({
      currentIntervalMinutes: 360,
      status: CheckStatus.RATE_LIMITED,
      consecutiveErrors: 10,
    });
    expect(error10).toBeLessThanOrEqual(2880); // Capped at 48h
  });
});
