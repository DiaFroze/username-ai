import {
  NamingPipelineRequest,
  NamingPipelineResponse,
  ScoredCandidate,
  GeneratedCandidate,
} from '@username/shared';
import { CheckerCoordinator } from '@username/checker-engine';
import { IAIProvider } from '../providers/ai.interface.js';
import { DeterministicGenerator } from '../deterministic/deterministic.generator.js';
import { NameNormalizer } from '../normalizer/name.normalizer.js';
import { BrandScoreCalculator } from '../scoring/brand-score.calculator.js';
import { AiNamingCache } from '../cache/ai.cache.js';

export interface NamingServiceOptions {
  aiProvider: IAIProvider;
  coordinator: CheckerCoordinator;
  aiCache?: AiNamingCache;
  maxAiCandidates?: number;
  maxCandidatesToVerify?: number;
}

export interface NamingMetrics {
  aiRequests: number;
  aiFailures: number;
  aiCacheHits: number;
  aiLatencyTotalMs: number;
  generatedCandidatesTotal: number;
  checkedCandidatesTotal: number;
}

export class NamingService {
  private readonly aiProvider: IAIProvider;
  private readonly coordinator: CheckerCoordinator;
  private readonly deterministic = new DeterministicGenerator();
  private readonly aiCache?: AiNamingCache;
  private readonly maxAiCandidates: number;
  private readonly maxCandidatesToVerify: number;

  readonly metrics: NamingMetrics = {
    aiRequests: 0,
    aiFailures: 0,
    aiCacheHits: 0,
    aiLatencyTotalMs: 0,
    generatedCandidatesTotal: 0,
    checkedCandidatesTotal: 0,
  };

  constructor(options: NamingServiceOptions) {
    this.aiProvider = options.aiProvider;
    this.coordinator = options.coordinator;
    this.aiCache = options.aiCache;
    this.maxAiCandidates = options.maxAiCandidates ?? 20;
    this.maxCandidatesToVerify = options.maxCandidatesToVerify ?? 15;
  }

  async generateAndCheck(request: NamingPipelineRequest): Promise<NamingPipelineResponse> {
    const rawQuery = request.query.trim();
    const intent = request.intent || 'BRAND';
    const cleanQuery = NameNormalizer.clean(rawQuery);
    const compactQuery = NameNormalizer.toCompact(rawQuery);

    // 1. Generate Deterministic Variations
    const deterministicCandidates = this.deterministic.generate(
      compactQuery || cleanQuery,
      intent,
      30
    );

    // 2. Generate AI Variations (with Cache and graceful fallback)
    let aiCandidates: GeneratedCandidate[] = [];
    let aiCacheHit = false;

    if (this.aiCache) {
      const cached = await this.aiCache.get({
        query: cleanQuery,
        intent,
        language: request.language,
        category: request.category,
      });
      if (cached) {
        aiCandidates = cached;
        aiCacheHit = true;
        this.metrics.aiCacheHits++;
      }
    }

    if (!aiCacheHit) {
      this.metrics.aiRequests++;
      const aiStart = Date.now();
      try {
        aiCandidates = await this.aiProvider.generateNames({
          query: cleanQuery,
          intent,
          language: request.language || 'ru',
          category: request.category,
          count: this.maxAiCandidates,
        });

        const latency = Date.now() - aiStart;
        this.metrics.aiLatencyTotalMs += latency;

        // Populate AI Cache
        if (this.aiCache && aiCandidates.length > 0) {
          await this.aiCache.set(
            { query: cleanQuery, intent, language: request.language, category: request.category },
            aiCandidates
          );
        }
      } catch (err: any) {
        this.metrics.aiFailures++;
        console.warn(`[NamingService] AI generation failed (${err.message}). Proceeding with deterministic variations.`);
      }
    }

    // 3. Combine and Deduplicate candidates
    const allCandidates: GeneratedCandidate[] = [...aiCandidates, ...deterministicCandidates];
    const dedupedCandidates = NameNormalizer.deduplicate(allCandidates, c => c.name);
    this.metrics.generatedCandidatesTotal += dedupedCandidates.length;

    // 4. Preliminary Quality Scoring (without external availability)
    const preliminaryScored = dedupedCandidates.map(c => {
      const prelim = BrandScoreCalculator.calculate(c.name, cleanQuery, []);
      return {
        candidate: c,
        preliminaryScore: prelim.total,
      };
    });

    // Sort by preliminary score descending
    preliminaryScored.sort((a, b) => b.preliminaryScore - a.preliminaryScore);

    // 5. Select Top Candidates for external verification (Cost Control)
    const limit = request.count || this.maxCandidatesToVerify;
    const topToVerify = preliminaryScored.slice(0, limit);
    this.metrics.checkedCandidatesTotal += topToVerify.length;

    // 6. Execute Parallel Checks via CheckerCoordinator
    const verificationTasks = topToVerify.map(async ({ candidate }) => {
      const checkRes = await this.coordinator.check({
        query: candidate.name,
        platforms: request.platforms,
        tlds: request.tlds,
      });

      // 7. Calculate Final Brand Score with real availability
      const brandCalc = BrandScoreCalculator.calculate(candidate.name, cleanQuery, checkRes.results);

      const scored: ScoredCandidate = {
        name: candidate.name,
        brandScore: brandCalc.total,
        scoreBreakdown: brandCalc.breakdown,
        reason: candidate.reason,
        tags: candidate.tags,
        generationType: candidate.generationType,
        checks: checkRes.results,
        availableEverywhere: brandCalc.availableEverywhere,
      };

      return scored;
    });

    const finalCandidates = await Promise.all(verificationTasks);

    // 8. "One Name Everywhere" Ranking
    // Sort priority:
    // Available Everywhere (100% available) > Available on most platforms > Highest Brand Score
    finalCandidates.sort((a, b) => {
      // Priority 1: Available Everywhere
      if (a.availableEverywhere && !b.availableEverywhere) return -1;
      if (!a.availableEverywhere && b.availableEverywhere) return 1;

      // Priority 2: Availability score (from breakdown)
      if (a.scoreBreakdown.availability !== b.scoreBreakdown.availability) {
        return b.scoreBreakdown.availability - a.scoreBreakdown.availability;
      }

      // Priority 3: Total Brand Score
      return b.brandScore - a.brandScore;
    });

    return {
      query: rawQuery,
      totalCandidates: finalCandidates.length,
      candidates: finalCandidates,
      metrics: {
        totalGenerated: dedupedCandidates.length,
        totalChecked: finalCandidates.length,
        aiCacheHit,
      },
    };
  }
}
