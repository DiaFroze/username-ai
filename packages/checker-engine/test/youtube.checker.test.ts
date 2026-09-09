import { describe, it, expect } from 'vitest';
import { YouTubeChecker } from '../src/youtube/youtube.checker.js';
import { Platform, CheckStatus } from '@username/shared';

describe('YouTubeChecker', () => {
  const checker = new YouTubeChecker({ apiKey: 'MOCK_KEY' });

  describe('validateFormat', () => {
    it('rejects handles shorter than 3 characters', () => {
      expect(checker.validateFormat('ab').valid).toBe(false);
      expect(checker.validateFormat('a').valid).toBe(false);
    });

    it('rejects handles longer than 30 characters', () => {
      expect(checker.validateFormat('a'.repeat(31)).valid).toBe(false);
    });

    it('rejects handles starting or ending with punctuation', () => {
      expect(checker.validateFormat('.handle').valid).toBe(false);
      expect(checker.validateFormat('-handle').valid).toBe(false);
      expect(checker.validateFormat('_handle').valid).toBe(false);
      expect(checker.validateFormat('handle.').valid).toBe(false);
      expect(checker.validateFormat('handle_').valid).toBe(false);
    });

    it('rejects handles with consecutive periods', () => {
      expect(checker.validateFormat('cool..handle').valid).toBe(false);
    });

    it('rejects handles with invalid special characters', () => {
      expect(checker.validateFormat('handle!').valid).toBe(false);
      expect(checker.validateFormat('handle$').valid).toBe(false);
      expect(checker.validateFormat('han dle').valid).toBe(false);
    });

    it('accepts valid YouTube handles', () => {
      expect(checker.validateFormat('nova').valid).toBe(true);
      expect(checker.validateFormat('abdulloh_dev').valid).toBe(true);
      expect(checker.validateFormat('brand.studio').valid).toBe(true);
      expect(checker.validateFormat('creator-2026').valid).toBe(true);
    });
  });

  describe('Official API v3 checking', () => {
    it('returns TAKEN when API returns items > 0', async () => {
      const mockFetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          pageInfo: { totalResults: 1 },
          items: [{ id: 'UC123456789' }],
        }),
      }) as any;

      const customChecker = new YouTubeChecker({ apiKey: 'VALID_KEY', fetch: mockFetch });
      const result = await customChecker.check('google');

      expect(result.platform).toBe(Platform.YOUTUBE);
      expect(result.status).toBe(CheckStatus.TAKEN);
      expect(result.source).toBe('YOUTUBE_DATA_API_V3');
      expect(result.confidence).toBe(1.0);
    });

    it('returns AVAILABLE when official API returns 0 items', async () => {
      const mockFetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          pageInfo: { totalResults: 0 },
          items: [],
        }),
      }) as any;

      const customChecker = new YouTubeChecker({ apiKey: 'VALID_KEY', fetch: mockFetch });
      const result = await customChecker.check('vacant_handle_xyz_2026');

      expect(result.status).toBe(CheckStatus.AVAILABLE);
      expect(result.source).toBe('YOUTUBE_DATA_API_V3');
      expect(result.confidence).toBe(0.95);
    });

    it('returns RATE_LIMITED when API returns 429', async () => {
      const mockFetch = async () => ({
        ok: false,
        status: 429,
        text: async () => 'Rate limit exceeded',
      }) as any;

      const customChecker = new YouTubeChecker({ apiKey: 'VALID_KEY', fetch: mockFetch });
      const result = await customChecker.check('some_handle');

      expect(result.status).toBe(CheckStatus.RATE_LIMITED);
      expect(result.errorCode).toBe('HTTP_429_RATE_LIMITED');
    });

    it('returns UNKNOWN on timeout and NEVER returns AVAILABLE', async () => {
      const mockFetch = async () => {
        const err = new Error('Timeout');
        err.name = 'TimeoutError';
        throw err;
      };

      const customChecker = new YouTubeChecker({ apiKey: 'VALID_KEY', fetch: mockFetch as any, enableFallback: false });
      const result = await customChecker.check('timeout_handle');

      expect(result.status).toBe(CheckStatus.UNKNOWN);
      expect(result.errorCode).toBe('TIMEOUT');
    });
  });

  describe('Web fallback checking', () => {
    it('returns AVAILABLE when web profile returns 404', async () => {
      const mockFetch = async () => ({
        ok: false,
        status: 404,
        text: async () => '404 Not Found',
      }) as any;

      const customChecker = new YouTubeChecker({ fetch: mockFetch }); // no apiKey -> web fallback
      const result = await customChecker.check('vacant_web_handle');

      expect(result.status).toBe(CheckStatus.AVAILABLE);
      expect(result.source).toBe('YOUTUBE_WEB_PUBLIC');
      expect(result.confidence).toBe(0.85);
    });

    it('returns TAKEN when web profile returns 200 with channel data', async () => {
      const mockFetch = async () => ({
        ok: true,
        status: 200,
        text: async () => '<html><body><script>var ytInitialData = {...};</script><link rel="canonical" href="https://www.youtube.com/@active_channel"></body></html>',
      }) as any;

      const customChecker = new YouTubeChecker({ fetch: mockFetch });
      const result = await customChecker.check('active_channel');

      expect(result.status).toBe(CheckStatus.TAKEN);
      expect(result.source).toBe('YOUTUBE_WEB_PUBLIC');
      expect(result.confidence).toBe(0.95);
    });
  });
});
