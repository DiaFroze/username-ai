import { CheckerResult } from '@username/shared';
import { ICacheStore } from './cache.interface.js';

interface CacheEntry {
  result: CheckerResult;
  expiresAt: number;
  storedAt: number;
}

export class InMemoryCacheStore implements ICacheStore {
  private readonly store = new Map<string, CacheEntry>();

  async get(key: string): Promise<CheckerResult | null> {
    const entry = this.store.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }

    if (Array.isArray(entry.result)) {
      return entry.result as any;
    }

    const ageMs = Date.now() - entry.storedAt;
    return {
      ...entry.result,
      cached: true,
      cacheAgeMs: ageMs,
    };
  }

  async set(key: string, result: CheckerResult, ttlSeconds: number): Promise<void> {
    this.store.set(key, {
      result,
      expiresAt: Date.now() + ttlSeconds * 1000,
      storedAt: Date.now(),
    });
  }

  clear(): void {
    this.store.clear();
  }
}
