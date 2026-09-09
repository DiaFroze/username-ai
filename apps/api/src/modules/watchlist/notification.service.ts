import {
  NotificationEventType,
  NotificationDeliveryStatus,
  Platform,
  CheckStatus,
} from '@username/shared';
import { getDb, notificationLogs, eq } from '@username/db';

export interface NotificationPayload {
  watchItemId: string;
  userId: string;
  telegramChatId: number;
  platform: Platform;
  target: string;
  eventType: NotificationEventType;
  oldStatus: CheckStatus;
  newStatus: CheckStatus;
  statusVersion?: number;
  confidence: number;
}

export type TelegramSenderFn = (
  chatId: number,
  text: string,
  extra?: { reply_markup?: any }
) => Promise<{ messageId?: string }>;

export class NotificationService {
  private readonly botToken?: string;
  private readonly customSender?: TelegramSenderFn;
  private readonly databaseUrl?: string;
  private readonly miniappUrl: string;
  private readonly inMemoryLogs = new Set<string>();

  constructor(options?: {
    botToken?: string;
    customSender?: TelegramSenderFn;
    databaseUrl?: string;
    miniappUrl?: string;
  }) {
    this.botToken = options?.botToken || process.env.TELEGRAM_BOT_TOKEN;
    this.customSender = options?.customSender;
    this.databaseUrl = options?.databaseUrl;
    this.miniappUrl = options?.miniappUrl || process.env.TELEGRAM_MINIAPP_URL || 'http://localhost:5173';
  }

  /**
   * Generates a deterministic idempotency key for status transitions using statusVersion.
   * Prevents duplicate notifications for the same transition attempt, while allowing
   * genuine repeated transitions (e.g. TAKEN -> AVAILABLE -> TAKEN -> AVAILABLE)
   * because each transition increments statusVersion.
   */
  generateIdempotencyKey(
    watchItemId: string,
    oldStatus: CheckStatus,
    newStatus: CheckStatus,
    statusVersion = 1
  ): string {
    return `notify:${watchItemId}:v${statusVersion}:${oldStatus}->${newStatus}`;
  }


  /**
   * Formats user notification text based on platform and event.
   */
  formatMessage(payload: NotificationPayload): { text: string; inlineKeyboard: any } {
    const isDomain = payload.platform === Platform.DOMAIN;
    const handleLabel = isDomain ? payload.target : `@${payload.target}`;
    const confidencePct = Math.round(payload.confidence * 100);

    const platformName =
      payload.platform === Platform.TELEGRAM
        ? 'Telegram'
        : payload.platform === Platform.YOUTUBE
        ? 'YouTube'
        : 'Domain';

    let text = '';
    if (payload.newStatus === CheckStatus.AVAILABLE) {
      text =
        `🔥 **${isDomain ? 'Домен стал доступен!' : 'Имя стало доступно!'}**\n\n` +
        `🎯 **Цель:** \`${handleLabel}\`\n` +
        `🌐 **Платформа:** ${platformName}\n` +
        `⏱️ **Проверено:** только что\n` +
        `📊 **Достоверность:** ${confidencePct}%\n\n` +
        `_Статус подтверждён двойной проверкой системы._`;
    } else {
      text =
        `ℹ️ **Изменение статуса отслеживания**\n\n` +
        `🎯 **Цель:** \`${handleLabel}\`\n` +
        `🌐 **Платформа:** ${platformName}\n` +
        `Было: **${payload.oldStatus}** ➔ Стало: **${payload.newStatus}**\n\n` +
        `⏱️ **Проверено:** только что`;
    }

    const inlineKeyboard = {
      inline_keyboard: [
        [
          {
            text: '🚀 Открыть приложение',
            web_app: { url: `${this.miniappUrl}#watchlist` },
          },
        ],
      ],
    };

    return { text, inlineKeyboard };
  }

  /**
   * Dispatches Telegram notification safely with error handling and idempotency check.
   */
  async sendNotification(payload: NotificationPayload): Promise<{
    delivered: boolean;
    status: NotificationDeliveryStatus;
    idempotencyKey: string;
    error?: string;
  }> {
    const version = payload.statusVersion || 1;
    const idempotencyKey = this.generateIdempotencyKey(
      payload.watchItemId,
      payload.oldStatus,
      payload.newStatus,
      version
    );

    // 1. Idempotency check via in-memory and DB
    if (this.inMemoryLogs.has(idempotencyKey)) {
      return {
        delivered: false,
        status: 'SKIPPED',
        idempotencyKey,
      };
    }

    try {
      const db = getDb(this.databaseUrl);
      const existing = await db
        .select()
        .from(notificationLogs)
        .where(eq(notificationLogs.idempotencyKey, idempotencyKey))
        .limit(1);

      if (existing.length > 0) {
        this.inMemoryLogs.add(idempotencyKey);
        return {
          delivered: false,
          status: 'SKIPPED',
          idempotencyKey,
        };
      }
    } catch {
      // If DB is offline, continue safely
    }

    const { text, inlineKeyboard } = this.formatMessage(payload);

    let deliveryStatus: NotificationDeliveryStatus = 'DELIVERED';
    let errorMessage: string | undefined;
    let messageId: string | undefined;

    // 2. Dispatch message
    try {
      if (this.customSender) {
        const res = await this.customSender(payload.telegramChatId, text, {
          reply_markup: inlineKeyboard,
        });
        messageId = res.messageId;
      } else if (this.botToken && !this.botToken.includes('MOCK')) {
        const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: payload.telegramChatId,
            text,
            parse_mode: 'Markdown',
            reply_markup: inlineKeyboard,
          }),
        });

        const data = (await res.json()) as any;
        if (!res.ok) {
          const description = data.description || 'Telegram API error';
          if (res.status === 403 || description.includes('blocked')) {
            deliveryStatus = 'BLOCKED';
          } else {
            deliveryStatus = 'FAILED';
          }
          errorMessage = description;
        } else {
          messageId = String(data.result?.message_id);
        }
      } else {
        // Development / mock mode
        deliveryStatus = 'DELIVERED';
        messageId = `mock_msg_${Date.now()}`;
      }
    } catch (err: any) {
      deliveryStatus = 'FAILED';
      errorMessage = err.message;
    }

    this.inMemoryLogs.add(idempotencyKey);

    // 3. Persist notification log
    try {
      const db = getDb(this.databaseUrl);
      await db.insert(notificationLogs).values({
        watchlistItemId: payload.watchItemId,
        userId: payload.userId,
        eventType: payload.eventType,
        oldStatus: payload.oldStatus,
        newStatus: payload.newStatus,
        statusVersion: version,
        status: deliveryStatus,
        telegramMessageId: messageId,
        errorMessage,
        idempotencyKey,
      });
    } catch {
      // Non-blocking
    }

    return {
      delivered: deliveryStatus === 'DELIVERED',
      status: deliveryStatus,
      idempotencyKey,
      error: errorMessage,
    };
  }
}
