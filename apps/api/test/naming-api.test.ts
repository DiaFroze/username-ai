import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import { buildApp } from '../src/app.js';
import {
  TelegramChecker,
  YouTubeChecker,
  DomainChecker,
  CheckerCoordinator,
  InMemoryCacheStore,
} from '@username/checker-engine';
import { MockAIProvider } from '@username/ai-engine';

describe('POST /api/v1/naming/generate (AI Naming Pipeline API)', () => {
  const jwtSecret = 'test-secret-32-chars-long-naming-api-key!';
  const authToken = jwt.sign({ id: 77777, username: 'naming_user' }, jwtSecret);

  const mockTgFetch = async () =>
    ({
      ok: false,
      status: 404,
      text: async () => '<html><body><span class="tgme_page_extra">If you have Telegram, you can contact @...</span></body></html>',
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

  it('rejects anonymous request without JWT with 401 Unauthorized', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/naming/generate',
      payload: { query: 'quick nova' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects request with missing or too short query when authenticated', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/naming/generate',
      headers: { authorization: `Bearer ${authToken}` },
      payload: { query: 'a' },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.message).toContain('at least 2 characters');
  });

  it('successfully generates scored candidates with Brand Score breakdown when authenticated', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/naming/generate',
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        query: 'quick nova',
        intent: 'BUSINESS',
        category: 'AI',
        count: 5,
        oneNameEverywhere: true,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);

    expect(body.query).toBe('quick nova');
    expect(body.totalCandidates).toBeGreaterThan(0);
    expect(body.candidates.length).toBeLessThanOrEqual(5);

    const first = body.candidates[0];
    expect(first).toBeDefined();
    expect(first.name).toBeDefined();
    expect(first.brandScore).toBeGreaterThanOrEqual(0);
    expect(first.brandScore).toBeLessThanOrEqual(100);
    expect(first.scoreBreakdown).toBeDefined();
    expect(first.scoreBreakdown.length).toBeGreaterThanOrEqual(0);
    expect(first.scoreBreakdown.cleanliness).toBeGreaterThanOrEqual(0);
    expect(first.checks.length).toBeGreaterThan(0);

    expect(body.metrics).toBeDefined();
    expect(body.metrics.totalGenerated).toBeGreaterThan(0);
    expect(body.metrics.totalChecked).toBeGreaterThan(0);
  });

  it('supports backwards compatible /naming/generate alias when authenticated', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/naming/generate',
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        query: 'solaris',
        intent: 'BRAND',
        count: 3,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.query).toBe('solaris');
    expect(body.candidates.length).toBeGreaterThan(0);
  });

  it('GET /health reports aiEngine status and metrics when authenticated', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { authorization: `Bearer ${authToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.services.aiEngine).toBeDefined();
    expect(body.services.aiEngine.status).toBe('UP');
    expect(body.metrics.aiRequests).toBeGreaterThan(0);
  });
});
