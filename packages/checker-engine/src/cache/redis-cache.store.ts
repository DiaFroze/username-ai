import { CheckerResult } from '@username/shared';
import { ICacheStore } from './cache.interface.js';

export interface RedisLikeClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: any[]): Promise<any>;
}

export class RedisCacheStore implements ICacheStore {
  constructor(private readonly redis: RedisLikeClient) {}

  async get(key: string): Promise<CheckerResult | null> {
    try {
      const raw = await this.redis.get(key);
      if (!raw) return null;

      const parsed = JSON.parse(raw) as { result: CheckerResult; storedAt: number };
      if (Array.isArray(parsed.result)) {
        return parsed.result as any;
      }
      const ageMs = Date.now() - (parsed.storedAt || Date.now());

      return {
        ...parsed.result,
        cached: true,
        cacheAgeMs: ageMs,
      };
    } catch {
      // In case of Redis error or parse error, treat as cache miss safely
      return null;
    }
  }

  async set(key: string, result: CheckerResult, ttlSeconds: number): Promise<void> {
    try {
      const payload = JSON.stringify({
        result,
        storedAt: Date.now(),
      });
      await this.redis.set(key, payload, 'EX', ttlSeconds);
    } catch {
      // Non-blocking fallback if Redis write fails
    }
  }
}
