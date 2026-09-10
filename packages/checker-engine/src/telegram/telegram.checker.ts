import { Platform, CheckStatus, CheckerResult, ValidationResult } from '@username/shared';
import { BaseChecker } from '../base.checker.js';

const RESERVED_USERNAMES = new Set([
  'telegram', 'admin', 'support', 'contact', 'api', 'help', 'news',
  'settings', 'proxy', 'security', 'channel', 'group', 'bot',
  'fragment', 'ton', 'wallet', 'premium', 'username', 'login', 'register'
]);

export class TelegramChecker extends BaseChecker {
  readonly platform = Platform.TELEGRAM;

  private readonly timeoutMs: number;
  private readonly customFetch?: typeof fetch;

  constructor(options?: { timeoutMs?: number; fetch?: typeof fetch }) {
    super();
    this.timeoutMs = options?.timeoutMs ?? 5000;
    this.customFetch = options?.fetch;
  }

  validateFormat(username: string): ValidationResult {
    const clean = this.normalizeUsername(username);

    if (clean.length < 5) {
      return { valid: false, error: 'Telegram username must be at least 5 characters long' };
    }

    if (clean.length > 32) {
      return { valid: false, error: 'Telegram username cannot exceed 32 characters' };
    }

    if (!/^[a-z]/.test(clean)) {
      return { valid: false, error: 'Telegram username must start with a letter (a-z)' };
    }

    if (!/^[a-z0-9_]+$/.test(clean)) {
      return { valid: false, error: 'Telegram username can only contain letters, numbers, and underscores' };
    }

    if (clean.endsWith('_')) {
      return { valid: false, error: 'Telegram username cannot end with an underscore' };
    }

    if (clean.includes('__')) {
      return { valid: false, error: 'Telegram username cannot contain consecutive underscores' };
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

    if (RESERVED_USERNAMES.has(clean)) {
      return {
        platform: this.platform,
        username: clean,
        status: CheckStatus.TAKEN,
        checkedAt: Date.now(),
        confidence: 1.0,
        source: 'RESERVED_LIST',
        responseTimeMs: Date.now() - startTime,
        rawDetails: 'Reserved by Telegram ecosystem',
      };
    }

    const fetchFn = this.customFetch || globalThis.fetch;
    const url = `https://t.me/${clean}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    try {

      const response = await fetchFn(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        signal: controller.signal,
      });

      // Keep the deadline active while reading the body too.
      const html = await response.text();

      const responseTimeMs = Date.now() - startTime;

      if (response.status === 429) {
        return {
          platform: this.platform,
          username: clean,
          status: CheckStatus.RATE_LIMITED,
          checkedAt: Date.now(),
          confidence: 1.0,
          source: 'TELEGRAM_WEB_PUBLIC',
          responseTimeMs,
          errorCode: 'HTTP_429_RATE_LIMITED',
        };
      }

      if (response.status >= 500) {
        return {
          platform: this.platform,
          username: clean,
          status: CheckStatus.ERROR,
          checkedAt: Date.now(),
          confidence: 0.5,
          source: 'TELEGRAM_WEB_PUBLIC',
          responseTimeMs,
          errorCode: `HTTP_${response.status}_SERVER_ERROR`,
        };
      }

      if (!response.ok && response.status !== 404) {
        return {
          platform: this.platform,
          username: clean,
          status: CheckStatus.UNKNOWN,
          checkedAt: Date.now(),
          confidence: 0.5,
          source: 'TELEGRAM_WEB_PUBLIC',
          responseTimeMs,
          errorCode: `HTTP_${response.status}`,
        };
      }

      // Detection indicators:
      // An active account/channel/bot has action button and/or photo/extra info
      const hasContactPrompt = /If you have\s+(?:<strong>)?Telegram(?:<\/strong>)?,\s+you can contact/i.test(html);
      // Generic contact pages also contain Send Message and resolve links.
      // Only actual profile markup is evidence; CSS class names alone are not.
      const hasPhoto = /<[^>]+class=["'][^"']*\btgme_page_photo(?:_image)?\b[^"']*["']/i.test(html);
      const hasTitle = /<[^>]+class=["'][^"']*\btgme_page_title\b[^"']*["'][^>]*>\s*(?:<[^>]+>\s*)*[^<\s]/i.test(html);
      const hasExtra = /<[^>]+class=["'][^"']*\btgme_page_extra\b[^"']*["'][^>]*>[\s\S]*?(?:subscribers|members|@[a-z0-9_]+)[\s\S]*?<\//i.test(html);

      if (response.ok && !hasContactPrompt && hasTitle && (hasPhoto || hasExtra)) {
        return {
          platform: this.platform,
          username: clean,
          status: CheckStatus.TAKEN,
          checkedAt: Date.now(),
          confidence: 0.95,
          source: 'TELEGRAM_WEB_PUBLIC',
          responseTimeMs,
        };
      }

      // If page says "If you have Telegram, you can contact @..." with no active public elements,
      // public web cannot verify handle vacancy (user may have private account).
      // Per architectural rule: do not return optimistic AVAILABLE without definitive proof.
      if (hasContactPrompt) {
        return {
          platform: this.platform,
          username: clean,
          status: CheckStatus.UNKNOWN,
          checkedAt: Date.now(),
          confidence: 0.5,
          source: 'TELEGRAM_WEB_PUBLIC',
          responseTimeMs,
          rawDetails: 'Public web endpoint cannot definitively guarantee handle vacancy without MTProto session',
        };
      }

      // If neither conclusive TAKEN nor AVAILABLE can be determined safely, return UNKNOWN
      return {
        platform: this.platform,
        username: clean,
        status: CheckStatus.UNKNOWN,
        checkedAt: Date.now(),
        confidence: 0.4,
        source: 'TELEGRAM_WEB_PUBLIC',
        responseTimeMs,
        rawDetails: 'Indeterminate response structure',
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
        source: 'TELEGRAM_WEB_PUBLIC',
        responseTimeMs,
        errorCode: isTimeout ? 'TIMEOUT' : (err.code || err.name || 'FETCH_ERROR'),
        rawDetails: err.message,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
