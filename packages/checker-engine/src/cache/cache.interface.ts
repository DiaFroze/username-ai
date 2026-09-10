import { CheckerResult, Platform } from '@username/shared';

export interface CheckerCacheConfig {
  telegramTtlSeconds: number;
  youtubeTtlSeconds: number;
  domainTtlSeconds: number;
  negativeTtlSeconds: number; // for UNKNOWN, RATE_LIMITED, ERROR
}

export const DEFAULT_CACHE_CONFIG: CheckerCacheConfig = {
  telegramTtlSeconds: 1800, // 30 minutes
  youtubeTtlSeconds: 3600,  // 60 minutes
  domainTtlSeconds: 3600,   // 60 minutes
  negativeTtlSeconds: 60,   // 1 minute
};

export interface ICacheStore {
  get(key: string): Promise<CheckerResult | null>;
  set(key: string, result: CheckerResult, ttlSeconds: number): Promise<void>;
}

export function buildCacheKey(platform: Platform, identifier: string): string {
  const clean = identifier.trim().toLowerCase();
  switch (platform) {
    case Platform.TELEGRAM:
      return `checker:telegram:v2:${clean}`;
    case Platform.YOUTUBE:
      return `checker:youtube:${clean}`;
    case Platform.DOMAIN:
      return `checker:domain:${clean}`;
    default:
      return `checker:${platform.toLowerCase()}:${clean}`;
  }
}
