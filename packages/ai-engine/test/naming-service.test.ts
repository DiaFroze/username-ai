import { describe, it, expect, vi } from 'vitest';
import { NamingService } from '../src/service/naming.service.js';
import { MockAIProvider } from '../src/providers/mock.provider.js';
import { AiNamingCache } from '../src/cache/ai.cache.js';
import {
  CheckerCoordinator,
  TelegramChecker,
  YouTubeChecker,
  DomainChecker,
  InMemoryCacheStore,
} from '@username/checker-engine';
import { Platform } from '@username/shared';

describe('NamingService Pipeline', () => {
  const mockTgFetch = async (url: string) => {
    // Make 'trynova' available, and 'nova' taken
    if (url.includes('trynova')) {
      return {
        ok: true,
        status: 200,
        text: async () => '<html><body>If you have Telegram, you can contact @trynova right away.</body></html>',
      } as any;
    }
    return {
      ok: true,
      status: 200,
      text: async () => '<html><body><a class="tgme_action_button_new" href="#">View</a></body></html>',
    } as any;
  };

  const mockYtFetch = async (url: string) => {
    if (url.includes('trynova') || url.includes('novex')) {
      return { ok: false, status: 404, text: async () => 'Not found' } as any; // Available
    }
    return { ok: true, status: 200, text: async () => '<html><body>ytInitialData</body></html>' } as any; // Taken
  };

  const mockDomFetch = async (url: string) => {
    if (url.includes('trynova')) {
      return { ok: false, status: 404, json: async () => ({}) } as any; // Available
    }
    return { ok: true, status: 200, json: async () => ({}) } as any; // Taken
  };

  const coordinator = new CheckerCoordinator({
    telegramChecker: new TelegramChecker({ fetch: mockTgFetch }),
    youtubeChecker: new YouTubeChecker({ fetch: mockYtFetch }),
    domainChecker: new DomainChecker({ fetch: mockDomFetch }),
  });

  it('runs the complete pipeline and generates scored candidates', async () => {
    const service = new NamingService({
      aiProvider: new MockAIProvider(),
      coordinator,
      maxCandidatesToVerify: 10,
    });

    const res = await service.generateAndCheck({
      query: 'nova',
      intent: 'BRAND',
      platforms: [Platform.TELEGRAM, Platform.YOUTUBE, Platform.DOMAIN],
      tlds: ['com'],
      count: 5,
    });

    expect(res.query).toBe('nova');
    expect(res.candidates.length).toBeGreaterThan(0);
    expect(res.candidates[0]!).toHaveProperty('brandScore');
    expect(res.candidates[0]!).toHaveProperty('scoreBreakdown');
    expect(res.candidates[0]!).toHaveProperty('checks');
  });

  it('One Name Everywhere: ranks candidates available everywhere above partially taken names', async () => {
    const service = new NamingService({
      aiProvider: new MockAIProvider(),
      coordinator,
      maxCandidatesToVerify: 10,
    });

    const res = await service.generateAndCheck({
      query: 'nova',
      intent: 'BRAND',
      platforms: [Platform.YOUTUBE, Platform.DOMAIN],
      tlds: ['com'],
      count: 10,
    });

    // Top ranked candidates should have the highest availability score
    const top = res.candidates[0]!;
    const last = res.candidates[res.candidates.length - 1]!;

    expect(top.scoreBreakdown.availability).toBeGreaterThanOrEqual(last.scoreBreakdown.availability);
  });

  it('graceful degradation: continues with deterministic generator if AI provider throws', async () => {
    const brokenAiProvider = {
      providerName: 'broken',
      generateNames: vi.fn().mockRejectedValue(new Error('AI API Outage 500')),
    };

    const service = new NamingService({
      aiProvider: brokenAiProvider as any,
      coordinator,
      maxCandidatesToVerify: 5,
    });

    const res = await service.generateAndCheck({
      query: 'nova',
      intent: 'BRAND',
      platforms: [Platform.YOUTUBE],
      count: 5,
    });

    // Pipeline should NOT throw, must return candidates from deterministic engine!
    expect(res.candidates.length).toBeGreaterThan(0);
    expect(service.metrics.aiFailures).toBe(1);
  });

  it('caches AI generations and reuses them on identical requests', async () => {
    const memStore = new InMemoryCacheStore();
    const aiCache = new AiNamingCache(memStore, 3600);

    const service = new NamingService({
      aiProvider: new MockAIProvider(),
      coordinator,
      aiCache,
      maxCandidatesToVerify: 5,
    });

    // Call 1: AI Cache Miss
    const res1 = await service.generateAndCheck({
      query: 'coffee',
      intent: 'BUSINESS',
      platforms: [Platform.YOUTUBE],
      count: 5,
    });
    expect(res1.metrics?.aiCacheHit).toBe(false);

    // Call 2: AI Cache Hit
    const res2 = await service.generateAndCheck({
      query: 'coffee',
      intent: 'BUSINESS',
      platforms: [Platform.YOUTUBE],
      count: 5,
    });
    expect(res2.metrics?.aiCacheHit).toBe(true);
  });
});
