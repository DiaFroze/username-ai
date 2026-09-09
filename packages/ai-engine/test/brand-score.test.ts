import { describe, it, expect } from 'vitest';
import { BrandScoreCalculator } from '../src/scoring/brand-score.calculator.js';
import { Platform, CheckStatus, CheckerResult } from '@username/shared';

describe('BrandScoreCalculator', () => {
  it('computes clean breakdown structure between 0 and 100', () => {
    const res = BrandScoreCalculator.calculate('novexa', 'nova');

    expect(res.total).toBeGreaterThan(0);
    expect(res.total).toBeLessThanOrEqual(100);
    expect(res.breakdown).toHaveProperty('length');
    expect(res.breakdown).toHaveProperty('readability');
    expect(res.breakdown).toHaveProperty('cleanliness');
    expect(res.breakdown).toHaveProperty('similarity');
    expect(res.breakdown).toHaveProperty('availability');
  });

  it('rewards sweet-spot length and penalizes numbers and underscores', () => {
    const cleanScore = BrandScoreCalculator.calculate('novexa', 'nova');
    const dirtyScore = BrandScoreCalculator.calculate('nov_exa_99', 'nova');

    expect(cleanScore.breakdown.cleanliness).toBe(15);
    expect(dirtyScore.breakdown.cleanliness).toBeLessThan(10);
    expect(cleanScore.total).toBeGreaterThan(dirtyScore.total);
  });

  it('rewards AVAILABLE checks and NEVER gives points for UNKNOWN, ERROR, or RATE_LIMITED', () => {
    const checksWithAvailable: CheckerResult[] = [
      {
        platform: Platform.TELEGRAM,
        username: 'novexa',
        status: CheckStatus.AVAILABLE,
        checkedAt: Date.now(),
        confidence: 0.95,
        source: 'TEST',
        responseTimeMs: 50,
      },
      {
        platform: Platform.YOUTUBE,
        username: 'novexa',
        status: CheckStatus.AVAILABLE,
        checkedAt: Date.now(),
        confidence: 0.95,
        source: 'TEST',
        responseTimeMs: 50,
      },
      {
        platform: Platform.DOMAIN,
        username: 'novexa.com',
        status: CheckStatus.AVAILABLE,
        checkedAt: Date.now(),
        confidence: 1.0,
        source: 'TEST',
        responseTimeMs: 50,
      },
    ];

    const checksWithAmbiguous: CheckerResult[] = [
      {
        platform: Platform.TELEGRAM,
        username: 'novexa',
        status: CheckStatus.UNKNOWN,
        checkedAt: Date.now(),
        confidence: 0.5,
        source: 'TEST',
        responseTimeMs: 50,
      },
      {
        platform: Platform.YOUTUBE,
        username: 'novexa',
        status: CheckStatus.ERROR,
        checkedAt: Date.now(),
        confidence: 0.0,
        source: 'TEST',
        responseTimeMs: 50,
      },
      {
        platform: Platform.DOMAIN,
        username: 'novexa.com',
        status: CheckStatus.RATE_LIMITED,
        checkedAt: Date.now(),
        confidence: 0.0,
        source: 'TEST',
        responseTimeMs: 50,
      },
    ];

    const availableRes = BrandScoreCalculator.calculate('novexa', 'nova', checksWithAvailable);
    const ambiguousRes = BrandScoreCalculator.calculate('novexa', 'nova', checksWithAmbiguous);

    expect(availableRes.breakdown.availability).toBe(34); // 12 + 12 + 10 = 34
    expect(availableRes.availableEverywhere).toBe(true);

    // CRITICAL REQUIREMENT: UNKNOWN, ERROR, RATE_LIMITED MUST YIELD 0 AVAILABILITY POINTS
    expect(ambiguousRes.breakdown.availability).toBe(0);
    expect(ambiguousRes.availableEverywhere).toBe(false);
  });

  it('CRITICAL REGRESSION: One Name Everywhere requires strict AVAILABLE across all targets (UNKNOWN != AVAILABLE)', () => {
    const mixedChecks: CheckerResult[] = [
      {
        platform: Platform.TELEGRAM,
        username: 'novexa',
        status: CheckStatus.UNKNOWN, // Telegram web cannot confirm vacancy -> UNKNOWN
        checkedAt: Date.now(),
        confidence: 0.5,
        source: 'TELEGRAM_WEB_PUBLIC',
        responseTimeMs: 80,
      },
      {
        platform: Platform.YOUTUBE,
        username: 'novexa',
        status: CheckStatus.AVAILABLE,
        checkedAt: Date.now(),
        confidence: 0.9,
        source: 'YOUTUBE_API',
        responseTimeMs: 60,
      },
      {
        platform: Platform.DOMAIN,
        username: 'novexa.com',
        status: CheckStatus.AVAILABLE,
        checkedAt: Date.now(),
        confidence: 1.0,
        source: 'RDAP',
        responseTimeMs: 120,
      },
    ];

    const res = BrandScoreCalculator.calculate('novexa', 'nova', mixedChecks);

    // YouTube (12) + Domain .com (10) = 22. Telegram UNKNOWN gives exactly 0 points!
    expect(res.breakdown.availability).toBe(22);
    // Even though 2 platforms are AVAILABLE, Telegram is UNKNOWN, so availableEverywhere MUST BE FALSE
    expect(res.availableEverywhere).toBe(false);
  });
});
