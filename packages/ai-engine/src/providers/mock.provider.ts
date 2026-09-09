import { IAIProvider } from './ai.interface.js';
import { NamingRequest, GeneratedCandidate } from '@username/shared';
import { DeterministicGenerator } from '../deterministic/deterministic.generator.js';

export class MockAIProvider implements IAIProvider {
  readonly providerName = 'mock';

  private readonly deterministic = new DeterministicGenerator();

  async generateNames(input: NamingRequest): Promise<GeneratedCandidate[]> {
    // Generate deterministic candidates and augment with AI creative flavor
    const baseCandidates = this.deterministic.generate(input.query, input.intent, input.count || 20);

    const extraAiNames: GeneratedCandidate[] = [
      {
        name: `${input.query}ex`.toLowerCase(),
        generationType: 'AI_CREATIVE',
        reason: 'Современный технологичный бренд с динамичным суффиксом',
        tags: ['creative', 'tech'],
        aiScore: 92,
      },
      {
        name: `vel${input.query}`.toLowerCase(),
        generationType: 'AI_CREATIVE',
        reason: 'Быстрое и плавное звучание',
        tags: ['brandable', 'fluid'],
        aiScore: 88,
      },
    ];

    return [...extraAiNames, ...baseCandidates].slice(0, input.count || 20);
  }
}
