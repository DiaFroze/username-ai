import { Platform } from './platform.js';
import { SupportedTld } from './coordinator.js';
import { CheckerResult } from './checker.js';

export type NamingIntent = 'PERSONAL' | 'BRAND' | 'BUSINESS' | 'PROJECT' | 'CREATIVE' | 'FANCY' | 'AUTO';
export type NamingStyle = 'MODERN' | 'CLEAN' | 'TECH' | 'PLAYFUL' | 'MINIMAL' | 'ABSTRACT';
export type NamingLanguage = 'ru' | 'uz' | 'en';
export type GenerationType =
  | 'AI_CREATIVE'
  | 'PREFIX'
  | 'SUFFIX'
  | 'COMPOUND'
  | 'SHORTEN'
  | 'PHONETIC'
  | 'ABBREVIATION';

export interface NamingRequest {
  query: string;
  intent: NamingIntent;
  language?: NamingLanguage;
  country?: string;
  style?: NamingStyle;
  category?: string;
  count?: number;
}

export interface GeneratedCandidate {
  name: string;
  reason?: string;
  tags?: string[];
  aiScore?: number;
  generationType: GenerationType;
}

export interface ScoreBreakdown {
  length: number;       // 0 - 20
  readability: number;  // 0 - 15
  cleanliness: number;  // 0 - 15
  similarity: number;   // 0 - 10
  availability: number; // 0 - 40
}

export interface ScoredCandidate {
  name: string;
  brandScore: number;
  scoreBreakdown: ScoreBreakdown;
  reason?: string;
  tags?: string[];
  generationType: GenerationType;
  checks: CheckerResult[];
  availableEverywhere: boolean;
}

export interface NamingPipelineRequest {
  query: string;
  intent?: NamingIntent;
  category?: string;
  language?: NamingLanguage;
  platforms: Platform[];
  tlds?: SupportedTld[];
  count?: number;
  oneNameEverywhere?: boolean;
}

export interface NamingPipelineResponse {
  query: string;
  totalCandidates: number;
  candidates: ScoredCandidate[];
  metrics?: {
    totalGenerated: number;
    totalChecked: number;
    aiCacheHit: boolean;
  };
}
