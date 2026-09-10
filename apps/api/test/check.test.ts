import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import { buildApp } from '../src/app.js';
import { TelegramChecker } from '@username/checker-engine';
import { CheckStatus, Platform } from '@username/shared';

describe('POST /check/telegram (Auth & Validation)', () => {
  const jwtSecret = 'test-secret-32-chars-long-auth-check-key!';
  const authToken = jwt.sign({ id: 12345, username: 'tester' }, jwtSecret);

  const mockFetch = async () => ({
    ok: true,
    status: 200,
    text: async () => '<html><body><div class="tgme_page_title">Example profile</div><div class="tgme_page_extra">100 subscribers</div><a class="tgme_action_button_new" href="#">View in Telegram</a></body></html>',
  }) as any;

  const customChecker = new TelegramChecker({ fetch: mockFetch });
  const app = buildApp({
    jwtSecret,
    customTelegramChecker: customChecker,
    logger: false,
  });

  it('rejects anonymous request without JWT with 401 Unauthorized', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/check/telegram',
      payload: { username: 'test_active_user' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('rejects empty username payload when authenticated', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/check/telegram',
      headers: { authorization: `Bearer ${authToken}` },
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });

  it('checks username and returns normalized CheckerResult when authenticated', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/check/telegram',
      headers: { authorization: `Bearer ${authToken}` },
      payload: { username: 'test_active_user' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);

    expect(body.platform).toBe(Platform.TELEGRAM);
    expect(body.username).toBe('test_active_user');
    expect(body.status).toBe(CheckStatus.TAKEN);
    expect(body).toHaveProperty('responseTimeMs');
    expect(body).toHaveProperty('checkedAt');
    expect(body).toHaveProperty('confidence');
  });
});
