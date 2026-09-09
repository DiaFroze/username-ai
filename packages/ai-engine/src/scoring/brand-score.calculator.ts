import { CheckerResult, CheckStatus, Platform, ScoreBreakdown } from '@username/shared';

export interface BrandScoreCalculation {
  total: number;
  breakdown: ScoreBreakdown;
  availableEverywhere: boolean;
}

export class BrandScoreCalculator {
  /**
   * Computes the deterministic Brand Score (0-100) and structured breakdown.
   */
  static calculate(
    name: string,
    query: string,
    checks: CheckerResult[] = []
  ): BrandScoreCalculation {
    const cleanName = name.trim().toLowerCase();
    const cleanQuery = query.trim().toLowerCase();

    const length = this.calculateLengthScore(cleanName);
    const readability = this.calculateReadabilityScore(cleanName);
    const cleanliness = this.calculateCleanlinessScore(cleanName);
    const similarity = this.calculateSimilarityScore(cleanName, cleanQuery);
    const { score: availability, availableEverywhere } = this.calculateAvailabilityScore(checks);

    const total = Math.min(100, Math.max(0, length + readability + cleanliness + similarity + availability));

    return {
      total,
      breakdown: {
        length,
        readability,
        cleanliness,
        similarity,
        availability,
      },
      availableEverywhere,
    };
  }

  /**
   * Length Score (0 to 20 points).
   * 4-7 chars is the optimal sweet spot for modern tech/social brands.
   */
  static calculateLengthScore(name: string): number {
    const len = name.length;
    if (len >= 4 && len <= 7) return 20;
    if (len === 3) return 15;
    if (len >= 8 && len <= 10) return 16;
    if (len >= 11 && len <= 13) return 11;
    if (len >= 14 && len <= 17) return 6;
    if (len <= 2) return 8;
    return 3;
  }

  /**
   * Readability Score (0 to 15 points).
   * Penalizes tongue-twisters, 3+ consecutive consonants, and unbalanced phonetic flow.
   */
  static calculateReadabilityScore(name: string): number {
    let score = 15;

    // 3 or more consecutive consonants (e.g. "strch", "bcdf")
    if (/[^aeiouy_0-9]{3,}/i.test(name)) {
      score -= 5;
    }

    // 3 or more consecutive vowels (e.g. "aeio")
    if (/[aeiouy]{3,}/i.test(name)) {
      score -= 4;
    }

    // Vowel ratio check
    const vowels = (name.match(/[aeiouy]/gi) || []).length;
    const ratio = vowels / Math.max(1, name.length);

    // Ideal vowel ratio is between 0.30 and 0.55
    if (ratio < 0.20 || ratio > 0.65) {
      score -= 4;
    }

    return Math.max(0, score);
  }

  /**
   * Cleanliness Score (0 to 15 points).
   * Pure letters = maximum score. Underscores and numbers incur penalties.
   */
  static calculateCleanlinessScore(name: string): number {
    let score = 15;

    const digitsCount = (name.match(/[0-9]/g) || []).length;
    if (digitsCount === 1) {
      // 1 digit at end is acceptable (e.g. "nova2"), elsewhere penalized more
      score -= /\d$/.test(name) ? 4 : 6;
    } else if (digitsCount >= 2) {
      score -= 10;
    }

    const underscoreCount = (name.match(/_/g) || []).length;
    if (underscoreCount === 1) {
      score -= 5;
    } else if (underscoreCount >= 2) {
      score -= 10;
    }

    return Math.max(0, score);
  }

  /**
   * Similarity Score (0 to 10 points).
   * Measures semantic/lexical closeness to the user's initial query.
   */
  static calculateSimilarityScore(name: string, query: string): number {
    if (!query) return 7;
    if (name === query) return 10;
    if (name.includes(query) || query.includes(name)) return 9;

    // Levenshtein edit distance
    const dist = this.levenshtein(name, query);
    const maxLen = Math.max(name.length, query.length);
    const similarityRatio = Math.max(0, 1 - dist / maxLen);

    return Math.round(similarityRatio * 10);
  }

  /**
   * Availability Score (0 to 40 points).
   * Critical rule: UNKNOWN, ERROR, RATE_LIMITED do NOT grant availability points.
   */
  static calculateAvailabilityScore(checks: CheckerResult[]): { score: number; availableEverywhere: boolean } {
    if (!checks || checks.length === 0) {
      return { score: 0, availableEverywhere: false };
    }

    let points = 0;
    let availableCount = 0;

    for (const check of checks) {
      if (check.status === CheckStatus.AVAILABLE) {
        availableCount++;
        if (check.platform === Platform.TELEGRAM) {
          points += 12;
        } else if (check.platform === Platform.YOUTUBE) {
          points += 12;
        } else if (check.platform === Platform.DOMAIN) {
          if (check.username.endsWith('.com')) {
            points += 10;
          } else {
            points += 6;
          }
        }
      }
    }

    const availableEverywhere = checks.length > 0 && availableCount === checks.length;
    const finalScore = Math.min(40, points);

    return {
      score: finalScore,
      availableEverywhere,
    };
  }

  private static levenshtein(a: string, b: string): number {
    const matrix: number[][] = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0]![j] = j;

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i]![j] = matrix[i - 1]![j - 1]!;
        } else {
          matrix[i]![j] = Math.min(
            matrix[i - 1]![j - 1]! + 1,
            matrix[i]![j - 1]! + 1,
            matrix[i - 1]![j]! + 1
          );
        }
      }
    }

    return matrix[b.length]![a.length]!;
  }
}
