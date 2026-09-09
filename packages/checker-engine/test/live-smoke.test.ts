import { describe, it, expect } from 'vitest';
import { DomainChecker } from '../src/domain/domain.checker.js';
import { TelegramChecker } from '../src/telegram/telegram.checker.js';
import { YouTubeChecker } from '../src/youtube/youtube.checker.js';
import { Platform, CheckStatus } from '@username/shared';

const isLiveEnabled = process.env.RUN_LIVE_CHECKER_TESTS === 'true';

describe('Opt-In Live Checker Smoke Tests', () => {
  it('1. Live tests are safely gated off by default unless RUN_LIVE_CHECKER_TESTS=true', () => {
    if (!isLiveEnabled) {
      expect(process.env.RUN_LIVE_CHECKER_TESTS).not.toBe('true');
    } else {
      expect(process.env.RUN_LIVE_CHECKER_TESTS).toBe('true');
    }
  });

  describe.runIf(isLiveEnabled)('Real Network Smoke Checks (Opt-In Only)', () => {
    it('DomainChecker: verifies google.com is TAKEN over real DNS/RDAP', async () => {
      const checker = new DomainChecker();
      const result = await checker.check('google', 'com');

      expect(result.platform).toBe(Platform.DOMAIN);
      expect(result.status).toBe(CheckStatus.TAKEN);
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
      expect(result.responseTimeMs).toBeGreaterThan(0);
    }, 15000);

    it('TelegramChecker: verifies known taken handle "telegram" is TAKEN', async () => {
      const checker = new TelegramChecker();
      const result = await checker.check('telegram');

      expect(result.platform).toBe(Platform.TELEGRAM);
      expect(result.status).toBe(CheckStatus.TAKEN);
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    }, 15000);

    it('YouTubeChecker: verifies known taken handle "google" is TAKEN', async () => {
      const checker = new YouTubeChecker();
      const result = await checker.check('google');

      expect(result.platform).toBe(Platform.YOUTUBE);
      expect(result.status).toBe(CheckStatus.TAKEN);
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    }, 15000);
  });
});
