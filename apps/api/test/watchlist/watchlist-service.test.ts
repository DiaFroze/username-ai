import { describe, it, expect } from 'vitest';
import { WatchlistService } from '../../src/modules/watchlist/watchlist.service.js';
import {
  CheckerCoordinator,
  TelegramChecker,
  YouTubeChecker,
  DomainChecker,
} from '@username/checker-engine';
import { Platform, CheckStatus } from '@username/shared';

describe('WatchlistService', () => {
  const coordinator = new CheckerCoordinator({
    telegramChecker: new TelegramChecker({
      fetch: async () => ({
        ok: true,
        status: 200,
        text: async () => '<html><body><div class="tgme_page_title">Taken Channel</div><a class="tgme_action_button_new">View</a></body></html>',
      }) as any,
    }),
    youtubeChecker: new YouTubeChecker({
      fetch: async () => ({
        ok: true,
        status: 200,
        text: async () => '<html><body>Taken Video</body></html>',
      }) as any,
    }),
    domainChecker: new DomainChecker({
      fetch: async () => ({
        ok: false,
        status: 404,
        json: async () => ({}),
      }) as any,
    }),
  });

  const createService = () => {
    const service = new WatchlistService({ coordinator });
    service.seedUser({ id: 'user-free-1', telegramId: 1001, tier: 'FREE' });
    service.seedUser({ id: 'user-free-2', telegramId: 1002, tier: 'FREE' });
    return service;
  };

  it('creates a watch item and runs initial check', async () => {
    const service = createService();

    const item = await service.create('user-free-1', {
      platform: Platform.TELEGRAM,
      target: 'coolbot',
    });

    expect(item).toBeDefined();
    expect(item.userId).toBe('user-free-1');
    expect(item.target).toBe('coolbot');
    expect(item.platform).toBe(Platform.TELEGRAM);
    expect(item.lastStatus).toBe(CheckStatus.TAKEN);
    expect(item.isActive).toBe(true);
    expect(item.checkIntervalSeconds).toBe(21600); // 6 hours
  });

  it('normalizes domain target to full domain name', async () => {
    const service = createService();

    const item = await service.create('user-free-1', {
      platform: Platform.DOMAIN,
      target: 'brandname',
      tld: 'uz',
    });

    expect(item.target).toBe('brandname.uz');
    expect(item.tld).toBe('uz');
  });

  it('rejects unsupported platforms (e.g. INSTAGRAM in Phase 1D)', async () => {
    const service = createService();

    await expect(
      service.create('user-free-1', {
        platform: Platform.INSTAGRAM,
        target: 'some_insta',
      })
    ).rejects.toThrow('INSTAGRAM is not supported');
  });

  it('prevents duplicate active watch items for same user, platform and target (409 Conflict)', async () => {
    const service = createService();

    await service.create('user-free-1', {
      platform: Platform.YOUTUBE,
      target: 'techchannel',
    });

    await expect(
      service.create('user-free-1', {
        platform: Platform.YOUTUBE,
        target: 'techchannel',
      })
    ).rejects.toThrow('already monitoring');
  });

  it('enforces FREE tier plan limit of maximum 3 active watch items (403 Forbidden)', async () => {
    const service = createService();

    await service.create('user-free-1', { platform: Platform.TELEGRAM, target: 'handle_one' });
    await service.create('user-free-1', { platform: Platform.TELEGRAM, target: 'handle_two' });
    await service.create('user-free-1', { platform: Platform.TELEGRAM, target: 'handle_three' });

    // 4th active item should be rejected
    await expect(
      service.create('user-free-1', { platform: Platform.TELEGRAM, target: 'handle_four' })
    ).rejects.toThrow('limit exceeded (3 for FREE plan)');
  });

  it('enforces ownership / IDOR protection (cannot view or delete another user items)', async () => {
    const service = createService();

    const item1 = await service.create('user-free-1', {
      platform: Platform.TELEGRAM,
      target: 'secret_handle',
    });

    // User 2 cannot access user 1 item
    await expect(service.getById('user-free-2', item1.id)).rejects.toThrow('not found');
    await expect(service.delete('user-free-2', item1.id)).rejects.toThrow('not found');

    // User 1 can access and delete their own item
    const fetched = await service.getById('user-free-1', item1.id);
    expect(fetched.id).toBe(item1.id);

    const deleted = await service.delete('user-free-1', item1.id);
    expect(deleted.success).toBe(true);
  });

  it('enforces cooldown rate limiting on checkNow', async () => {
    const service = createService();

    const item = await service.create('user-free-1', {
      platform: Platform.YOUTUBE,
      target: 'rapid_check',
    });

    // Immediate checkNow right after creation should encounter cooldown
    await expect(service.checkNow('user-free-1', item.id)).rejects.toThrow('Please wait');
  });
});
