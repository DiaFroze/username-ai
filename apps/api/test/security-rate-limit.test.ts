import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../src/app.js';
import jwt from 'jsonwebtoken';
import { FastifyInstance } from 'fastify';

describe('Rate Limit Security & Identity Verification', () => {
  const jwtSecret = 'test-secret-must-be-32-chars-long-security!!';
  let app: FastifyInstance;

  beforeEach(async () => {
    // We configure rateLimitMax: 3 for deterministic rate-limit testing
    app = buildApp({
      jwtSecret,
      logger: false,
      rateLimitMax: 3,
      rateLimitTimeWindow: '1 minute',
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('a) Rejects X-Telegram-User-Id spoofing: unauthenticated requests share IP bucket and trigger 429', async () => {
    // Attacker tries to bypass rate limiting by changing X-Telegram-User-Id on every request
    const r1 = await app.inject({
      method: 'GET',
      url: '/health/live',
      headers: { 'x-telegram-user-id': 'attacker-spoof-1111' },
    });
    expect(r1.statusCode).toBe(200);

    const r2 = await app.inject({
      method: 'GET',
      url: '/health/live',
      headers: { 'x-telegram-user-id': 'attacker-spoof-2222' },
    });
    expect(r2.statusCode).toBe(200);

    const r3 = await app.inject({
      method: 'GET',
      url: '/health/live',
      headers: { 'x-telegram-user-id': 'attacker-spoof-3333' },
    });
    expect(r3.statusCode).toBe(200);

    // 4th request from same IP must be blocked even with new spoofed header
    const r4 = await app.inject({
      method: 'GET',
      url: '/health/live',
      headers: { 'x-telegram-user-id': 'attacker-spoof-4444' },
    });
    expect(r4.statusCode).toBe(429);
    const body = JSON.parse(r4.payload);
    expect(body.error).toBe('TooManyRequests');
  });

  it('b) Authenticated requests with valid JWT isolate rate limiting to user ID', async () => {
    const tokenUserA = jwt.sign(
      { id: 10001, username: 'alice', first_name: 'Alice' },
      jwtSecret
    );
    const tokenUserB = jwt.sign(
      { id: 20002, username: 'bob', first_name: 'Bob' },
      jwtSecret
    );

    // User A consumes 3 requests (hits limit)
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({
        method: 'GET',
        url: '/health/live',
        headers: { authorization: `Bearer ${tokenUserA}` },
      });
      expect(res.statusCode).toBe(200);
    }

    // User A's 4th request is rate limited
    const resA4 = await app.inject({
      method: 'GET',
      url: '/health/live',
      headers: { authorization: `Bearer ${tokenUserA}` },
    });
    expect(resA4.statusCode).toBe(429);

    // User B with distinct verified JWT is NOT blocked despite same IP
    const resB1 = await app.inject({
      method: 'GET',
      url: '/health/live',
      headers: { authorization: `Bearer ${tokenUserB}` },
    });
    expect(resB1.statusCode).toBe(200);
  });

  it('c) Unauthenticated requests to /auth/telegram rate limited by client IP', async () => {
    // Send 3 bad auth requests from same IP
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/telegram',
        payload: { initData: '' },
      });
      expect(res.statusCode).toBe(400); // Bad Request
    }

    // 4th request from same IP triggers rate limit
    const res4 = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/telegram',
      payload: { initData: '' },
    });
    expect(res4.statusCode).toBe(429);
  });

  it('d) Forged/invalid JWT safely falls back to IP rate limit', async () => {
    const forgedToken = 'fake.header.sig';

    for (let i = 0; i < 3; i++) {
      const res = await app.inject({
        method: 'GET',
        url: '/health/live',
        headers: { authorization: `Bearer ${forgedToken}` },
      });
      expect(res.statusCode).toBe(200);
    }

    // 4th request under forged token exhausts IP bucket
    const res4 = await app.inject({
      method: 'GET',
      url: '/health/live',
      headers: { authorization: `Bearer ${forgedToken}` },
    });
    expect(res4.statusCode).toBe(429);
  });
});
