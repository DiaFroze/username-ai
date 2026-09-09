import * as dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bot, InlineKeyboard } from 'grammy';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const token = process.env.TELEGRAM_BOT_TOKEN;
const miniappUrl = process.env.TELEGRAM_MINIAPP_URL || 'http://localhost:5173';

export function createBot(botToken: string): Bot {
  const bot = new Bot(botToken);

  // Command /start
  bot.command('start', async (ctx) => {
    const userName = ctx.from?.first_name || 'друг';
    const welcomeText =
      `👋 Привет, ${userName}!\n\n` +
      `Добро пожаловать в **Username AI** — сервис мгновенного поиска, ` +
      `AI-генерации, Brand Score и кросс-платформенной проверки юзернеймов (Telegram, YouTube, Domains).\n\n` +
      `✨ **Возможности сервиса:**\n` +
      `• AI Генератор брендовых имен и юзернеймов\n` +
      `• Расчет Brand Score (0–100) с прозрачной декомпозицией\n` +
      `• Режим "One Name Everywhere": подбор имен, свободных везде\n` +
      `• Мгновенная проверка Telegram, YouTube, .com, .uz, .ai\n\n` +
      `Нажми на кнопку ниже, чтобы открыть Mini App:`;

    const keyboard = new InlineKeyboard().webApp('🚀 Открыть Username AI', miniappUrl);

    await ctx.reply(welcomeText, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  });

  // Command /help
  bot.command('help', async (ctx) => {
    const helpText =
      `📖 **Справка по Username AI**\n\n` +
      `1. Откройте Mini App по кнопке ниже.\n` +
      `2. Выберите категорию или цель (Бренд, Бизнес, Личный аккаунт, AI).\n` +
      `3. Введите ключевое слово или фразу.\n` +
      `4. Получите проверенные варианты с оценкой Brand Score.`;

    const keyboard = new InlineKeyboard().webApp('🚀 Открыть Username AI', miniappUrl);
    await ctx.reply(helpText, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  });

  // Command /watchlist (Phase 1D)
  bot.command('watchlist', async (ctx) => {
    const watchlistText =
      `🔔 **Мои отслеживания (Watchlist)**\n\n` +
      `Здесь вы можете просматривать статус отслеживаемых юзернеймов и доменов.\n` +
      `Когда имя станет доступно, бот немедленно пришлет вам уведомление!\n\n` +
      `Нажмите на кнопку ниже, чтобы открыть экран отслеживания:`;

    const keyboard = new InlineKeyboard().webApp('🔔 Открыть мои отслеживания', `${miniappUrl}#watchlist`);

    await ctx.reply(watchlistText, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  });

  // Global bot error handler
  bot.catch((err) => {
    console.error(`[TelegramBot Error] [Update ID: ${err.ctx.update.update_id}]:`, err.error);
  });

  return bot;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (!token || token.includes('MOCK') || token.includes('ABCdef')) {
    console.warn('⚠️  [TelegramBot] TELEGRAM_BOT_TOKEN is not configured or using default mock value. Set valid token in .env to run live polling.');
  } else {
    const bot = createBot(token);
    console.log('🤖 Telegram Bot is starting polling...');
    void bot.start({
      onStart: (info) => console.log(`✅ Bot @${info.username} started successfully!`),
    });

    process.once('SIGINT', () => { void bot.stop(); });
    process.once('SIGTERM', () => { void bot.stop(); });
  }
}
