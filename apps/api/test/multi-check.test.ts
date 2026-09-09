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
import { Platform, CheckStatus } from '@username/shared';

describe('POST /check (Multi-Platform Checking)', () => {
  const jwtSecret = 'test-secret-32-chars-long-multi-check-key!';
  const authToken = jwt.sign({ id: 88888, username: 'multichecker' }, jwtSecret);

  const mockTgFetch = async () => ({
    ok: true,
    status: 200,
    text: async () => '<html><body><a class="tgme_action_button_new" href="#">View</a></body></html>',
  }) as any;

  const mockYtFetch = async () => ({
    ok: false,
    status: 404,
    text: async () => 'Not found',
  }) as any;

  const mockDomFetch = async (_url: string) => ({
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
    logger: false,
  });

  it('rejects anonymous request without JWT with 401 Unauthorized', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/check',
      payload: { query: 'novexa', platforms: [Platform.TELEGRAM] },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects request with missing or empty query when authenticated', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/check',
      headers: { authorization: `Bearer ${authToken}` },
      payload: { query: '', platforms: [Platform.TELEGRAM] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects request with missing platforms array when authenticated', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/check',
      headers: { authorization: `Bearer ${authToken}` },
      payload: { query: 'novexa', platforms: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('executes parallel multi-platform checks and returns structured results when authenticated', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/check',
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        query: 'novexa',
        platforms: [Platform.TELEGRAM, Platform.YOUTUBE, Platform.DOMAIN],
        tlds: ['com', 'ai', 'uz'],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.query).toBe('novexa');
    expect(body.results).toHaveLength(5); // TG, YT, novexa.com, novexa.ai, novexa.uz

    const tg = body.results.find((r: any) => r.platform === Platform.TELEGRAM);
    const yt = body.results.find((r: any) => r.platform === Platform.YOUTUBE);
    const com = body.results.find((r: any) => r.username === 'novexa.com');
    const ai = body.results.find((r: any) => r.username === 'novexa.ai');

    expect(tg.status).toBe(CheckStatus.TAKEN);
    expect(yt.status).toBe(CheckStatus.AVAILABLE);
    expect(com.status).toBe(CheckStatus.AVAILABLE);
    expect(ai.status).toBe(CheckStatus.AVAILABLE);
    expect(tg.cached).toBeFalsy();
  });

  it('returns cached results on second request and updates metrics', async () => {
    // 2nd request for the same query
    const res = await app.inject({
      method: 'POST',
      url: '/check',
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        query: 'novexa',
        platforms: [Platform.TELEGRAM, Platform.YOUTUBE],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const tg = body.results.find((r: any) => r.platform === Platform.TELEGRAM);
    const yt = body.results.find((r: any) => r.platform === Platform.YOUTUBE);

    expect(tg.cached).toBe(true);
    expect(yt.cached).toBe(true);
    expect(typeof tg.cacheAgeMs).toBe('number');

    // Check health endpoint for metrics verification (requires auth for metrics)
    const healthRes = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { authorization: `Bearer ${authToken}` },
    });
    const healthBody = JSON.parse(healthRes.body);

    expect(healthBody.metrics.checksTotal).toBeGreaterThan(0);
    expect(healthBody.metrics.cacheHits).toBeGreaterThan(0);
  });
});
