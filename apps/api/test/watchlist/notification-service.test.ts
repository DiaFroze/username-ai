import { describe, it, expect, vi } from 'vitest';
import { NotificationService } from '../../src/modules/watchlist/notification.service.js';
import { Platform, CheckStatus } from '@username/shared';

describe('NotificationService', () => {
  it('formats notification text with Markdown and WebApp inline keyboard', () => {
    const service = new NotificationService({ miniappUrl: 'https://username.ai/app' });

    const message = service.formatMessage({
      watchItemId: 'w-1',
      userId: 'u-1',
      telegramChatId: 12345678,
      platform: Platform.YOUTUBE,
      target: 'cool_brand',
      eventType: 'STATUS_CHANGED_AVAILABLE',
      oldStatus: CheckStatus.TAKEN,
      newStatus: CheckStatus.AVAILABLE,
      confidence: 0.95,
    });

    expect(message.text).toContain('Имя стало доступно!');
    expect(message.text).toContain('@cool_brand');
    expect(message.text).toContain('YouTube');
    expect(message.inlineKeyboard.inline_keyboard[0][0].web_app.url).toContain('#watchlist');
  });

  it('generates consistent idempotency keys for same transition window', () => {
    const service = new NotificationService();

    const key1 = service.generateIdempotencyKey('w-1', CheckStatus.TAKEN, CheckStatus.AVAILABLE, 100);
    const key2 = service.generateIdempotencyKey('w-1', CheckStatus.TAKEN, CheckStatus.AVAILABLE, 100);
    const keyDiff = service.generateIdempotencyKey('w-1', CheckStatus.TAKEN, CheckStatus.AVAILABLE, 101);

    expect(key1).toBe(key2);
    expect(key1).not.toBe(keyDiff);
  });

  it('dispatches notification and handles successful delivery', async () => {
    const mockSender = vi.fn().mockResolvedValue({ messageId: 'msg_999' });
    const service = new NotificationService({ customSender: mockSender });

    const result = await service.sendNotification({
      watchItemId: 'w-100',
      userId: 'u-100',
      telegramChatId: 12345678,
      platform: Platform.DOMAIN,
      target: 'novexa.uz',
      eventType: 'STATUS_CHANGED_AVAILABLE',
      oldStatus: CheckStatus.TAKEN,
      newStatus: CheckStatus.AVAILABLE,
      confidence: 1.0,
    });

    expect(mockSender).toHaveBeenCalledTimes(1);
    expect(result.delivered).toBe(true);
    expect(result.status).toBe('DELIVERED');
  });

  it('handles Telegram bot blocked error safely without throwing', async () => {
    const mockSender = vi.fn().mockRejectedValue(new Error('Forbidden: bot was blocked by the user'));
    const service = new NotificationService({ customSender: mockSender });

    const result = await service.sendNotification({
      watchItemId: 'w-200',
      userId: 'u-200',
      telegramChatId: 88888888,
      platform: Platform.YOUTUBE,
      target: 'blocked_user',
      eventType: 'STATUS_CHANGED_AVAILABLE',
      oldStatus: CheckStatus.TAKEN,
      newStatus: CheckStatus.AVAILABLE,
      confidence: 0.9,
    });

    expect(result.delivered).toBe(false);
    expect(result.status).toBe('FAILED');
    expect(result.error).toContain('blocked');
  });
});
