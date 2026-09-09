import { WatchlistPlanPolicy } from '@username/shared';

// Configurable via environment variable, defaults to 60 minutes
export const WATCHLIST_ABSOLUTE_MIN_INTERVAL_MINUTES = Number(
  process.env.WATCHLIST_ABSOLUTE_MIN_INTERVAL_MINUTES || '60'
);

export const PLAN_POLICIES: Record<string, WatchlistPlanPolicy> = {
  FREE: {
    maxActiveWatches: 3,
    minIntervalMinutes: Math.max(60, WATCHLIST_ABSOLUTE_MIN_INTERVAL_MINUTES),
    defaultIntervalMinutes: 360, // 6 hours
    checkNowCooldownSeconds: 300, // 5 minutes
    // Backwards-compat
    minIntervalSeconds: Math.max(60, WATCHLIST_ABSOLUTE_MIN_INTERVAL_MINUTES) * 60,
    defaultIntervalSeconds: 360 * 60,
  },
  PRO: {
    maxActiveWatches: 25,
    minIntervalMinutes: Math.max(60, WATCHLIST_ABSOLUTE_MIN_INTERVAL_MINUTES), // PRO cannot bypass absolute minimum!
    defaultIntervalMinutes: 180, // 3 hours
    checkNowCooldownSeconds: 60, // 1 minute
    // Backwards-compat
    minIntervalSeconds: Math.max(60, WATCHLIST_ABSOLUTE_MIN_INTERVAL_MINUTES) * 60,
    defaultIntervalSeconds: 180 * 60,
  },
};

export function getPlanPolicy(tier = 'FREE'): WatchlistPlanPolicy {
  return PLAN_POLICIES[tier.toUpperCase()] || PLAN_POLICIES.FREE;
}

