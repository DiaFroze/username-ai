import { IAIProvider } from './ai.interface.js';
import { NamingRequest, GeneratedCandidate } from '@username/shared';
import { validateAndCleanAiResponse } from './ai.schema.js';

export interface GeminiProviderOptions {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export class GeminiProvider implements IAIProvider {
  readonly providerName = 'gemini';

  private readonly apiKey?: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly customFetch?: typeof fetch;

  constructor(options?: GeminiProviderOptions) {
    this.apiKey = options?.apiKey || process.env.GEMINI_API_KEY;
    this.model = options?.model || process.env.AI_MODEL || 'gemini-1.5-flash';
    this.timeoutMs = options?.timeoutMs ?? 8000;
    this.customFetch = options?.fetch;
  }

  async generateNames(input: NamingRequest): Promise<GeneratedCandidate[]> {
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY is not configured');
    }

    const fetchFn = this.customFetch || globalThis.fetch;
    const lang = input.language || 'ru';
    const targetCount = input.count || 20;

    const systemInstruction =
      `You are a top-tier branding and naming expert. ` +
      `Generate clean, punchy Latin brand names and handles. ` +
      `Output MUST be a JSON object with this exact format:\n` +
      `{"candidates": [{"name": "string", "reason": "string", "tags": ["string"], "aiScore": number, "generationType": "AI_CREATIVE"}]}\n` +
      `Explain the "reason" in ${lang === 'uz' ? 'Uzbek' : lang === 'ru' ? 'Russian' : 'English'}.\n` +
      `Generate up to ${targetCount} items. Names must be 3-20 characters, Latin characters only.`;

    const userPrompt = JSON.stringify({
      keyword: input.query,
      intent: input.intent,
      category: input.category || 'General',
    });

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent?key=${this.apiKey}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents: [{ parts: [{ text: userPrompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.8,
            maxOutputTokens: 1500,
          },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`Gemini API error ${response.status}: ${errorText}`);
      }

      const json = await response.json() as any;
      const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) return [];

      const rawParsed = JSON.parse(text);
      return validateAndCleanAiResponse(rawParsed);
    } catch (err: any) {
      clearTimeout(timeoutId);
      throw err;
    }
  }
}
