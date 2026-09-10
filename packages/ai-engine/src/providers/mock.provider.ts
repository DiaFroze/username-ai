import { IAIProvider } from './ai.interface.js';
import { NamingRequest, GeneratedCandidate } from '@username/shared';
import { DeterministicGenerator } from '../deterministic/deterministic.generator.js';

export class MockAIProvider implements IAIProvider {
  readonly providerName = 'mock';

  private readonly deterministic = new DeterministicGenerator();

  async generateNames(input: NamingRequest): Promise<GeneratedCandidate[]> {
    return this.deterministic.generate(input.query, input.intent, input.count || 20)
      .map(c => ({ ...c, origin: 'TEMPLATE' }));
  }
}
