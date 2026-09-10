import { describe, it, expect, vi } from 'vitest';
import { AdvisorService } from '../src/advisor/advisor.service.js';

describe('AdvisorService', () => {
  it('calls LLM when apiKey is present and parses suggestions from bold words', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content:
                'Имя **Novabrand** звучит отлично. Также рекомендую рассмотреть варианты **Novafy** и **Novax**.',
            },
          },
        ],
      }),
    });

    const advisor = new AdvisorService({
      apiKey: 'test-key',
      baseUrl: 'https://api.miraiapi.com/v1',
      model: 'gpt-5.6-luna',
      fetch: mockFetch as any,
    });

    const res = await advisor.consult({
      messages: [{ role: 'user', content: 'Оцени имя Novabrand' }],
      language: 'ru',
    });

    expect(res.mode).toBe('AI');
    expect(res.reply).toContain('Novabrand');
    expect(res.suggestions).toEqual(['novabrand', 'novafy', 'novax']);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('falls back to heuristic advice if LLM returns 401 or network fails', async () => {
    const mockFaultyFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '{"error":{"message":"Invalid token"}}',
    });

    const advisor = new AdvisorService({
      apiKey: 'expired-key',
      fetch: mockFaultyFetch as any,
    });

    const res = await advisor.consult({
      messages: [{ role: 'user', content: 'Оцени имя "Veltix"' }],
      language: 'ru',
    });

    expect(res.mode).toBe('FALLBACK');
    expect(res.reply).toContain('Veltix');
    expect(res.suggestions).toContain('veltix');
  });

  it('provides domain advice in Uzbek and Russian on fallback', async () => {
    const advisor = new AdvisorService({ apiKey: '' });

    const resUz = await advisor.consult({
      messages: [{ role: 'user', content: 'Domen tanlash' }],
      language: 'uz',
    });
    expect(resUz.mode).toBe('FALLBACK');
    expect(resUz.reply).toContain('.uz');

    const resRu = await advisor.consult({
      messages: [{ role: 'user', content: 'Какой домен выбрать?' }],
      language: 'ru',
    });
    expect(resRu.mode).toBe('FALLBACK');
    expect(resRu.reply).toContain('.com');
  });
});
