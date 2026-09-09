import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { buildApp } from '../src/app.js';

describe('API Auth & Telegram initData validation', () => {
  const TEST_BOT_TOKEN = '123456789:ABCdefGHIjklMNOpqrsTUVwxyz';
  const app = buildApp({
    botToken: TEST_BOT_TOKEN,
    logger: false,
  });

  // Helper function to generate valid Telegram initData signature
  function generateTestInitData(userObj: object, authDate = Math.floor(Date.now() / 1000)): string {
    const params = new Map<string, string>();
    params.set('auth_date', authDate.toString());
    params.set('query_id', 'AAGu_test_id');
    params.set('user', JSON.stringify(userObj));

    const items: string[] = [];
    for (const [key, value] of params.entries()) {
      items.push(`${key}=${value}`);
    }
    items.sort();

    const dataCheckString = items.join('\n');
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(TEST_BOT_TOKEN).digest();
    const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    params.set('hash', hash);

    const urlParams = new URLSearchParams();
    for (const [key, value] of params.entries()) {
      urlParams.set(key, value);
    }
    return urlParams.toString();
  }

  it('successfully validates genuine Telegram initData', async () => {
    const validUser = {
      id: 987654321,
      first_name: 'Abdulloh',
      last_name: 'Dev',
      username: 'abdulloh_dev',
      language_code: 'uz',
    };

    const initData = generateTestInitData(validUser);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/telegram',
      payload: { initData },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('token');
    expect(body.user.id).toBe(987654321);
    expect(body.user.first_name).toBe('Abdulloh');
    expect(body.user.username).toBe('abdulloh_dev');
  });

  it('rejects tampered initData with modified user details', async () => {
    const validUser = { id: 12345, first_name: 'Hacker' };
    let initData = generateTestInitData(validUser);

    // Tamper with the user ID in the query string
    initData = initData.replace('12345', '99999');

    const response = await app.inject({
      method: 'POST',
      url: '/auth/telegram',
      payload: { initData },
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('Unauthorized');
  });

  it('rejects expired initData (replay attack defense)', async () => {
    const oldUser = { id: 11111, first_name: 'OldSession' };
    // 2 days ago
    const expiredAuthDate = Math.floor(Date.now() / 1000) - 172800;
    const initData = generateTestInitData(oldUser, expiredAuthDate);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/telegram',
      payload: { initData },
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.message).toContain('expired');
  });

  it('rejects missing or empty initData payload', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/telegram',
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });
});
