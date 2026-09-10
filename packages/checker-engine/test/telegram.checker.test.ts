import { describe, it, expect } from 'vitest';
import { TelegramChecker } from '../src/telegram/telegram.checker.js';
import { Platform, CheckStatus } from '@username/shared';

describe('TelegramChecker', () => {
  const checker = new TelegramChecker();

  describe('validateFormat', () => {
    it('rejects usernames shorter than 5 chars', () => {
      expect(checker.validateFormat('abc').valid).toBe(false);
      expect(checker.validateFormat('abcd').valid).toBe(false);
    });

    it('rejects usernames starting with non-letter', () => {
      expect(checker.validateFormat('1username').valid).toBe(false);
      expect(checker.validateFormat('_username').valid).toBe(false);
    });

    it('rejects usernames with consecutive underscores or ending with underscore', () => {
      expect(checker.validateFormat('user__name').valid).toBe(false);
      expect(checker.validateFormat('username_').valid).toBe(false);
    });

    it('rejects usernames longer than 32 chars', () => {
      expect(checker.validateFormat('a'.repeat(33)).valid).toBe(false);
    });

    it('accepts valid usernames', () => {
      expect(checker.validateFormat('valid_user').valid).toBe(true);
      expect(checker.validateFormat('nova2026').valid).toBe(true);
      expect(checker.validateFormat('abdulloh').valid).toBe(true);
    });
  });

  describe('check logic with mocked responses', () => {
    it.each([
      'If you have <strong>Telegram</strong>, you can contact <a>@randomname</a> right away.',
      'If you have Telegram, you can contact @randomname right away.',
    ])('does not treat a generic contact page with Send Message as taken: %s', async prompt => {
      const checker = new TelegramChecker({ fetch: (async () => new Response(`<style>.tgme_page_photo { display:block }</style><div class="tgme_page_description">${prompt}</div><a class="tgme_action_button_new">Send Message</a>`)) as typeof fetch });
      expect((await checker.check('randomname')).status).toBe(CheckStatus.UNKNOWN);
    });

    it('does not infer taken from a lone action button or CSS', async () => {
      const checker = new TelegramChecker({ fetch: (async () => new Response('<style>.tgme_page_photo{}</style><a class="tgme_action_button_new">Send Message</a>')) as typeof fetch });
      expect((await checker.check('randomname')).status).toBe(CheckStatus.UNKNOWN);
    });
    it('returns TAKEN for reserved usernames immediately without network call', async () => {
      const result = await checker.check('telegram');
      expect(result.status).toBe(CheckStatus.TAKEN);
      expect(result.source).toBe('RESERVED_LIST');
      expect(result.platform).toBe(Platform.TELEGRAM);
      expect(result.confidence).toBe(1.0);
    });

    it('returns ERROR for invalid format immediately', async () => {
      const result = await checker.check('123');
      expect(result.status).toBe(CheckStatus.ERROR);
      expect(result.errorCode).toBe('INVALID_SYNTAX');
    });

    it('returns TAKEN when Telegram page has action button', async () => {
      const mockFetch = async () => ({
        ok: true,
        status: 200,
        text: async () => `
          <html>
            <body>
              <div class="tgme_page_photo"></div>
              <div class="tgme_page_title">Awesome Channel</div>
              <div class="tgme_page_extra">10 500 subscribers</div>
              <a class="tgme_action_button_new" href="tg://resolve?domain=awesome">View in Telegram</a>
            </body>
          </html>
        `,
      }) as any;

      const customChecker = new TelegramChecker({ fetch: mockFetch });
      const result = await customChecker.check('awesome_channel');
      expect(result.status).toBe(CheckStatus.TAKEN);
      expect(result.confidence).toBe(0.95);
    });

    it('returns UNKNOWN when Telegram page indicates unassigned handle with no action elements (never optimistic AVAILABLE from public web alone)', async () => {
      const mockFetch = async () => ({
        ok: true,
        status: 200,
        text: async () => `
          <html>
            <body>
              <div class="tgme_page_description">
                If you have <strong>Telegram</strong>, you can contact <a class="tgme_username" href="...">@unregistered_name</a> right away.
              </div>
            </body>
          </html>
        `,
      }) as any;

      const customChecker = new TelegramChecker({ fetch: mockFetch });
      const result = await customChecker.check('unregistered_name');
      expect(result.status).toBe(CheckStatus.UNKNOWN);
      expect(result.rawDetails).toContain('MTProto');
    });

    it('returns RATE_LIMITED when HTTP 429 is encountered', async () => {
      const mockFetch = async () => ({
        ok: false,
        status: 429,
        text: async () => 'Too Many Requests',
      }) as any;

      const customChecker = new TelegramChecker({ fetch: mockFetch });
      const result = await customChecker.check('some_name');
      expect(result.status).toBe(CheckStatus.RATE_LIMITED);
      expect(result.errorCode).toBe('HTTP_429_RATE_LIMITED');
    });

    it('returns UNKNOWN on timeout and NEVER returns AVAILABLE', async () => {
      const mockFetch = async () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        throw err;
      };

      const customChecker = new TelegramChecker({ fetch: mockFetch as any });
      const result = await customChecker.check('timeout_name');
      expect(result.status).toBe(CheckStatus.UNKNOWN);
      expect(result.errorCode).toBe('TIMEOUT');
    });

    it('returns UNKNOWN for indeterminate HTML response (never assumes AVAILABLE on unknown structure)', async () => {
      const mockFetch = async () => ({
        ok: true,
        status: 200,
        text: async () => '<html><body>Something weird or captcha challenge</body></html>',
      }) as any;

      const customChecker = new TelegramChecker({ fetch: mockFetch });
      const result = await customChecker.check('weird_name');
      expect(result.status).toBe(CheckStatus.UNKNOWN);
    });

    it('CRITICAL REGRESSION: never returns AVAILABLE from public web response under 404 or empty contact prompt scenario', async () => {
      const mock404Fetch = async () => ({
        ok: false,
        status: 404,
        text: async () => '<html><body>Not found or empty channel</body></html>',
      }) as any;

      const customChecker = new TelegramChecker({ fetch: mock404Fetch });
      const result = await customChecker.check('vacant_looking');
      expect(result.status).toBe(CheckStatus.UNKNOWN);
      expect(result.status).not.toBe(CheckStatus.AVAILABLE);
    });

    it('CRITICAL REGRESSION: never returns AVAILABLE on server error or rate limits', async () => {
      const mock500Fetch = async () => ({
        ok: false,
        status: 503,
        text: async () => 'Service Unavailable',
      }) as any;

      const customChecker = new TelegramChecker({ fetch: mock500Fetch });
      const result = await customChecker.check('broken_service');
      expect(result.status).toBe(CheckStatus.ERROR);
      expect(result.status).not.toBe(CheckStatus.AVAILABLE);
    });
  });
});
