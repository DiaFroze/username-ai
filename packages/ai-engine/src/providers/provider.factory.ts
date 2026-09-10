import { IAIProvider } from './ai.interface.js';
import { OpenAIProvider } from './openai.provider.js';
import { GeminiProvider } from './gemini.provider.js';
import { MockAIProvider } from './mock.provider.js';
import { MiraiProvider } from './mirai.provider.js';
import { NamingRequest, GeneratedCandidate } from '@username/shared';

export class ResilientAIProvider implements IAIProvider {
  readonly providerName: string;

  constructor(
    private readonly primary: IAIProvider,
    private readonly fallback?: IAIProvider
  ) {
    this.providerName = fallback
      ? `${primary.providerName}->${fallback.providerName}`
      : primary.providerName;
  }

  async generateNames(input: NamingRequest): Promise<GeneratedCandidate[]> {
    try {
      return (await this.primary.generateNames(input)).map(c => ({ ...c, origin: this.primary.providerName === 'mock' ? 'TEMPLATE' : 'AI' }));
    } catch (err: any) {
      if (this.fallback) {
        console.warn(
          `[AIProvider] Primary provider "${this.primary.providerName}" failed (${err.message}). Activating fallback "${this.fallback.providerName}"...`
        );
        return (await this.fallback.generateNames(input)).map(c => ({ ...c, origin: this.fallback!.providerName === 'mock' ? 'TEMPLATE' : 'AI' }));
      }
      throw err;
    }
  }
}

export function createAIProvider(options?: {
  provider?: string;
  model?: string;
  fallbackProvider?: string;
  fallbackModel?: string;
}): IAIProvider {
  const primaryType = (options?.provider || process.env.AI_PROVIDER || 'mock').toLowerCase();
  const fallbackType = (
    options?.fallbackProvider ||
    process.env.AI_FALLBACK_PROVIDER ||
    (primaryType !== 'mock' ? 'mock' : '')
  ).toLowerCase();

  const instantiate = (type: string, modelOverride?: string): IAIProvider => {
    switch (type) {
      case 'mirai':
        return new MiraiProvider({ model: modelOverride });
      case 'openai':
        return new OpenAIProvider({ model: modelOverride });
      case 'gemini':
        return new GeminiProvider({ model: modelOverride });
      case 'mock':
      default:
        return new MockAIProvider();
    }
  };

  const primary = instantiate(primaryType, options?.model);
  const fallback = fallbackType && fallbackType !== primaryType
    ? instantiate(fallbackType, options?.fallbackModel)
    : undefined;

  return new ResilientAIProvider(primary, fallback);
}
