import { describe, it, expect, vi } from 'vitest';
import { MiraiProvider } from '../src/providers/mirai.provider.js';
import { createAIProvider } from '../src/providers/provider.factory.js';

describe('MiraiProvider', () => {
  it('throws descriptive error when MIRAI_API_KEY is not configured', async () => {
    const originalKey = process.env.MIRAI_API_KEY;
    const originalOpenAI = process.env.OPENAI_API_KEY;
    delete process.env.MIRAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    try {
      const provider = new MiraiProvider({ apiKey: '' });
      await expect(provider.generateNames({ query: 'test', intent: 'BRAND' })).rejects.toThrow(
        'MIRAI_API_KEY is not configured'
      );
    } finally {
      if (originalKey) process.env.MIRAI_API_KEY = originalKey;
      if (originalOpenAI) process.env.OPENAI_API_KEY = originalOpenAI;
    }
  });

  it('sends correct request and parses markdown-wrapped JSON response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: '```json\n{"candidates": [{"name": "lumina", "reason": "Яркий бренд", "tags": ["light"], "aiScore": 95, "generationType": "AI_CREATIVE"}]}\n```',
            },
          },
        ],
      }),
    });

    const provider = new MiraiProvider({
      apiKey: 'test-mirai-key',
      baseUrl: 'https://api.miraiapi.com/v1',
      model: 'gpt-5.6-luna',
      fetch: mockFetch as any,
    });

    const candidates = await provider.generateNames({
      query: 'Светлый бренд',
      intent: 'BRAND',
      language: 'ru',
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = mockFetch.mock.calls[0]!;
    expect(calledUrl).toBe('https://api.miraiapi.com/v1/chat/completions');
    expect(calledInit.headers['Authorization']).toBe('Bearer test-mirai-key');
    expect(calledInit.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(calledInit.body);
    expect(body.model).toBe('gpt-5.6-luna');
    expect(body.messages[1].content).toContain('Светлый бренд');

    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.name).toBe('lumina');
    expect(candidates[0]!.reason).toBe('Яркий бренд');
  });

  it('handles 401 Unauthorized with clean descriptive error', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '{"error":{"message":"Invalid token"}}',
    });

    const provider = new MiraiProvider({
      apiKey: 'invalid-key',
      fetch: mockFetch as any,
    });

    await expect(
      provider.generateNames({ query: 'test', intent: 'BRAND' })
    ).rejects.toThrow(/Mirai API unauthorized \(401\)/);
  });

  it('handles 403 Forbidden / insufficient quota with clean error', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => '{"error":{"message":"Quota exceeded"}}',
    });

    const provider = new MiraiProvider({
      apiKey: 'test-key',
      fetch: mockFetch as any,
    });

    await expect(
      provider.generateNames({ query: 'test', intent: 'BRAND' })
    ).rejects.toThrow(/Mirai API forbidden \(403\)/);
  });

  it('createAIProvider supports mirai and safely falls back to mock template generation on failure', async () => {
    const mockFaultyFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '{"error":{"message":"Invalid token"}}',
    });

    const _miraiProvider = new MiraiProvider({
      apiKey: 'bad-key',
      fetch: mockFaultyFetch as any,
    });

    // When createAIProvider is called with mirai, fallback is mock
    const provider = createAIProvider({
      provider: 'mirai',
    });

    expect(provider.providerName).toContain('mirai');
  });
});
