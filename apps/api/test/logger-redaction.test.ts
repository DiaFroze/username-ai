import { describe, it, expect, afterEach } from 'vitest';
import { Writable } from 'node:stream';
import { buildApp } from '../src/app.js';
import { FastifyInstance } from 'fastify';

describe('Real Logger Redaction End-to-End Test', () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
  });

  it('Strictly redacts sensitive authorization tokens, initData, and apiKey to [REDACTED]', async () => {
    const logs: string[] = [];

    const stream = new Writable({
      write(chunk, _encoding, callback) {
        logs.push(chunk.toString());
        callback();
      },
    });

    app = buildApp({
      loggerStream: stream,
      jwtSecret: 'test-secret-32-chars-long-redaction-test!',
    });
    await app.ready();

    const SECRET_JWT = 'SUPER_SECRET_JWT_TOKEN_ABC123XYZ';
    const SECRET_INIT_DATA = 'SUPER_SECRET_TELEGRAM_INIT_DATA_SECRET456';
    const SECRET_API_KEY = 'SUPER_SECRET_API_KEY_KEY789';

    // 1. Request with Bearer authorization header
    await app.inject({
      method: 'GET',
      url: '/health/live',
      headers: {
        authorization: `Bearer ${SECRET_JWT}`,
      },
    });

    // 2. Request with sensitive body parameters (initData, apiKey)
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/telegram',
      payload: {
        initData: SECRET_INIT_DATA,
        apiKey: SECRET_API_KEY,
      },
    });

    // 3. Direct log calls with sensitive properties
    app.log.info({
      apiKey: SECRET_API_KEY,
      token: SECRET_JWT,
      initData: SECRET_INIT_DATA,
    }, 'Direct log event containing sensitive fields');

    // Wait a brief tick for stream flush
    await new Promise((resolve) => setTimeout(resolve, 50));

    const fullLogOutput = logs.join('\n');

    // ASSERTION 1: Zero plaintext leakage
    expect(fullLogOutput).not.toContain(SECRET_JWT);
    expect(fullLogOutput).not.toContain(SECRET_INIT_DATA);
    expect(fullLogOutput).not.toContain(SECRET_API_KEY);

    // ASSERTION 2: Replaced with standard censor tag [REDACTED]
    expect(fullLogOutput).toContain('[REDACTED]');
  });
});
