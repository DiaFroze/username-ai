import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import { buildApp } from '../../src/app.js';
import {
  TelegramChecker,
  YouTubeChecker,
  DomainChecker,
  CheckerCoordinator,
  InMemoryCacheStore,
} from '@username/checker-engine';
import { WatchlistService } from '../../src/modules/watchlist/watchlist.service.js';
import { Platform } from '@username/shared';

describe('Watchlist API Endpoints (/api/v1/watchlist)', () => {
  const jwtSecret = 'test-secret-key-32-chars-minimum-length!';

  const cache = new InMemoryCacheStore();
  const coordinator = new CheckerCoordinator({
    telegramChecker: new TelegramChecker({
      fetch: async () => ({
        ok: true,
        status: 200,
        text: async () => '<html><body><div class="tgme_page_title">Taken</div><div class="tgme_page_title">Example profile</div><div class="tgme_page_extra">100 subscribers</div><a class="tgme_action_button_new">View</a></body></html>',
      }) as any,
    }),
    youtubeChecker: new YouTubeChecker({
      fetch: async () => ({ ok: false, status: 404, text: async () => 'Not found' }) as any,
    }),
    domainChecker: new DomainChecker({
      fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }) as any,
    }),
    cache,
  });

  const watchlistService = new WatchlistService({ coordinator });
  watchlistService.seedUser({ id: '1001', telegramId: 1001, tier: 'FREE' });
  watchlistService.seedUser({ id: '2002', telegramId: 2002, tier: 'FREE' });

  const app = buildApp({
    jwtSecret,
    customCoordinator: coordinator,
    customWatchlistService: watchlistService,
    logger: false,
  });

  const tokenUser1 = jwt.sign({ id: 1001, first_name: 'Alice' }, jwtSecret);
  const tokenUser2 = jwt.sign({ id: 2002, first_name: 'Bob' }, jwtSecret);

  it('rejects unauthenticated requests with 401 Unauthorized', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/watchlist',
    });
    expect(res.statusCode).toBe(401);
  });

  it('creates watch item for authenticated user (201 Created)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/watchlist',
      headers: { Authorization: `Bearer ${tokenUser1}` },
      payload: {
        platform: Platform.YOUTUBE,
        target: 'alicechannel',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.payload);
    expect(body.id).toBeDefined();
    expect(body.target).toBe('alicechannel');
    expect(body.platform).toBe(Platform.YOUTUBE);
  });

  it('lists only items belonging to authenticated user', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/watchlist',
      headers: { Authorization: `Bearer ${tokenUser1}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items[0].target).toBe('alicechannel');

    // Bob has no items
    const resBob = await app.inject({
      method: 'GET',
      url: '/api/v1/watchlist',
      headers: { Authorization: `Bearer ${tokenUser2}` },
    });
    expect(resBob.statusCode).toBe(200);
    const bobBody = JSON.parse(resBob.payload);
    expect(bobBody.items.length).toBe(0);
  });

  it('protects against IDOR: User 2 cannot delete User 1 item', async () => {
    // 1. Get Alice's item ID
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/watchlist',
      headers: { Authorization: `Bearer ${tokenUser1}` },
    });
    const item = JSON.parse(listRes.payload).items[0];

    // 2. Bob attempts to delete Alice's item
    const deleteByBob = await app.inject({
      method: 'DELETE',
      url: `/api/v1/watchlist/${item.id}`,
      headers: { Authorization: `Bearer ${tokenUser2}` },
    });
    expect(deleteByBob.statusCode).toBe(404);

    // 3. Alice deletes her own item
    const deleteByAlice = await app.inject({
      method: 'DELETE',
      url: `/api/v1/watchlist/${item.id}`,
      headers: { Authorization: `Bearer ${tokenUser1}` },
    });
    expect(deleteByAlice.statusCode).toBe(200);
  });

  it('GET /health reports watchlist service status as UP when authenticated', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { Authorization: `Bearer ${tokenUser1}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.services.watchlist).toBeDefined();
    expect(body.services.watchlist.status).toBe('UP');
  });
});
