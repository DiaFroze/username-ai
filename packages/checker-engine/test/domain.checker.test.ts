import { describe, it, expect } from 'vitest';
import { DomainChecker } from '../src/domain/domain.checker.js';
import { Platform, CheckStatus } from '@username/shared';

describe('DomainChecker', () => {
  const checker = new DomainChecker();

  describe('validateFormat', () => {
    it('accepts valid domains and labels', () => {
      expect(checker.validateFormat('novexa.com').valid).toBe(true);
      expect(checker.validateFormat('my-brand.uz').valid).toBe(true);
      expect(checker.validateFormat('tech.ai').valid).toBe(true);
      expect(checker.validateFormat('startup.io').valid).toBe(true);
      expect(checker.validateFormat('foundation.org').valid).toBe(true);
      expect(checker.validateFormat('network.net').valid).toBe(true);
    });

    it('rejects domains with invalid characters or punctuation', () => {
      expect(checker.validateFormat('-novexa.com').valid).toBe(false);
      expect(checker.validateFormat('novexa-.com').valid).toBe(false);
      expect(checker.validateFormat('nov_exa.com').valid).toBe(false);
      expect(checker.validateFormat('nov exa.com').valid).toBe(false);
    });

    it('rejects unsupported TLDs', () => {
      const res = checker.validateFormat('novexa.xyz');
      expect(res.valid).toBe(false);
      expect(res.error).toContain('Unsupported TLD');
    });

    it('rejects empty or overly long domain labels', () => {
      expect(checker.validateFormat('').valid).toBe(false);
      expect(checker.validateFormat(`${'a'.repeat(64)}.com`).valid).toBe(false);
    });
  });

  describe('RDAP checking (.com, .net, .org, .io, .ai)', () => {
    it('returns TAKEN when RDAP returns 200 OK', async () => {
      const mockFetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ objectClassName: 'domain', ldhName: 'NOVEXA.COM' }),
      }) as any;

      const customChecker = new DomainChecker({ fetch: mockFetch });
      const result = await customChecker.check('novexa.com');

      expect(result.platform).toBe(Platform.DOMAIN);
      expect(result.username).toBe('novexa.com');
      expect(result.status).toBe(CheckStatus.TAKEN);
      expect(result.confidence).toBe(1.0);
    });

    it('returns AVAILABLE when RDAP authoritative server returns 404', async () => {
      const mockFetch = async () => ({
        ok: false,
        status: 404,
        json: async () => ({ errorCode: 404, title: 'Not Found' }),
      }) as any;

      const customChecker = new DomainChecker({ fetch: mockFetch });
      const result = await customChecker.check('vacant-domain-xyz-2026.com');

      expect(result.status).toBe(CheckStatus.AVAILABLE);
      expect(result.confidence).toBe(0.95);
      expect(result.source).toBe('RDAP_COM');
    });

    it('returns RATE_LIMITED when RDAP returns 429', async () => {
      const mockFetch = async () => ({
        ok: false,
        status: 429,
        text: async () => 'Rate limit exceeded',
      }) as any;

      const customChecker = new DomainChecker({ fetch: mockFetch });
      const result = await customChecker.check('rate-limited.com');

      expect(result.status).toBe(CheckStatus.RATE_LIMITED);
      expect(result.errorCode).toBe('HTTP_429_RATE_LIMITED');
    });

    it('returns UNKNOWN on timeout and never returns AVAILABLE', async () => {
      const mockFetch = async () => {
        const err = new Error('Timeout');
        err.name = 'TimeoutError';
        throw err;
      };

      const customChecker = new DomainChecker({ fetch: mockFetch as any });
      const result = await customChecker.check('timeout-domain.io');

      expect(result.status).toBe(CheckStatus.UNKNOWN);
      expect(result.errorCode).toBe('TIMEOUT');
    });
  });

  describe('.uz WHOIS lookup', () => {
    it('returns TAKEN when WHOIS contains active domain records', async () => {
      const mockWhois = async () => `
        Domain Name: NOVEXA.UZ
        Registrar: CCTLD
        Status: ACTIVE
        Creation Date: 2024-01-01
      `;

      const customChecker = new DomainChecker({ whoisQueryFn: mockWhois });
      const result = await customChecker.check('novexa.uz');

      expect(result.platform).toBe(Platform.DOMAIN);
      expect(result.username).toBe('novexa.uz');
      expect(result.status).toBe(CheckStatus.TAKEN);
      expect(result.source).toBe('WHOIS_CCTLD_UZ');
    });

    it('returns AVAILABLE when WHOIS response indicates domain is not found', async () => {
      const mockWhois = async () => 'No match found for domain "VACANT-DOMAIN.UZ"';

      const customChecker = new DomainChecker({ whoisQueryFn: mockWhois });
      const result = await customChecker.check('vacant-domain.uz');

      expect(result.status).toBe(CheckStatus.AVAILABLE);
      expect(result.confidence).toBe(0.95);
      expect(result.source).toBe('WHOIS_CCTLD_UZ');
    });

    it('returns UNKNOWN when WHOIS socket fails or times out', async () => {
      const mockWhois = async () => {
        throw new Error('WHOIS socket connection timed out');
      };

      const customChecker = new DomainChecker({ whoisQueryFn: mockWhois });
      const result = await customChecker.check('socket-error.uz');

      expect(result.status).toBe(CheckStatus.UNKNOWN);
      expect(result.errorCode).toBe('TIMEOUT');
    });
  });

  describe('checkAllTlds multi-TLD parallel checks', () => {
    it('checks multiple TLDs in parallel and isolates results', async () => {
      const mockFetch = async (url: string) => {
        if (url.includes('.com')) {
          return { ok: true, status: 200 } as any; // Taken
        }
        if (url.includes('.ai')) {
          return { ok: false, status: 404 } as any; // Available
        }
        return { ok: false, status: 500 } as any;
      };

      const mockWhois = async () => 'No match found';

      const customChecker = new DomainChecker({ fetch: mockFetch, whoisQueryFn: mockWhois });
      const results = await customChecker.checkAllTlds('novexa', ['com', 'ai', 'uz']);

      expect(results).toHaveLength(3);
      const comResult = results.find(r => r.username === 'novexa.com');
      const aiResult = results.find(r => r.username === 'novexa.ai');
      const uzResult = results.find(r => r.username === 'novexa.uz');

      expect(comResult?.status).toBe(CheckStatus.TAKEN);
      expect(aiResult?.status).toBe(CheckStatus.AVAILABLE);
      expect(uzResult?.status).toBe(CheckStatus.AVAILABLE);
    });
  });
});
