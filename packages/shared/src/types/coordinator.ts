import { Platform } from './platform.js';
import { CheckerResult } from './checker.js';

export const SUPPORTED_TLDS = ['com', 'net', 'org', 'io', 'ai', 'uz'] as const;
export type SupportedTld = typeof SUPPORTED_TLDS[number];

export interface MultiCheckRequest {
  query: string;
  platforms: Platform[];
  tlds?: SupportedTld[];
}

export interface MultiCheckResponse {
  query: string;
  results: CheckerResult[];
}
