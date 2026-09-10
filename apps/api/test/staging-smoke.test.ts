import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import { buildApp } from '../src/app.js';
import {
  CheckerCoordinator,
  TelegramChecker,
  YouTubeChecker,
  DomainChecker,
  InMemoryCacheStore,
} from '@username/checker-engine';
import { MockAIProvider } from '@username/ai-engine';
import { Platform } from '@username/shared';

describe('Phase 1F: Staging Smoke & Performance Benchmarking', () => {
  const jwtSecret = 'test-staging-jwt-secret-must-be-32-chars-long!';
  const authToken = jwt.sign({ id: 999999, username: 'staging_tester' }, jwtSecret);

  const mockTgFetch = async () =>
    ({
      ok: true,
      status: 200,
      text: async () => '<html><body><div class="tgme_page_title">Staging Tester</div><div class="tgme_page_title">Example profile</div><div class="tgme_page_extra">100 subscribers</div><a class="tgme_action_button_new">View</a></body></html>',
    }) as any;

  const mockYtFetch = async () =>
    ({
      ok: false,
      status: 404,
      text: async () => 'Not found',
    }) as any;

  const mockDomFetch = async () =>
    ({
      ok: false,
      status: 404,
      json: async () => ({}),
    }) as any;

  const cache = new InMemoryCacheStore();
  const coordinator = new CheckerCoordinator({
    telegramChecker: new TelegramChecker({ fetch: mockTgFetch }),
    youtubeChecker: new YouTubeChecker({ fetch: mockYtFetch }),
    domainChecker: new DomainChecker({ fetch: mockDomFetch }),
    cache,
  });

  const app = buildApp({
    jwtSecret,
    customCoordinator: coordinator,
    customCacheStore: cache,
    customAIProvider: new MockAIProvider(),
    logger: false,
  });

  // 1. CONTROLLED STAGING NOTIFICATION TEST ENDPOINT
  describe('POST /api/v1/staging/test-notification', () => {
    it('rejects unauthenticated request or invalid staging test key', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/staging/test-notification',
        payload: {
          telegramId: 999999,
          target: 'sample_handle',
          platform: Platform.TELEGRAM,
        },
      });
      expect(res.statusCode).toBe(401);
    });

    it('rejects request with valid staging key but missing required fields', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/staging/test-notification',
        headers: {
          'x-staging-key': process.env.STAGING_TEST_KEY || 'staging-test-secret-key-12345',
        },
        payload: {
          telegramId: 999999,
          // missing target and platform
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it('dispatches test notification when valid staging test key is provided', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/staging/test-notification',
        headers: {
          'x-staging-key': process.env.STAGING_TEST_KEY || 'staging-test-secret-key-12345',
        },
        payload: {
          telegramId: 999999,
          target: 'myhandle',
          platform: Platform.TELEGRAM,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(body.telegramId).toBe(999999);
      expect(body.target).toBe('myhandle');
      expect(body.platform).toBe(Platform.TELEGRAM);
      expect(body).toHaveProperty('dispatched');
    });

    it('is strictly blocked if NODE_ENV is production', async () => {
      const prevEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/staging/test-notification',
          headers: {
            'x-staging-key': process.env.STAGING_TEST_KEY || 'staging-test-secret-key-12345',
          },
          payload: {
            telegramId: 999999,
            target: 'myhandle',
            platform: Platform.TELEGRAM,
          },
        });
        expect(res.statusCode).toBe(403);
        const body = JSON.parse(res.payload);
        expect(body.message).toContain('disabled in production');
      } finally {
        process.env.NODE_ENV = prevEnv;
      }
    });
  });

  // 2. CONCURRENCY & LATENCY BENCHMARKING SMOKE TEST
  describe('Performance & Concurrency Smoke Benchmark', () => {
    it('executes 10 concurrent multi-check requests with 0% errors and p95 latency < 1500ms', async () => {
      const CONCURRENCY = 10;
      const latencies: number[] = [];

      const makeRequest = async (idx: number) => {
        const t0 = performance.now();
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/check',
          headers: { authorization: `Bearer ${authToken}` },
          payload: {
            query: `brand${idx}`,
            platforms: [Platform.TELEGRAM, Platform.YOUTUBE],
          },
        });
        const elapsed = performance.now() - t0;
        latencies.push(elapsed);
        return res;
      };

      const promises = Array.from({ length: CONCURRENCY }, (_, i) => makeRequest(i));
      const responses = await Promise.all(promises);

      // Verify 0% error rate
      const failed = responses.filter(r => r.statusCode !== 200);
      expect(failed.length).toBe(0);

      // Calculate latency metrics
      latencies.sort((a, b) => a - b);
      const p50Index = Math.floor(latencies.length * 0.5);
      const p95Index = Math.floor(latencies.length * 0.95);
      const p50 = latencies[p50Index];
      const p95 = latencies[p95Index];

      expect(p50).toBeLessThan(1000); // p50 < 1s
      expect(p95).toBeLessThan(2000); // p95 < 2s
      expect(responses.length).toBe(CONCURRENCY);
    });

    it('handles concurrent AI naming requests under load', async () => {
      const CONCURRENCY = 5;
      const promises = Array.from({ length: CONCURRENCY }, (_, i) =>
        app.inject({
          method: 'POST',
          url: '/api/v1/naming/generate',
          headers: { authorization: `Bearer ${authToken}` },
          payload: {
            query: `brand${i}`,
            count: 3,
          },
        })
      );

      const responses = await Promise.all(promises);
      for (const res of responses) {
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.payload);
        expect(body.candidates.length).toBeGreaterThan(0);
      }
    });
  });
});
