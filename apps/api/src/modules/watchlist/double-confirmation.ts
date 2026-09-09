import { Platform, CheckStatus, CheckerResult } from '@username/shared';
import { CheckerCoordinator } from '@username/checker-engine';

export interface DoubleConfirmationResult {
  confirmed: boolean;
  secondResult: CheckerResult;
  reason?: string;
}

export class DoubleConfirmationService {
  constructor(private readonly coordinator: CheckerCoordinator) {}

  /**
   * Performs an immediate second independent check with forceFresh = true before
   * notifying the user that a handle has become AVAILABLE.
   */
  async confirmAvailability(
    platform: Platform,
    target: string
  ): Promise<DoubleConfirmationResult> {
    // TELEGRAM SAFETY CONSTRAINT (Phase 1D):
    // Public web scraping of t.me cannot guarantee handle vacancy (private accounts, reserves, etc.).
    // To prevent false positive alerts ("Telegram username is free!"), we strictly reject
    // AVAILABLE alerts for Telegram until official MTProto / Fragment integration is in place.
    if (platform === Platform.TELEGRAM) {
      return {
        confirmed: false,
        secondResult: {
          platform,
          username: target,
          status: CheckStatus.UNKNOWN,
          checkedAt: Date.now(),
          confidence: 0.5,
          source: 'TELEGRAM_DOUBLE_CONFIRMATION_RULE',
          responseTimeMs: 0,
          rawDetails: 'Public web endpoint cannot guarantee vacancy for Telegram alert safety',
        },
        reason: 'Telegram availability cannot be guaranteed without MTProto session',
      };
    }

    // For YouTube and Domains: run second independent check with forceFresh to bypass cache
    const secondResult = await this.coordinator.checkSingle(platform, target, { forceFresh: true });

    if (secondResult.status === CheckStatus.AVAILABLE) {
      return {
        confirmed: true,
        secondResult,
      };
    }

    return {
      confirmed: false,
      secondResult,
      reason: `Second verification returned ${secondResult.status} (not AVAILABLE)`,
    };
  }
}
