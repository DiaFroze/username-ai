import { describe, it, expect, vi } from 'vitest';
import { CheckerCoordinator } from '../src/coordinator/checker.coordinator.js';
import { TelegramChecker } from '../src/telegram/telegram.checker.js';
import { YouTubeChecker } from '../src/youtube/youtube.checker.js';
import { DomainChecker } from '../src/domain/domain.checker.js';
import { InMemoryCacheStore } from '../src/cache/memory-cache.store.js';
import { Platform, CheckStatus } from '@username/shared';

describe('CheckerCoordinator', () => {
  it('executes multi-platform checks concurrently', async () => {
    const mockTgFetch = async () => ({
      ok: true,
      status: 200,
      text: async () => '<html><body><div class="tgme_page_title">Example profile</div><div class="tgme_page_extra">100 subscribers</div><a class="tgme_action_button_new" href="#">View</a></body></html>',
    }) as any;

    const mockYtFetch = async () => ({
      ok: false,
      status: 404,
      text: async () => 'Not found',
    }) as any;

    const mockDomFetch = async () => ({
      ok: false,
      status: 404,
      json: async () => ({}),
    }) as any;

    const coordinator = new CheckerCoordinator({
      telegramChecker: new TelegramChecker({ fetch: mockTgFetch }),
      youtubeChecker: new YouTubeChecker({ fetch: mockYtFetch }),
      domainChecker: new DomainChecker({ fetch: mockDomFetch }),
    });

    const response = await coordinator.check({
      query: 'novexa',
      platforms: [Platform.TELEGRAM, Platform.YOUTUBE, Platform.DOMAIN],
      tlds: ['com', 'ai'],
    });

    expect(response.query).toBe('novexa');
    expect(response.results).toHaveLength(4); // TG, YT, novexa.com, novexa.ai

    const tg = response.results.find(r => r.platform === Platform.TELEGRAM);
    const yt = response.results.find(r => r.platform === Platform.YOUTUBE);
    const com = response.results.find(r => r.username === 'novexa.com');
    const ai = response.results.find(r => r.username === 'novexa.ai');

    expect(tg?.status).toBe(CheckStatus.TAKEN);
    expect(yt?.status).toBe(CheckStatus.AVAILABLE);
    expect(com?.status).toBe(CheckStatus.AVAILABLE);
    expect(ai?.status).toBe(CheckStatus.AVAILABLE);
  });

  it('isolates failures: error in one checker does not break other checkers', async () => {
    const mockTgFetch = async () => ({
      ok: true,
      status: 200,
      text: async () => '<html><body><div class="tgme_page_title">Example profile</div><div class="tgme_page_extra">100 subscribers</div><a class="tgme_action_button_new" href="#">View</a></body></html>',
    }) as any;

    // Simulate YouTube checker throwing unexpected runtime exception
    const faultyYtChecker = new YouTubeChecker();
    vi.spyOn(faultyYtChecker, 'check').mockRejectedValueOnce(new Error('Fatal API crash'));

    const mockDomFetch = async () => ({
      ok: false,
      status: 404,
      json: async () => ({}),
    }) as any;

    const coordinator = new CheckerCoordinator({
      telegramChecker: new TelegramChecker({ fetch: mockTgFetch }),
      youtubeChecker: faultyYtChecker,
      domainChecker: new DomainChecker({ fetch: mockDomFetch }),
    });

    const response = await coordinator.check({
      query: 'novexa',
      platforms: [Platform.TELEGRAM, Platform.YOUTUBE, Platform.DOMAIN],
      tlds: ['com'],
    });

    expect(response.results).toHaveLength(3);

    const tg = response.results.find(r => r.platform === Platform.TELEGRAM);
    const yt = response.results.find(r => r.platform === Platform.YOUTUBE);
    const dom = response.results.find(r => r.platform === Platform.DOMAIN);

    expect(tg?.status).toBe(CheckStatus.TAKEN);
    expect(dom?.status).toBe(CheckStatus.AVAILABLE);
    expect(yt?.status).toBe(CheckStatus.ERROR);
    expect(yt?.source).toBe('COORDINATOR_FAULT_ISOLATION');
    expect(yt?.rawDetails).toContain('Fatal API crash');
  });

  it('single-flight deduplication: 20 concurrent requests trigger only 1 external provider call', async () => {
    let callCount = 0;
    const mockFetch = async () => {
      callCount++;
      // add artificial latency to allow concurrency
      await new Promise(r => setTimeout(r, 20));
      return {
        ok: true,
        status: 200,
        text: async () => '<html><body><div class="tgme_page_title">Example profile</div><div class="tgme_page_extra">100 subscribers</div><a class="tgme_action_button_new" href="#">View</a></body></html>',
      } as any;
    };

    const coordinator = new CheckerCoordinator({
      telegramChecker: new TelegramChecker({ fetch: mockFetch }),
    });

    // Fire 20 parallel calls simultaneously for the exact same handle
    const promises = Array.from({ length: 20 }, () =>
      coordinator.checkSingle(Platform.TELEGRAM, 'coalesced_user')
    );

    const results = await Promise.all(promises);

    expect(results).toHaveLength(20);
    for (const r of results) {
      expect(r.status).toBe(CheckStatus.TAKEN);
    }
    // Exactly 1 network fetch should have executed!
    expect(callCount).toBe(1);
  });

  it('Cache-Aside: returns cached result on subsequent requests without calling checker', async () => {
    let callCount = 0;
    const mockFetch = async () => {
      callCount++;
      return {
        ok: false,
        status: 404,
        json: async () => ({}),
      } as any;
    };

    const cache = new InMemoryCacheStore();
    const coordinator = new CheckerCoordinator({
      domainChecker: new DomainChecker({ fetch: mockFetch }),
      cache,
      cacheConfig: { domainTtlSeconds: 300, negativeTtlSeconds: 10 },
    });

    // Call 1: Miss
    const res1 = await coordinator.checkSingle(Platform.DOMAIN, 'cached-domain.com');
    expect(res1.status).toBe(CheckStatus.AVAILABLE);
    expect(res1.cached).toBeUndefined();
    expect(callCount).toBe(1);

    // Call 2: Hit
    const res2 = await coordinator.checkSingle(Platform.DOMAIN, 'cached-domain.com');
    expect(res2.status).toBe(CheckStatus.AVAILABLE);
    expect(res2.cached).toBe(true);
    expect(typeof res2.cacheAgeMs).toBe('number');
    expect(callCount).toBe(1); // Provider NOT called again!
  });
});
