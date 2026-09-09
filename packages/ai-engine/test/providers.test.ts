import { describe, it, expect, vi } from 'vitest';
import { MockAIProvider } from '../src/providers/mock.provider.js';
import { OpenAIProvider } from '../src/providers/openai.provider.js';
import { ResilientAIProvider, createAIProvider } from '../src/providers/provider.factory.js';
import { validateAndCleanAiResponse } from '../src/providers/ai.schema.js';

describe('AI Providers and Resilient Fallback', () => {
  it('MockAIProvider returns structured candidates', async () => {
    const provider = new MockAIProvider();
    const candidates = await provider.generateNames({
      query: 'nova',
      intent: 'BRAND',
      count: 10,
    });

    expect(candidates).toBeInstanceOf(Array);
    expect(candidates.length).toBeGreaterThanOrEqual(5);
    expect(candidates[0]!).toHaveProperty('name');
    expect(candidates[0]!).toHaveProperty('generationType');
  });

  it('ResilientAIProvider delegates to fallback provider when primary fails', async () => {
    const faultyPrimary = {
      providerName: 'faulty',
      generateNames: vi.fn().mockRejectedValue(new Error('Rate limit 429')),
    };

    const reliableFallback = new MockAIProvider();
    const resilient = new ResilientAIProvider(faultyPrimary as any, reliableFallback);

    const candidates = await resilient.generateNames({
      query: 'test',
      intent: 'PERSONAL',
    });

    expect(faultyPrimary.generateNames).toHaveBeenCalled();
    expect(candidates.length).toBeGreaterThan(0);
  });

  it('validateAndCleanAiResponse handles malformed or invalid LLM structures safely', () => {
    // Completely invalid schema
    expect(validateAndCleanAiResponse({ wrongField: 123 })).toEqual([]);

    // Contains valid and invalid entries
    const mixed = {
      candidates: [
        { name: 'validbrand', reason: 'Great name', tags: ['tech'] },
        { name: '123_invalid_start' },
        { name: 'ab' }, // too short
        { name: 'a'.repeat(35) }, // too long
      ],
    };

    const cleaned = validateAndCleanAiResponse(mixed);
    expect(cleaned).toHaveLength(1);
    expect(cleaned[0]!.name).toBe('validbrand');
  });

  it('OpenAIProvider handles network timeout gracefully', async () => {
    const mockFetch = async () => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    };

    const provider = new OpenAIProvider({
      apiKey: 'test-key',
      fetch: mockFetch as any,
    });

    await expect(
      provider.generateNames({ query: 'timeout', intent: 'BRAND' })
    ).rejects.toThrow();
  });

  it('createAIProvider instantiates provider from env configuration', () => {
    const p = createAIProvider({ provider: 'mock' });
    expect(p.providerName).toBe('mock');
  });
});
