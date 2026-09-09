import { CheckStatus, NotificationEventType } from '@username/shared';

export interface TransitionDecision {
  shouldNotify: boolean;
  eventType?: NotificationEventType;
  requiresDoubleConfirmation: boolean;
}

export class StatusTransitionEngine {
  /**
   * Evaluates state change between old and new check result.
   * Prevents notification storms and isolates transient network glitches.
   */
  static evaluate(
    oldStatus: CheckStatus,
    newStatus: CheckStatus,
    confidence: number
  ): TransitionDecision {
    // 1. Same status: never notify
    if (oldStatus === newStatus) {
      return { shouldNotify: false, requiresDoubleConfirmation: false };
    }

    // 2. Suppress noisy transitions between ambiguous or transient error states
    const transientErrors = new Set([CheckStatus.UNKNOWN, CheckStatus.ERROR, CheckStatus.RATE_LIMITED]);
    if (transientErrors.has(oldStatus) && transientErrors.has(newStatus)) {
      return { shouldNotify: false, requiresDoubleConfirmation: false };
    }

    // 3. High-Value Event: TAKEN -> AVAILABLE
    if (oldStatus === CheckStatus.TAKEN && newStatus === CheckStatus.AVAILABLE) {
      return {
        shouldNotify: true,
        eventType: 'STATUS_CHANGED_AVAILABLE',
        requiresDoubleConfirmation: true, // Must verify independently before alerting user
      };
    }

    // 4. UNKNOWN -> AVAILABLE: only valid if confidence >= 0.85
    if (oldStatus === CheckStatus.UNKNOWN && newStatus === CheckStatus.AVAILABLE) {
      if (confidence >= 0.85) {
        return {
          shouldNotify: true,
          eventType: 'STATUS_CHANGED_AVAILABLE',
          requiresDoubleConfirmation: true,
        };
      }
      return { shouldNotify: false, requiresDoubleConfirmation: false };
    }

    // 5. Informational Event: AVAILABLE -> TAKEN
    if (oldStatus === CheckStatus.AVAILABLE && newStatus === CheckStatus.TAKEN) {
      return {
        shouldNotify: true,
        eventType: 'STATUS_CHANGED_TAKEN',
        requiresDoubleConfirmation: false,
      };
    }

    return { shouldNotify: false, requiresDoubleConfirmation: false };
  }
}
