import { Platform, SupportedTld, SUPPORTED_TLDS } from '@username/shared';

export interface NormalizedTargetResult {
  target: string;
  tld?: SupportedTld;
}

export class TargetNormalizer {
  /**
   * Normalizes and validates target strings according to platform-specific rules.
   * Throws 400 bad request error on invalid format or unsupported parameters.
   */
  static normalize(
    platform: Platform,
    rawTarget: string,
    tldParam?: SupportedTld
  ): NormalizedTargetResult {
    if (!rawTarget || typeof rawTarget !== 'string' || rawTarget.trim().length === 0) {
      const err = new Error('Field "target" is required and cannot be empty');
      (err as any).statusCode = 400;
      throw err;
    }

    let input = rawTarget.trim();

    if (platform === Platform.TELEGRAM) {
      return this.normalizeTelegram(input);
    } else if (platform === Platform.YOUTUBE) {
      return this.normalizeYouTube(input);
    } else if (platform === Platform.DOMAIN) {
      return this.normalizeDomain(input, tldParam);
    }

    const err = new Error(`Unsupported platform: ${platform}`);
    (err as any).statusCode = 400;
    throw err;
  }

  private static normalizeTelegram(input: string): NormalizedTargetResult {
    // Strip protocol, domain, trailing slashes, leading @
    let clean = input
      .replace(/^https?:\/\//i, '')
      .replace(/^(www\.)?(t\.me|telegram\.me)\//i, '')
      .replace(/\/+$/, '')
      .replace(/^@+/, '')
      .trim()
      .toLowerCase();

    // Telegram username validation: 5 to 32 characters, starts with a letter, [a-z0-9_]
    if (clean.length < 5) {
      const err = new Error('Telegram username must be at least 5 characters long');
      (err as any).statusCode = 400;
      throw err;
    }

    if (clean.length > 32) {
      const err = new Error('Telegram username cannot exceed 32 characters');
      (err as any).statusCode = 400;
      throw err;
    }

    if (!/^[a-z]/.test(clean)) {
      const err = new Error('Telegram username must start with a letter (a-z)');
      (err as any).statusCode = 400;
      throw err;
    }

    if (!/^[a-z0-9_]+$/.test(clean)) {
      const err = new Error('Telegram username can only contain letters, numbers, and underscores');
      (err as any).statusCode = 400;
      throw err;
    }

    if (clean.endsWith('_')) {
      const err = new Error('Telegram username cannot end with an underscore');
      (err as any).statusCode = 400;
      throw err;
    }

    if (clean.includes('__')) {
      const err = new Error('Telegram username cannot contain consecutive underscores');
      (err as any).statusCode = 400;
      throw err;
    }

    return { target: clean };
  }

  private static normalizeYouTube(input: string): NormalizedTargetResult {
    // Strip protocol, domain, @ handle prefix, trailing slashes
    let clean = input
      .replace(/^https?:\/\//i, '')
      .replace(/^(www\.)?youtube\.com\//i, '')
      .replace(/^@+/, '')
      .replace(/\/+$/, '')
      .trim()
      .toLowerCase();

    // YouTube handle validation: 3 to 30 characters
    if (clean.length < 3) {
      const err = new Error('YouTube handle must be at least 3 characters long');
      (err as any).statusCode = 400;
      throw err;
    }

    if (clean.length > 30) {
      const err = new Error('YouTube handle cannot exceed 30 characters');
      (err as any).statusCode = 400;
      throw err;
    }

    if (!/^[a-z0-9]/.test(clean)) {
      const err = new Error('YouTube handle must start with a letter or number');
      (err as any).statusCode = 400;
      throw err;
    }

    if (!/[a-z0-9]$/.test(clean)) {
      const err = new Error('YouTube handle must end with a letter or number');
      (err as any).statusCode = 400;
      throw err;
    }

    if (!/^[a-z0-9_.-]+$/.test(clean)) {
      const err = new Error('YouTube handle can only contain letters, numbers, periods, dashes, and underscores');
      (err as any).statusCode = 400;
      throw err;
    }

    if (clean.includes('..')) {
      const err = new Error('YouTube handle cannot contain consecutive periods');
      (err as any).statusCode = 400;
      throw err;
    }

    return { target: clean };
  }

  private static normalizeDomain(input: string, tldParam?: SupportedTld): NormalizedTargetResult {
    // Check for disallowed query parameters or fragments
    if (input.includes('?') || input.includes('#')) {
      const err = new Error('Domain target must not contain query parameters or fragments');
      (err as any).statusCode = 400;
      throw err;
    }

    // Strip protocol, port, trailing dots/slashes
    let clean = input
      .replace(/^https?:\/\//i, '')
      .replace(/:\d+/, '')
      .trim()
      .toLowerCase();

    // If there is a path beyond single root slash, reject
    if (clean.includes('/')) {
      const parts = clean.split('/');
      if (parts.length > 1 && parts.slice(1).some(p => p.length > 0)) {
        const err = new Error('Domain target must not contain URL path or subfolders');
        (err as any).statusCode = 400;
        throw err;
      }
      clean = parts[0];
    }

    // Strip trailing dot (e.g. "novexa.com.")
    clean = clean.replace(/\.+$/, '');

    let stem: string;
    let tld: SupportedTld;

    if (clean.includes('.')) {
      const parts = clean.split('.');
      if (parts.length < 2) {
        const err = new Error('Invalid domain format');
        (err as any).statusCode = 400;
        throw err;
      }

      const detectedTld = parts[parts.length - 1];
      stem = parts.slice(0, -1).join('.');

      if (!SUPPORTED_TLDS.includes(detectedTld as SupportedTld)) {
        const err = new Error(
          `Unsupported TLD ".${detectedTld}". Supported TLDs: ${SUPPORTED_TLDS.map(t => '.' + t).join(', ')}`
        );
        (err as any).statusCode = 400;
        throw err;
      }
      tld = detectedTld as SupportedTld;
    } else {
      stem = clean;
      const targetTld = tldParam || 'com';
      if (!SUPPORTED_TLDS.includes(targetTld)) {
        const err = new Error(
          `Unsupported TLD ".${targetTld}". Supported TLDs: ${SUPPORTED_TLDS.map(t => '.' + t).join(', ')}`
        );
        (err as any).statusCode = 400;
        throw err;
      }
      tld = targetTld;
    }

    // Validate stem
    if (!stem || stem.length === 0) {
      const err = new Error('Domain name cannot be empty');
      (err as any).statusCode = 400;
      throw err;
    }

    if (stem.length > 63) {
      const err = new Error('Domain name exceeds maximum label length of 63 characters');
      (err as any).statusCode = 400;
      throw err;
    }

    if (!/^[a-z0-9]/.test(stem)) {
      const err = new Error('Domain name must start with an alphanumeric character');
      (err as any).statusCode = 400;
      throw err;
    }

    if (!/[a-z0-9]$/.test(stem)) {
      const err = new Error('Domain name must end with an alphanumeric character');
      (err as any).statusCode = 400;
      throw err;
    }

    if (!/^[a-z0-9-]+$/.test(stem)) {
      const err = new Error('Domain name can only contain alphanumeric characters and hyphens');
      (err as any).statusCode = 400;
      throw err;
    }

    return {
      target: `${stem}.${tld}`,
      tld,
    };
  }
}
