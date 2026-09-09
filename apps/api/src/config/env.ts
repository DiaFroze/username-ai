import { z } from 'zod';
import * as dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_MINIAPP_URL: z.string().default('http://localhost:5173'),
  JWT_SECRET: z.string().default('dev-jwt-secret-minimum-32-characters-length-ok!'),
  AI_PROVIDER: z.string().default('mock'),
  AI_MODEL: z.string().default('mock-model'),
  AI_FALLBACK_PROVIDER: z.string().default('mock'),
  AI_FALLBACK_MODEL: z.string().default('mock-fallback'),
  OPENAI_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  YOUTUBE_API_KEY: z.string().optional(),
  WATCHLIST_ABSOLUTE_MIN_INTERVAL_MINUTES: z.coerce.number().min(60).default(60),
  WATCHLIST_CONCURRENCY: z.coerce.number().min(1).max(20).default(5),
  CORS_ALLOWED_ORIGINS: z.string().default('http://localhost:5173,https://web.telegram.org'),
  OFFLINE_DEV: z.string().optional(),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().default(10), // 10 attempts / min / IP
  RATE_LIMIT_CHECK_MAX: z.coerce.number().default(30), // 30 req / min / user
  RATE_LIMIT_NAMING_MAX: z.coerce.number().default(10), // 10 req / min / user
  RATE_LIMIT_DEFAULT_MAX: z.coerce.number().default(120), // 120 req / min default
  INTERNAL_ADMIN_TOKEN: z.string().optional(),
  STAGING_TEST_KEY: z.string().optional(),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadAndValidateConfig(rawEnv: Record<string, any> = process.env): AppConfig {
  const result = envSchema.safeParse(rawEnv);

  if (!result.success) {
    const errorDetails = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    console.error('⛔ FATAL: Environment configuration validation failed:\n' + errorDetails);
    throw new Error('Invalid environment configuration');
  }

  const config = result.data;

  // Staging / Production Fail-Fast Checks
  if (config.NODE_ENV === 'production' || config.NODE_ENV === 'staging') {
    const missing: string[] = [];

    if (!config.DATABASE_URL || config.DATABASE_URL.includes('localhost')) {
      missing.push('DATABASE_URL (must be configured with production postgres URI)');
    }
    if (!config.REDIS_URL || config.REDIS_URL.includes('mock') || config.REDIS_URL.includes('offline')) {
      missing.push('REDIS_URL (must be configured with production redis URI)');
    }
    if (!config.TELEGRAM_BOT_TOKEN || config.TELEGRAM_BOT_TOKEN.includes('MOCK') || config.TELEGRAM_BOT_TOKEN.includes('123456')) {
      missing.push('TELEGRAM_BOT_TOKEN (must be genuine Telegram Bot API token)');
    }
    if (!config.JWT_SECRET || config.JWT_SECRET.length < 32 || config.JWT_SECRET.includes('dev-')) {
      missing.push('JWT_SECRET (must be high-entropy secret of at least 32 characters)');
    }

    if (missing.length > 0) {
      const msg = `⛔ FATAL: Missing or invalid required production configuration:\n` +
        missing.map((m) => `  - ${m}`).join('\n');
      console.error(msg);
      throw new Error(`Production configuration validation failed: missing ${missing.length} required settings`);
    }
  }

  return config;
}

export const appConfig = loadAndValidateConfig();