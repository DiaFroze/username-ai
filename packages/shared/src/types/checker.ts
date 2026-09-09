import { Platform, CheckStatus } from './platform.js';

export interface CheckerResult {
  platform: Platform;
  username: string;
  status: CheckStatus;
  checkedAt: number;
  confidence: number;
  source: string;
  responseTimeMs: number;
  errorCode?: string;
  rawDetails?: string;
  cached?: boolean;
  cacheAgeMs?: number;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export interface IChecker {
  readonly platform: Platform;
  validateFormat(username: string): ValidationResult;
  check(username: string): Promise<CheckerResult>;
}
