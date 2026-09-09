import net from 'node:net';
import { Platform, CheckStatus, CheckerResult, ValidationResult, SupportedTld, SUPPORTED_TLDS } from '@username/shared';
import { BaseChecker } from '../base.checker.js';

export interface DomainCheckerOptions {
  timeoutMs?: number;
  fetch?: typeof fetch;
  whoisQueryFn?: (domain: string, host: string, port: number, timeoutMs: number) => Promise<string>;
}

// Authoritative RDAP endpoints for gTLDs / ccTLDs
const RDAP_REGISTRY_MAP: Record<string, string> = {
  com: 'https://rdap.verisign.com/com/v1/domain/',
  net: 'https://rdap.verisign.com/net/v1/domain/',
  org: 'https://rdap.publicinterestregistry.org/rdap/domain/',
  io: 'https://rdap.identitydigital.services/rdap/domain/',
  ai: 'https://rdap.org/domain/',
};

export class DomainChecker extends BaseChecker {
  readonly platform = Platform.DOMAIN;

  private readonly timeoutMs: number;
  private readonly customFetch?: typeof fetch;
  private readonly customWhoisQuery?: (domain: string, host: string, port: number, timeoutMs: number) => Promise<string>;

  constructor(options?: DomainCheckerOptions) {
    super();
    this.timeoutMs = options?.timeoutMs ?? 5000;
    this.customFetch = options?.fetch;
    this.customWhoisQuery = options?.whoisQueryFn;
  }

  /**
   * Validates domain label syntax.
   * Note: Internationalized Domain Names (IDN) with non-ASCII characters are excluded in Phase 1B.
   */
  validateFormat(domainOrName: string): ValidationResult {
    const clean = domainOrName.trim().toLowerCase();

    if (!clean) {
      return { valid: false, error: 'Domain name cannot be empty' };
    }

    if (clean.length > 253) {
      return { valid: false, error: 'Domain name exceeds maximum RFC length of 253 characters' };
    }

    // Check if domain includes TLD
    const parts = clean.split('.');
    let label = clean;
    let tld = 'com';

    if (parts.length >= 2) {
      label = parts[0]!;
      tld = parts[parts.length - 1]!;

      if (!SUPPORTED_TLDS.includes(tld as SupportedTld)) {
        return {
          valid: false,
          error: `Unsupported TLD ".${tld}". Supported TLDs: ${SUPPORTED_TLDS.map(t => '.' + t).join(', ')}`,
        };
      }
    }

    if (label.length < 1 || label.length > 63) {
      return { valid: false, error: 'Domain label must be between 1 and 63 characters long' };
    }

    // ASCII alphanumeric and hyphens only. No leading or trailing hyphens.
    if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) {
      return {
        valid: false,
        error: 'Domain label can only contain alphanumeric characters (a-z, 0-9) and hyphens, and cannot start or end with a hyphen',
      };
    }

    return { valid: true };
  }

  /**
   * Checks availability of a domain (e.g. "novexa.com" or "novexa", defaulting to .com).
   */
  async check(domainOrName: string): Promise<CheckerResult> {
    const clean = domainOrName.trim().toLowerCase();
    const parts = clean.split('.');

    let name = clean;
    let tld: SupportedTld = 'com';

    if (parts.length >= 2) {
      name = parts[0]!;
      tld = parts[parts.length - 1] as SupportedTld;
    }

    return this.checkTld(name, tld);
  }

  /**
   * Checks availability of a specific name + TLD combination.
   */
  async checkTld(name: string, tld: SupportedTld): Promise<CheckerResult> {
    const startTime = Date.now();
    const fullDomain = `${name}.${tld}`.toLowerCase();
    const validation = this.validateFormat(fullDomain);

    if (!validation.valid) {
      return {
        platform: this.platform,
        username: fullDomain,
        status: CheckStatus.ERROR,
        checkedAt: Date.now(),
        confidence: 1.0,
        source: 'DOMAIN_SYNTAX_VALIDATION',
        responseTimeMs: Date.now() - startTime,
        errorCode: 'INVALID_DOMAIN_SYNTAX',
        rawDetails: validation.error,
      };
    }

    // Special official registry handling for .uz ccTLD
    if (tld === 'uz') {
      return this.checkUzDomain(fullDomain, startTime);
    }

    // Standard RDAP for .com, .net, .org, .io, .ai
    return this.checkRdapDomain(fullDomain, tld, startTime);
  }

  /**
   * Checks all supported TLDs in parallel using Promise.allSettled.
   */
  async checkAllTlds(name: string, tlds: SupportedTld[] = [...SUPPORTED_TLDS]): Promise<CheckerResult[]> {
    const promises = tlds.map(tld => this.checkTld(name, tld));
    const settled = await Promise.allSettled(promises);

    return settled.map((result, idx) => {
      if (result.status === 'fulfilled') {
        return result.value;
      }
      const tld = tlds[idx]!;
      return {
        platform: this.platform,
        username: `${name}.${tld}`,
        status: CheckStatus.ERROR,
        checkedAt: Date.now(),
        confidence: 0.0,
        source: 'DOMAIN_COORDINATOR',
        responseTimeMs: 0,
        errorCode: 'CHECK_FAILED',
        rawDetails: result.reason?.message || 'Unknown error during domain check',
      };
    });
  }

  /**
   * Official ICANN RDAP protocol lookup (RFC 7480 / RFC 7484).
   */
  private async checkRdapDomain(fullDomain: string, tld: string, startTime: number): Promise<CheckerResult> {
    const fetchFn = this.customFetch || globalThis.fetch;
    const baseRdapUrl = RDAP_REGISTRY_MAP[tld] || 'https://rdap.org/domain/';
    const url = `${baseRdapUrl}${encodeURIComponent(fullDomain)}`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      const response = await fetchFn(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/rdap+json, application/json',
          'User-Agent': 'UsernameAI-DomainChecker/1.0',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const responseTimeMs = Date.now() - startTime;

      if (response.status === 429) {
        return {
          platform: this.platform,
          username: fullDomain,
          status: CheckStatus.RATE_LIMITED,
          checkedAt: Date.now(),
          confidence: 1.0,
          source: `RDAP_${tld.toUpperCase()}`,
          responseTimeMs,
          errorCode: 'HTTP_429_RATE_LIMITED',
        };
      }

      // RFC 7480: Authoritative 404 indicates domain does not exist (AVAILABLE)
      if (response.status === 404) {
        return {
          platform: this.platform,
          username: fullDomain,
          status: CheckStatus.AVAILABLE,
          checkedAt: Date.now(),
          confidence: 0.95,
          source: `RDAP_${tld.toUpperCase()}`,
          responseTimeMs,
        };
      }

      if (response.status === 200) {
        return {
          platform: this.platform,
          username: fullDomain,
          status: CheckStatus.TAKEN,
          checkedAt: Date.now(),
          confidence: 1.0,
          source: `RDAP_${tld.toUpperCase()}`,
          responseTimeMs,
        };
      }

      // Non-authoritative redirect, server error, etc.
      return {
        platform: this.platform,
        username: fullDomain,
        status: CheckStatus.UNKNOWN,
        checkedAt: Date.now(),
        confidence: 0.4,
        source: `RDAP_${tld.toUpperCase()}`,
        responseTimeMs,
        errorCode: `HTTP_${response.status}`,
        rawDetails: 'Non-authoritative or indeterminate RDAP response',
      };
    } catch (err: any) {
      const responseTimeMs = Date.now() - startTime;
      const isTimeout = err.name === 'AbortError' || err.name === 'TimeoutError';

      return {
        platform: this.platform,
        username: fullDomain,
        status: isTimeout ? CheckStatus.UNKNOWN : CheckStatus.ERROR,
        checkedAt: Date.now(),
        confidence: 0.0,
        source: `RDAP_${tld.toUpperCase()}`,
        responseTimeMs,
        errorCode: isTimeout ? 'TIMEOUT' : (err.code || err.name || 'FETCH_ERROR'),
        rawDetails: err.message,
      };
    }
  }

  /**
   * Official WHOIS protocol lookup for .uz ccTLD via whois.cctld.uz:43
   */
  private async checkUzDomain(fullDomain: string, startTime: number): Promise<CheckerResult> {
    try {
      const queryFn = this.customWhoisQuery || this.defaultWhoisSocketQuery;
      const rawText = await queryFn(fullDomain, 'whois.cctld.uz', 43, this.timeoutMs);
      const responseTimeMs = Date.now() - startTime;
      const lower = rawText.toLowerCase();

      // Signatures for available .uz domains from CCTLD.UZ
      if (lower.includes('no match found') || lower.includes('not found') || lower.includes('no entries found')) {
        return {
          platform: this.platform,
          username: fullDomain,
          status: CheckStatus.AVAILABLE,
          checkedAt: Date.now(),
          confidence: 0.95,
          source: 'WHOIS_CCTLD_UZ',
          responseTimeMs,
        };
      }

      // Signatures for active/registered .uz domains
      if (lower.includes('domain name:') || lower.includes('status: active') || lower.includes('registrar:')) {
        return {
          platform: this.platform,
          username: fullDomain,
          status: CheckStatus.TAKEN,
          checkedAt: Date.now(),
          confidence: 1.0,
          source: 'WHOIS_CCTLD_UZ',
          responseTimeMs,
        };
      }

      return {
        platform: this.platform,
        username: fullDomain,
        status: CheckStatus.UNKNOWN,
        checkedAt: Date.now(),
        confidence: 0.5,
        source: 'WHOIS_CCTLD_UZ',
        responseTimeMs,
        rawDetails: 'Unrecognized WHOIS response format',
      };
    } catch (err: any) {
      const responseTimeMs = Date.now() - startTime;
      const isTimeout = /timeout|timed out/i.test(err.message || '') || err.name === 'TimeoutError';

      return {
        platform: this.platform,
        username: fullDomain,
        status: isTimeout ? CheckStatus.UNKNOWN : CheckStatus.ERROR,
        checkedAt: Date.now(),
        confidence: 0.0,
        source: 'WHOIS_CCTLD_UZ',
        responseTimeMs,
        errorCode: isTimeout ? 'TIMEOUT' : (err.code || 'WHOIS_SOCKET_ERROR'),
        rawDetails: err.message,
      };
    }
  }

  /**
   * Default TCP socket implementation for WHOIS port 43.
   */
  private defaultWhoisSocketQuery(domain: string, host: string, port: number, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      let buffer = '';

      socket.setTimeout(timeoutMs);

      socket.connect(port, host, () => {
        socket.write(`${domain}\r\n`);
      });

      socket.on('data', (data) => {
        buffer += data.toString('utf8');
      });

      socket.on('timeout', () => {
        socket.destroy();
        reject(new Error('WHOIS socket connection timed out'));
      });

      socket.on('error', (err) => {
        socket.destroy();
        reject(err);
      });

      socket.on('close', () => {
        resolve(buffer);
      });
    });
  }
}
