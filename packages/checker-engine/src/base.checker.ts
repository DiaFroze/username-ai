import { IChecker, Platform, CheckerResult, ValidationResult } from '@username/shared';

export abstract class BaseChecker implements IChecker {
  abstract readonly platform: Platform;

  abstract validateFormat(username: string): ValidationResult;
  abstract check(username: string): Promise<CheckerResult>;

  protected normalizeUsername(username: string): string {
    return username.trim().replace(/^@+/, '').toLowerCase();
  }
}
