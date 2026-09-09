import { Platform, CheckStatus, CheckerResult, ValidationResult } from '@username/shared';
import { BaseChecker } from '../base.checker.js';

export interface YouTubeCheckerOptions {
  apiKey?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  enableFallback?: boolean;
}

export class YouTubeChecker extends BaseChecker {
  readonly platform = Platform.YOUTUBE;

  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly customFetch?: typeof fetch;
  private readonly enableFallback: boolean;

  constructor(options?: YouTubeCheckerOptions) {
    super();
    this.apiKey = options?.apiKey || process.env.YOUTUBE_API_KEY;
    this.timeoutMs = options?.timeoutMs ?? 5000;
    this.customFetch = options?.fetch;
    this.enableFallback = options?.enableFallback ?? true;
  }

  validateFormat(username: string): ValidationResult {
    const clean = this.normalizeUsername(username);

    if (clean.length < 3) {
      return { valid: false, error: 'YouTube handle must be at least 3 characters long' };
    }

    if (clean.length > 30) {
      return { valid: false, error: 'YouTube handle cannot exceed 30 characters' };
    }

    // Must only contain letters, numbers, hyphens, underscores, and periods
    if (!/^[a-zA-Z0-9._-]+$/.test(clean)) {
      return { valid: false, error: 'YouTube handle can only contain letters, numbers, periods, hyphens, and underscores' };
    }

    // Cannot start or end with punctuation
    if (/^[._-]|[._-]$/.test(clean)) {
      return { valid: false, error: 'YouTube handle cannot start or end with a period, hyphen, or underscore' };
    }

    // Cannot contain consecutive periods
    if (clean.includes('..')) {
      return { valid: false, error: 'YouTube handle cannot contain consecutive periods' };
    }

    return { valid: true };
  }

  async check(username: string): Promise<CheckerResult> {
    const startTime = Date.now();
    const clean = this.normalizeUsername(username);
    const validation = this.validateFormat(clean);

    if (!validation.valid) {
      return {
        platform: this.platform,
        username: clean,
        status: CheckStatus.ERROR,
        checkedAt: Date.now(),
        confidence: 1.0,
        source: 'SYNTAX_VALIDATION',
        responseTimeMs: Date.now() - startTime,
        errorCode: 'INVALID_SYNTAX',
        rawDetails: validation.error,
      };
    }

    // If official API key is provided, query YouTube Data API v3
    if (this.apiKey) {
      return this.checkViaOfficialApi(clean, startTime);
    }

    // Fallback to public web check if enabled
    if (this.enableFallback) {
      return this.checkViaWeb(clean, startTime);
    }

    return {
      platform: this.platform,
      username: clean,
      status: CheckStatus.UNKNOWN,
      checkedAt: Date.now(),
      confidence: 0.0,
      source: 'YOUTUBE_NOT_CONFIGURED',
      responseTimeMs: Date.now() - startTime,
      errorCode: 'API_KEY_NOT_CONFIGURED',
      rawDetails: 'YOUTUBE_API_KEY is not configured and web fallback is disabled',
    };
  }

  private async checkViaOfficialApi(clean: string, startTime: number): Promise<CheckerResult> {
    const fetchFn = this.customFetch || globalThis.fetch;
    const url = `https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=${encodeURIComponent(clean)}&key=${this.apiKey}`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      const response = await fetchFn(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const responseTimeMs = Date.now() - startTime;

      if (response.status === 429) {
        return {
          platform: this.platform,
          username: clean,
          status: CheckStatus.RATE_LIMITED,
          checkedAt: Date.now(),
          confidence: 1.0,
          source: 'YOUTUBE_DATA_API_V3',
          responseTimeMs,
          errorCode: 'HTTP_429_RATE_LIMITED',
        };
      }

      if (response.status === 403) {
        const errorBody = await response.text().catch(() => '');
        const isQuota = errorBody.includes('quotaExceeded') || errorBody.includes('rateLimitExceeded');

        // If quota exceeded and fallback is enabled, try web fallback
        if (this.enableFallback) {
          return this.checkViaWeb(clean, startTime);
        }

        return {
          platform: this.platform,
          username: clean,
          status: isQuota ? CheckStatus.RATE_LIMITED : CheckStatus.ERROR,
          checkedAt: Date.now(),
          confidence: 0.8,
          source: 'YOUTUBE_DATA_API_V3',
          responseTimeMs,
          errorCode: isQuota ? 'QUOTA_EXCEEDED' : 'API_KEY_FORBIDDEN',
        };
      }

      if (!response.ok) {
        if (this.enableFallback) {
          return this.checkViaWeb(clean, startTime);
        }
        return {
          platform: this.platform,
          username: clean,
          status: CheckStatus.ERROR,
          checkedAt: Date.now(),
          confidence: 0.5,
          source: 'YOUTUBE_DATA_API_V3',
          responseTimeMs,
          errorCode: `HTTP_${response.status}`,
        };
      }

      const data = await response.json() as { pageInfo?: { totalResults?: number }; items?: any[] };
      const items = data.items || [];
      const totalResults = data.pageInfo?.totalResults ?? items.length;

      if (items.length > 0 || totalResults > 0) {
        return {
          platform: this.platform,
          username: clean,
          status: CheckStatus.TAKEN,
          checkedAt: Date.now(),
          confidence: 1.0,
          source: 'YOUTUBE_DATA_API_V3',
          responseTimeMs,
        };
      }

      // 0 results on official API forHandle guarantees handle is vacant
      return {
        platform: this.platform,
        username: clean,
        status: CheckStatus.AVAILABLE,
        checkedAt: Date.now(),
        confidence: 0.95,
        source: 'YOUTUBE_DATA_API_V3',
        responseTimeMs,
      };
    } catch (err: any) {
      const responseTimeMs = Date.now() - startTime;
      const isTimeout = err.name === 'AbortError' || err.name === 'TimeoutError';

      if (isTimeout) {
        return {
          platform: this.platform,
          username: clean,
          status: CheckStatus.UNKNOWN,
          checkedAt: Date.now(),
          confidence: 0.0,
          source: 'YOUTUBE_DATA_API_V3',
          responseTimeMs,
          errorCode: 'TIMEOUT',
        };
      }

      // Network error on API -> attempt web fallback if available
      if (this.enableFallback) {
        return this.checkViaWeb(clean, startTime);
      }

      return {
        platform: this.platform,
        username: clean,
        status: CheckStatus.ERROR,
        checkedAt: Date.now(),
        confidence: 0.0,
        source: 'YOUTUBE_DATA_API_V3',
        responseTimeMs,
        errorCode: err.code || err.name || 'FETCH_ERROR',
        rawDetails: err.message,
      };
    }
  }

  private async checkViaWeb(clean: string, startTime: number): Promise<CheckerResult> {
    const fetchFn = this.customFetch || globalThis.fetch;
    const url = `https://www.youtube.com/@${encodeURIComponent(clean)}`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      const response = await fetchFn(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const responseTimeMs = Date.now() - startTime;

      if (response.status === 429) {
        return {
          platform: this.platform,
          username: clean,
          status: CheckStatus.RATE_LIMITED,
          checkedAt: Date.now(),
          confidence: 0.9,
          source: 'YOUTUBE_WEB_PUBLIC',
          responseTimeMs,
          errorCode: 'HTTP_429_RATE_LIMITED',
        };
      }

      if (response.status === 404) {
        return {
          platform: this.platform,
          username: clean,
          status: CheckStatus.AVAILABLE,
          checkedAt: Date.now(),
          confidence: 0.85,
          source: 'YOUTUBE_WEB_PUBLIC',
          responseTimeMs,
        };
      }

      if (response.status === 200) {
        const html = await response.text();
        const hasChannelData = html.includes('ytInitialData') || html.includes('channelId') || html.includes('canonical');
        if (hasChannelData) {
          return {
            platform: this.platform,
            username: clean,
            status: CheckStatus.TAKEN,
            checkedAt: Date.now(),
            confidence: 0.95,
            source: 'YOUTUBE_WEB_PUBLIC',
            responseTimeMs,
          };
        }
      }

      return {
        platform: this.platform,
        username: clean,
        status: CheckStatus.UNKNOWN,
        checkedAt: Date.now(),
        confidence: 0.4,
        source: 'YOUTUBE_WEB_PUBLIC',
        responseTimeMs,
        rawDetails: `Indeterminate HTTP ${response.status}`,
      };
    } catch (err: any) {
      const responseTimeMs = Date.now() - startTime;
      const isTimeout = err.name === 'AbortError' || err.name === 'TimeoutError';

      return {
        platform: this.platform,
        username: clean,
        status: isTimeout ? CheckStatus.UNKNOWN : CheckStatus.ERROR,
        checkedAt: Date.now(),
        confidence: 0.0,
        source: 'YOUTUBE_WEB_PUBLIC',
        responseTimeMs,
        errorCode: isTimeout ? 'TIMEOUT' : (err.code || err.name || 'FETCH_ERROR'),
        rawDetails: err.message,
      };
    }
  }
}
