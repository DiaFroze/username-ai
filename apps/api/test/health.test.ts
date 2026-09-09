import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';

import jwt from 'jsonwebtoken';

describe('API Health Endpoint', () => {
  const jwtSecret = 'test-secret-32-chars-long-health-test-key!';
  const authToken = jwt.sign({ id: 11111, username: 'health_checker' }, jwtSecret);

  const app = buildApp({
    jwtSecret,
    logger: false,
  });

  it('GET /health returns sanitized status for anonymous callers (no sensitive topology leaked)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);

    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('timestamp');
    expect(body).toHaveProperty('uptimeSeconds');
    expect(body.services).toBeUndefined();
    expect(body.metrics).toBeUndefined();
  });

  it('GET /health returns structured service statuses and metrics for authenticated callers', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { authorization: `Bearer ${authToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);

    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('timestamp');
    expect(body).toHaveProperty('uptimeSeconds');
    expect(body).toHaveProperty('services');
    expect(body.services.api.status).toBe('UP');
    expect(body.services).toHaveProperty('postgres');
    expect(body.services).toHaveProperty('redis');
    expect(body).toHaveProperty('metrics');
  });

  it('GET /health returns structured service statuses for callers with X-Internal-Token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-internal-token': process.env.INTERNAL_ADMIN_TOKEN || 'staging-internal-admin-secret' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('services');
    expect(body.services.api.status).toBe('UP');
  });
});
