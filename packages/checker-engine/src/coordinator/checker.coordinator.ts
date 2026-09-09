import {
  Platform,
  CheckStatus,
  CheckerResult,
  MultiCheckRequest,
  MultiCheckResponse,
  SUPPORTED_TLDS,
} from '@username/shared';
import { TelegramChecker } from '../telegram/telegram.checker.js';
import { YouTubeChecker } from '../youtube/youtube.checker.js';
import { DomainChecker } from '../domain/domain.checker.js';
import {
  ICacheStore,
  CheckerCacheConfig,
  DEFAULT_CACHE_CONFIG,
  buildCacheKey,
} from '../cache/cache.interface.js';
import { RequestCoalescer } from '../coalescer/request-coalescer.js';

export interface CoordinatorOptions {
  telegramChecker?: TelegramChecker;
  youtubeChecker?: YouTubeChecker;
  domainChecker?: DomainChecker;
  cache?: ICacheStore;
  cacheConfig?: Partial<CheckerCacheConfig>;
  coalescer?: RequestCoalescer;
}

export class CheckerCoordinator {
  readonly telegramChecker: TelegramChecker;
  readonly youtubeChecker: YouTubeChecker;
  readonly domainChecker: DomainChecker;

  private readonly cache?: ICacheStore;
  private readonly cacheConfig: CheckerCacheConfig;
  private readonly coalescer: RequestCoalescer;

  constructor(options?: CoordinatorOptions) {
    this.telegramChecker = options?.telegramChecker || new TelegramChecker();
    this.youtubeChecker = options?.youtubeChecker || new YouTubeChecker();
    this.domainChecker = options?.domainChecker || new DomainChecker();
    this.cache = options?.cache;
    this.cacheConfig = { ...DEFAULT_CACHE_CONFIG, ...options?.cacheConfig };
    this.coalescer = options?.coalescer || new RequestCoalescer();
  }

  /**
   * Checks a single item for a given platform with cache-aside and single-flight coalescing.
   */
  async checkSingle(
    platform: Platform,
    identifier: string,
    options?: { forceFresh?: boolean }
  ): Promise<CheckerResult> {
    const cleanId = identifier.trim().toLowerCase();
    const cacheKey = buildCacheKey(platform, cleanId);

    // 1. Cache-Aside: check cache (unless forceFresh is requested for internal background monitoring)
    if (this.cache && !options?.forceFresh) {
      const cached = await this.cache.get(cacheKey);
      if (cached) {
        return cached;
      }
    }

    // 2. Request Coalescing (Single-Flight): prevent thundering herd
    const { result } = await this.coalescer.execute(cacheKey, async () => {
      let freshResult: CheckerResult;

      switch (platform) {
        case Platform.TELEGRAM:
          freshResult = await this.telegramChecker.check(cleanId);
          break;
        case Platform.YOUTUBE:
          freshResult = await this.youtubeChecker.check(cleanId);
          break;
        case Platform.DOMAIN:
          freshResult = await this.domainChecker.check(cleanId);
          break;
        default:
          freshResult = {
            platform,
            username: cleanId,
            status: CheckStatus.ERROR,
            checkedAt: Date.now(),
            confidence: 0,
            source: 'COORDINATOR',
            responseTimeMs: 0,
            errorCode: 'UNSUPPORTED_PLATFORM',
          };
      }

      // 3. Populate Cache
      if (this.cache) {
        const ttl = this.determineTtl(freshResult);
        await this.cache.set(cacheKey, freshResult, ttl);
      }

      return freshResult;
    });

    return result;
  }

  /**
   * Executes multi-platform checks concurrently using Promise.allSettled.
   * Partial failures are isolated and never break the entire batch.
   */
  async check(request: MultiCheckRequest & { forceFresh?: boolean }): Promise<MultiCheckResponse> {
    const query = request.query.trim().toLowerCase();
    const tasks: Array<{ platform: Platform; id: string }> = [];

    // Enqueue platform check descriptors
    for (const platform of request.platforms) {
      if (platform === Platform.TELEGRAM) {
        tasks.push({ platform: Platform.TELEGRAM, id: query });
      } else if (platform === Platform.YOUTUBE) {
        tasks.push({ platform: Platform.YOUTUBE, id: query });
      } else if (platform === Platform.DOMAIN) {
        const tlds = request.tlds && request.tlds.length > 0 ? request.tlds : [...SUPPORTED_TLDS];
        for (const tld of tlds) {
          tasks.push({ platform: Platform.DOMAIN, id: `${query}.${tld}` });
        }
      }
    }

    // Execute all tasks in parallel with safe error boundaries
    const promises = tasks.map(t => this.checkSingle(t.platform, t.id, { forceFresh: request.forceFresh }));
    const settled = await Promise.allSettled(promises);

    const results: CheckerResult[] = settled.map((outcome, idx) => {
      if (outcome.status === 'fulfilled') {
        return outcome.value;
      }

      const task = tasks[idx]!;
      return {
        platform: task.platform,
        username: task.id,
        status: CheckStatus.ERROR,
        checkedAt: Date.now(),
        confidence: 0,
        source: 'COORDINATOR_FAULT_ISOLATION',
        responseTimeMs: 0,
        errorCode: 'UNCAUGHT_CHECK_EXCEPTION',
        rawDetails: outcome.reason?.message || 'Unexpected error during check',
      };
    });

    return {
      query,
      results,
    };
  }

  private determineTtl(result: CheckerResult): number {
    const isErrorOrUnknown =
      result.status === CheckStatus.UNKNOWN ||
      result.status === CheckStatus.RATE_LIMITED ||
      result.status === CheckStatus.ERROR;

    if (isErrorOrUnknown) {
      return this.cacheConfig.negativeTtlSeconds;
    }

    switch (result.platform) {
      case Platform.TELEGRAM:
        return this.cacheConfig.telegramTtlSeconds;
      case Platform.YOUTUBE:
        return this.cacheConfig.youtubeTtlSeconds;
      case Platform.DOMAIN:
        return this.cacheConfig.domainTtlSeconds;
      default:
        return 300;
    }
  }
}
