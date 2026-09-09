import crypto from 'node:crypto';
import { GeneratedCandidate, NamingRequest } from '@username/shared';
import { ICacheStore } from '@username/checker-engine';

export class AiNamingCache {
  private readonly defaultTtlSeconds: number;

  constructor(
    private readonly cacheStore?: ICacheStore,
    ttlSeconds = 14400 // 4 hours
  ) {
    this.defaultTtlSeconds = ttlSeconds;
  }

  generateKey(input: NamingRequest, model = 'default'): string {
    const raw = `${input.query.trim().toLowerCase()}|${input.intent}|${input.language || 'ru'}|${input.category || ''}|${model}`;
    const hash = crypto.createHash('sha256').update(raw).digest('hex').substring(0, 16);
    return `ai:naming:${hash}`;
  }

  async get(input: NamingRequest, model?: string): Promise<GeneratedCandidate[] | null> {
    if (!this.cacheStore) return null;

    const key = this.generateKey(input, model);
    try {
      const cached = await (this.cacheStore as any).get(key);
      if (cached && Array.isArray(cached)) {
        return cached;
      }
      return null;
    } catch {
      return null;
    }
  }

  async set(input: NamingRequest, candidates: GeneratedCandidate[], model?: string): Promise<void> {
    if (!this.cacheStore) return;

    const key = this.generateKey(input, model);
    try {
      await (this.cacheStore as any).set(key, candidates, this.defaultTtlSeconds);
    } catch {
      // Non-blocking
    }
  }
}
