import { describe, it, expect, afterEach } from 'vitest';
import { buildApp } from '../src/app.js';
import { FastifyInstance } from 'fastify';

describe('AI Advisor Chat Endpoint (/api/v1/naming/advisor)', () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
  });

  it('rejects empty messages with 400', async () => {
    app = buildApp({ logger: false });
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/naming/advisor',
      payload: { messages: [] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain('messages');
  });

  it('provides expert branding consultation with suggestions on POST', async () => {
    app = buildApp({ logger: false });
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/naming/advisor',
      payload: {
        messages: [{ role: 'user', content: 'Оцени имя "Novabrand" для стартапа' }],
        language: 'ru',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.reply).toBeDefined();
    expect(body.reply).toContain('Novabrand');
    expect(body.suggestions).toContain('novabrand');
    expect(body.mode).toBeDefined();
  });
});
