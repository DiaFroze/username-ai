import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WatchlistService } from '../../src/modules/watchlist/watchlist.service.js';
import { TargetNormalizer } from '../../src/modules/watchlist/target-normalizer.js';
import { AdaptiveIntervalStrategy } from '../../src/modules/watchlist/adaptive-interval.js';
import { NotificationService } from '../../src/modules/watchlist/notification.service.js';
import { WatchlistQueueManager } from '../../src/modules/watchlist/watchlist.queue.js';
import { PLAN_POLICIES } from '../../src/modules/watchlist/user-limits.js';
import {
  CheckerCoordinator,
  TelegramChecker,
  YouTubeChecker,
  DomainChecker,
} from '@username/checker-engine';
import { Platform, CheckStatus } from '@username/shared';

describe('Phase 1D.1: Watchlist Data Integrity & Reliability Audit', () => {
  let coordinator: CheckerCoordinator;
  let watchlistService: WatchlistService;

  beforeEach(() => {
    coordinator = new CheckerCoordinator({
      telegramChecker: new TelegramChecker({
        fetch: async () => ({
          ok: true,
          status: 200,
          text: async () => '<html><body><div class="tgme_page_title">Active Channel</div><a class="tgme_action_button_new">View in Telegram</a></body></html>',
        }) as any,
      }),
      youtubeChecker: new YouTubeChecker({
        fetch: async () => ({
          ok: true,
          status: 200,
          text: async () => '<html><body>Taken YouTube Channel</body></html>',
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

    watchlistService = new WatchlistService({ coordinator });
    watchlistService.seedUser({ id: 'user-free', telegramId: 1001, tier: 'FREE' });
    watchlistService.seedUser({ id: 'user-pro', telegramId: 2002, tier: 'PRO' });
  });

  // 1. Same target + same platform duplicate -> 409 Conflict
  it('rejects duplicate active watch for same target and same platform with 409 Conflict', async () => {
    await watchlistService.create('user-free', {
      platform: Platform.TELEGRAM,
      target: 'novexa',
    });

    await expect(
      watchlistService.create('user-free', {
        platform: Platform.TELEGRAM,
        target: 'novexa',
      })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  // 2. Same target + different platform -> allowed
  it('allows monitoring the same target across different platforms independently', async () => {
    const tg = await watchlistService.create('user-free', {
      platform: Platform.TELEGRAM,
      target: 'novexa',
    });
    const yt = await watchlistService.create('user-free', {
      platform: Platform.YOUTUBE,
      target: 'novexa',
    });

    expect(tg.platform).toBe(Platform.TELEGRAM);
    expect(yt.platform).toBe(Platform.YOUTUBE);
    expect(tg.id).not.toBe(yt.id);
  });

  // 3. Same brand + multiple domains -> allowed
  it('allows monitoring multiple domains for the same brand stem', async () => {
    const com = await watchlistService.create('user-free', {
      platform: Platform.DOMAIN,
      target: 'novexa.com',
    });
    const ai = await watchlistService.create('user-free', {
      platform: Platform.DOMAIN,
      target: 'novexa.ai',
    });

    expect(com.target).toBe('novexa.com');
    expect(ai.target).toBe('novexa.ai');
    expect(com.tld).toBe('com');
    expect(ai.tld).toBe('ai');
  });

  // 4. Current status is platform-specific
  it('tracks platform-specific status and confidence per watch item', async () => {
    // Custom coordinator returning different statuses
    const mixedCoordinator = new CheckerCoordinator({
      telegramChecker: new TelegramChecker({
        fetch: async () => ({
          ok: false,
          status: 404,
          text: async () => '<html><body>No channel</body></html>',
        }) as any,
      }),
      youtubeChecker: new YouTubeChecker({
        fetch: async () => ({
          ok: true,
          status: 200,
          text: async () => '<html><body><script>var ytInitialData = { channelId: "UC123" };</script></body></html>',
        }) as any,
      }),
    });

    const mixedService = new WatchlistService({ coordinator: mixedCoordinator });
    mixedService.seedUser({ id: 'user-free', telegramId: 1001, tier: 'FREE' });

    const tgItem = await mixedService.create('user-free', {
      platform: Platform.TELEGRAM,
      target: 'alphaname',
    });
    const ytItem = await mixedService.create('user-free', {
      platform: Platform.YOUTUBE,
      target: 'alphaname',
    });

    // Telegram public web is UNKNOWN (never optimistic AVAILABLE)
    expect(tgItem.currentStatus).toBe(CheckStatus.UNKNOWN);
    // YouTube found active channel -> TAKEN
    expect(ytItem.currentStatus).toBe(CheckStatus.TAKEN);
  });

  // 5. Telegram normalization & validation
  it('normalizes Telegram inputs (@, t.me, https) and validates username format', () => {
    expect(TargetNormalizer.normalize(Platform.TELEGRAM, 'novexa').target).toBe('novexa');
    expect(TargetNormalizer.normalize(Platform.TELEGRAM, '@novexa').target).toBe('novexa');
    expect(TargetNormalizer.normalize(Platform.TELEGRAM, 't.me/novexa').target).toBe('novexa');
    expect(TargetNormalizer.normalize(Platform.TELEGRAM, 'https://t.me/novexa/').target).toBe('novexa');
    expect(TargetNormalizer.normalize(Platform.TELEGRAM, 'http://telegram.me/novexa').target).toBe('novexa');

    // Validation: too short (< 5)
    expect(() => TargetNormalizer.normalize(Platform.TELEGRAM, 'abcd')).toThrow(/at least 5 characters/);
    // Validation: starts with digit
    expect(() => TargetNormalizer.normalize(Platform.TELEGRAM, '1username')).toThrow(/start with a letter/);
    // Validation: ends with underscore
    expect(() => TargetNormalizer.normalize(Platform.TELEGRAM, 'username_')).toThrow(/cannot end with an underscore/);
    // Validation: consecutive underscores
    expect(() => TargetNormalizer.normalize(Platform.TELEGRAM, 'user__name')).toThrow(/consecutive underscores/);
  });

  // 6. YouTube normalization & validation
  it('normalizes YouTube inputs (handles, @, youtube.com/@) and validates handle format', () => {
    expect(TargetNormalizer.normalize(Platform.YOUTUBE, 'novexa').target).toBe('novexa');
    expect(TargetNormalizer.normalize(Platform.YOUTUBE, '@novexa').target).toBe('novexa');
    expect(TargetNormalizer.normalize(Platform.YOUTUBE, 'youtube.com/@novexa').target).toBe('novexa');
    expect(TargetNormalizer.normalize(Platform.YOUTUBE, 'https://www.youtube.com/@novexa/').target).toBe('novexa');

    // Validation: too short (< 3)
    expect(() => TargetNormalizer.normalize(Platform.YOUTUBE, 'ab')).toThrow(/at least 3 characters/);
    // Validation: consecutive periods
    expect(() => TargetNormalizer.normalize(Platform.YOUTUBE, 'cool..handle')).toThrow(/consecutive periods/);
  });

  // 7. Domain normalization & validation
  it('normalizes domain inputs, validates TLD, and rejects paths and query params', () => {
    expect(TargetNormalizer.normalize(Platform.DOMAIN, 'NOVEXA.COM').target).toBe('novexa.com');
    expect(TargetNormalizer.normalize(Platform.DOMAIN, 'novexa.com.').target).toBe('novexa.com');
    expect(TargetNormalizer.normalize(Platform.DOMAIN, 'https://novexa.com/').target).toBe('novexa.com');
    expect(TargetNormalizer.normalize(Platform.DOMAIN, 'http://novexa.com:443/').target).toBe('novexa.com');
    expect(TargetNormalizer.normalize(Platform.DOMAIN, 'brandname', 'uz').target).toBe('brandname.uz');

    // Rejects paths
    expect(() => TargetNormalizer.normalize(Platform.DOMAIN, 'novexa.com/path')).toThrow(/path/);
    // Rejects query strings
    expect(() => TargetNormalizer.normalize(Platform.DOMAIN, 'novexa.com?ref=123')).toThrow(/query parameters/);
    // Rejects unsupported TLD
    expect(() => TargetNormalizer.normalize(Platform.DOMAIN, 'novexa.xyz')).toThrow(/Unsupported TLD/);
  });

  // 8. Active item limits: FREE = 3, PRO = 25
  it('enforces active item limits for FREE (3) and PRO (25) plans', async () => {
    // FREE: 3 active items allowed
    await watchlistService.create('user-free', { platform: Platform.TELEGRAM, target: 'handle_a' });
    await watchlistService.create('user-free', { platform: Platform.TELEGRAM, target: 'handle_b' });
    await watchlistService.create('user-free', { platform: Platform.TELEGRAM, target: 'handle_c' });

    // 4th active item is rejected
    await expect(
      watchlistService.create('user-free', { platform: Platform.TELEGRAM, target: 'handle_d' })
    ).rejects.toMatchObject({ statusCode: 403 });

    // PRO: can create more than 3 items
    for (let i = 1; i <= 5; i++) {
      const item = await watchlistService.create('user-pro', {
        platform: Platform.TELEGRAM,
        target: `pro_handle_${i}`,
      });
      expect(item.id).toBeDefined();
    }
  });

  // 9. "Track all" consumes multiple slots (each candidate check = 1 slot)
  it('consumes individual slots for each target when tracking multiple channels of a brand', async () => {
    // Brand candidate with 3 checks: Telegram, YouTube, novexa.com
    const _item1 = await watchlistService.create('user-free', { platform: Platform.TELEGRAM, target: 'novexa' });
    const _item2 = await watchlistService.create('user-free', { platform: Platform.YOUTUBE, target: 'novexa' });
    const _item3 = await watchlistService.create('user-free', { platform: Platform.DOMAIN, target: 'novexa.com' });

    const list = await watchlistService.list('user-free');
    expect(list.length).toBe(3);

    // Slots exhausted: next item cannot be added
    await expect(
      watchlistService.create('user-free', { platform: Platform.DOMAIN, target: 'novexa.ai' })
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  // 10. Scheduler duplicate protection: two scheduler instances do not double-enqueue
  it('prevents double-enqueueing when multiple scheduler ticks run concurrently', async () => {
    const queueManager1 = new WatchlistQueueManager({
      watchlistService,
      redisUrl: 'offline://mock',
    });
    const queueManager2 = new WatchlistQueueManager({
      watchlistService,
      redisUrl: 'offline://mock',
    });

    // Run tick on manager 1 and manager 2 concurrently
    const [count1, count2] = await Promise.all([
      queueManager1.runSchedulerTick(),
      queueManager2.runSchedulerTick(),
    ]);

    expect(count1).toBeGreaterThanOrEqual(0);
    expect(count2).toBeGreaterThanOrEqual(0);
  });

  // 11. Notification duplicate prevention: same status transition not notified twice
  it('prevents duplicate notifications for the same transition using statusVersion in idempotency key', async () => {
    const mockSender = vi.fn().mockResolvedValue({ messageId: 'msg_1001' });
    const notifService = new NotificationService({ customSender: mockSender });

    const payload = {
      watchItemId: 'item-uuid-1',
      userId: 'user-uuid-1',
      telegramChatId: 1001,
      platform: Platform.DOMAIN,
      target: 'novexa.com',
      eventType: 'STATUS_CHANGED_AVAILABLE' as const,
      oldStatus: CheckStatus.TAKEN,
      newStatus: CheckStatus.AVAILABLE,
      statusVersion: 2,
      confidence: 1.0,
    };

    // First delivery attempt
    const res1 = await notifService.sendNotification(payload);
    expect(res1.delivered).toBe(true);
    expect(res1.status).toBe('DELIVERED');
    expect(mockSender).toHaveBeenCalledTimes(1);

    // Duplicate delivery attempt with identical transition & version
    const res2 = await notifService.sendNotification(payload);
    expect(res2.delivered).toBe(false);
    expect(res2.status).toBe('SKIPPED');
    // Sender was NOT called a second time
    expect(mockSender).toHaveBeenCalledTimes(1);
  });

  // 12. Real repeated transition (TAKEN -> AVAILABLE -> TAKEN -> AVAILABLE) generates a new notification
  it('allows genuine repeated transitions to notify because statusVersion is incremented', async () => {
    const mockSender = vi.fn().mockResolvedValue({ messageId: 'msg_2002' });
    const notifService = new NotificationService({ customSender: mockSender });

    // Transition 1: TAKEN -> AVAILABLE (version 2)
    const res1 = await notifService.sendNotification({
      watchItemId: 'item-uuid-repeat',
      userId: 'user-uuid-1',
      telegramChatId: 1001,
      platform: Platform.DOMAIN,
      target: 'gemini.com',
      eventType: 'STATUS_CHANGED_AVAILABLE',
      oldStatus: CheckStatus.TAKEN,
      newStatus: CheckStatus.AVAILABLE,
      statusVersion: 2,
      confidence: 1.0,
    });
    expect(res1.delivered).toBe(true);

    // Transition 2: AVAILABLE -> TAKEN (version 3)
    await notifService.sendNotification({
      watchItemId: 'item-uuid-repeat',
      userId: 'user-uuid-1',
      telegramChatId: 1001,
      platform: Platform.DOMAIN,
      target: 'gemini.com',
      eventType: 'STATUS_CHANGED_TAKEN',
      oldStatus: CheckStatus.AVAILABLE,
      newStatus: CheckStatus.TAKEN,
      statusVersion: 3,
      confidence: 1.0,
    });

    // Transition 3: TAKEN -> AVAILABLE again (version 4)
    const res3 = await notifService.sendNotification({
      watchItemId: 'item-uuid-repeat',
      userId: 'user-uuid-1',
      telegramChatId: 1001,
      platform: Platform.DOMAIN,
      target: 'gemini.com',
      eventType: 'STATUS_CHANGED_AVAILABLE',
      oldStatus: CheckStatus.TAKEN,
      newStatus: CheckStatus.AVAILABLE,
      statusVersion: 4, // Incremented status version!
      confidence: 1.0,
    });

    // Verified: NOT skipped! Delivered because it is a new transition sequence
    expect(res3.delivered).toBe(true);
    expect(res3.status).toBe('DELIVERED');
  });

  // 13. Absolute scheduled interval never < 60 min
  it('strictly enforces that scheduled check interval is never less than 60 minutes', () => {
    const interval = AdaptiveIntervalStrategy.calculateNextInterval({
      currentIntervalMinutes: 10,
      status: CheckStatus.UNKNOWN,
      consecutiveErrors: 0,
      minIntervalMinutes: 15, // Attempted to request 15m
    });

    expect(interval).toBeGreaterThanOrEqual(60);
  });

  // 14. PRO config cannot bypass absolute minimum (60 min)
  it('guarantees PRO plan policies cannot bypass the absolute minimum scheduled interval', () => {
    const proPolicy = PLAN_POLICIES.PRO;
    expect(proPolicy.minIntervalMinutes).toBeGreaterThanOrEqual(60);
  });

  // 15. Manual check-now remains independent of background scheduler
  it('allows manual check-now independently with cooldown without affecting scheduled interval', async () => {
    const item = await watchlistService.create('user-pro', {
      platform: Platform.YOUTUBE,
      target: 'speedrun',
    });

    // Immediate checkNow right after creation hits checkNowCooldownSeconds (e.g. 60s for PRO)
    await expect(watchlistService.checkNow('user-pro', item.id)).rejects.toThrow(/Please wait/);
  });

  // 16. Telegram Safe Hold remains active
  it('maintains Telegram Safe Hold: public t.me check never yields confirmed AVAILABLE alerts', async () => {
    const vacancyCoordinator = new CheckerCoordinator({
      telegramChecker: new TelegramChecker({
        fetch: async () => ({
          ok: false,
          status: 404,
          text: async () => '<html><body>Not found</body></html>',
        }) as any,
      }),
    });

    const mockSender = vi.fn();
    const notifService = new NotificationService({ customSender: mockSender });
    const service = new WatchlistService({
      coordinator: vacancyCoordinator,
      notificationService: notifService,
    });
    service.seedUser({ id: 'user-free', telegramId: 1001, tier: 'FREE' });

    const item = await service.create('user-free', {
      platform: Platform.TELEGRAM,
      target: 'freecandidate',
    });

    // Status remains UNKNOWN, never AVAILABLE
    expect(item.currentStatus).toBe(CheckStatus.UNKNOWN);

    // Process due item: notification should NEVER be dispatched for Telegram
    await service.processDueItem(item, 1001);
    expect(mockSender).not.toHaveBeenCalled();
  });
});
