import { CheckStatus } from '@username/shared';

export interface AdaptiveIntervalInput {
  currentIntervalMinutes?: number;
  status: CheckStatus;
  consecutiveErrors?: number;
  consecutiveStableCount?: number;
  minIntervalMinutes?: number;
  // Backwards-compatibility aliases
  currentIntervalSeconds?: number;
  consecutiveFailures?: number;
  minIntervalSeconds?: number;
}

export class AdaptiveIntervalStrategy {
  /**
   * Computes the next scheduled check interval in minutes.
   * Phase 1D.1 Rules:
   * - Absolute minimum scheduled interval: >= 60 minutes.
   * - Base / Initial interval: 360 min (6 hours) for FREE, 180 min (3 hours) for PRO.
   * - Stable TAKEN: progressively backs off to 720 min (12 hours) and then 1440 min (24 hours).
   * - Errors / Rate limits: applies exponential backoff up to 2880 min (48 hours).
   */
  static calculateNextInterval(input: AdaptiveIntervalInput): number {
    const minMinutes = Math.max(
      60,
      input.minIntervalMinutes ??
        (input.minIntervalSeconds ? Math.floor(input.minIntervalSeconds / 60) : 60)
    );
    const maxMinutes = 2880; // 48 hours

    const errors = input.consecutiveErrors ?? input.consecutiveFailures ?? 0;
    const currentInterval =
      input.currentIntervalMinutes ??
      (input.currentIntervalSeconds ? Math.floor(input.currentIntervalSeconds / 60) : 360);

    // 1. Exponential backoff on errors / rate limits
    if (errors > 0) {
      const multiplier = Math.pow(1.5, Math.min(errors, 6));
      const backoffInterval = Math.round(minMinutes * multiplier);
      return Math.min(maxMinutes, Math.max(minMinutes, backoffInterval));
    }

    // 2. Stable TAKEN handles back off progressively
    if (input.status === CheckStatus.TAKEN) {
      const stableCount = input.consecutiveStableCount ?? 0;
      if (stableCount >= 10 || currentInterval >= 720) {
        return Math.max(minMinutes, 1440); // 24 hours
      } else if (stableCount >= 4 || currentInterval >= 360) {
        return Math.max(minMinutes, 720); // 12 hours
      } else {
        return Math.max(minMinutes, 360); // 6 hours
      }
    }

    // 3. For AVAILABLE or UNKNOWN, default to base 360 min
    return Math.max(minMinutes, 360);
  }
}

