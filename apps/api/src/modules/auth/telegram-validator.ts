import crypto from 'node:crypto';
import { TelegramUser } from '@username/shared';

export interface TelegramValidationResult {
  valid: boolean;
  user?: TelegramUser;
  error?: string;
}

/**
 * Validates Telegram Mini App initData server-side.
 * Follows Telegram official authentication algorithm:
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function validateTelegramInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds = 86400
): TelegramValidationResult {
  if (!initData || typeof initData !== 'string') {
    return { valid: false, error: 'initData must be a non-empty string' };
  }

  if (!botToken || typeof botToken !== 'string') {
    return { valid: false, error: 'Server bot token is not configured' };
  }

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');

  if (!hash) {
    return { valid: false, error: 'Missing hash in initData' };
  }

  params.delete('hash');

  // Sort remaining parameters alphabetically
  const items: string[] = [];
  for (const [key, value] of params.entries()) {
    items.push(`${key}=${value}`);
  }
  items.sort();

  const dataCheckString = items.join('\n');

  // Calculate secret key: HMAC_SHA256("WebAppData", botToken)
  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();

  // Calculate signature: HMAC_SHA256(secretKey, dataCheckString)
  const calculatedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  // Constant time comparison to prevent timing attacks
  const hashBuffer = Buffer.from(hash, 'hex');
  const calculatedBuffer = Buffer.from(calculatedHash, 'hex');

  if (hashBuffer.length !== calculatedBuffer.length || !crypto.timingSafeEqual(hashBuffer, calculatedBuffer)) {
    return { valid: false, error: 'Invalid HMAC signature' };
  }

  // Check auth_date for replay attack mitigation
  const authDateStr = params.get('auth_date');
  if (authDateStr) {
    const authDate = parseInt(authDateStr, 10);
    const now = Math.floor(Date.now() / 1000);
    if (isNaN(authDate) || (now - authDate) > maxAgeSeconds) {
      return { valid: false, error: 'initData has expired (replay attack protection)' };
    }
  }

  // Parse user payload
  const userJson = params.get('user');
  if (!userJson) {
    return { valid: false, error: 'Missing user payload in initData' };
  }

  try {
    const user = JSON.parse(userJson) as TelegramUser;
    return { valid: true, user };
  } catch {
    return { valid: false, error: 'Malformed user JSON in initData' };
  }
}
