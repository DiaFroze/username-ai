import { NamingRequest, GeneratedCandidate } from '@username/shared';

export interface IAIProvider {
  readonly providerName: string;
  generateNames(input: NamingRequest): Promise<GeneratedCandidate[]>;
}
