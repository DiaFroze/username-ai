import { z } from 'zod';
import { NameNormalizer } from '../normalizer/name.normalizer.js';

export const RawCandidateSchema = z.object({
  name: z.string().min(2).max(32),
  reason: z.string().optional(),
  tags: z.array(z.string()).optional(),
  aiScore: z.number().min(0).max(100).optional(),
  generationType: z
    .enum(['AI_CREATIVE', 'PREFIX', 'SUFFIX', 'COMPOUND', 'SHORTEN', 'PHONETIC', 'ABBREVIATION'])
    .optional()
    .default('AI_CREATIVE'),
});

export const RawNamingResponseSchema = z.object({
  candidates: z.array(RawCandidateSchema),
});

/**
 * Validates and safely filters candidate output from LLM models.
 */
export function validateAndCleanAiResponse(rawJson: unknown): z.infer<typeof RawCandidateSchema>[] {
  let items: unknown[] = [];
  if (Array.isArray(rawJson)) {
    items = rawJson;
  } else if (rawJson && typeof rawJson === 'object' && 'candidates' in rawJson && Array.isArray((rawJson as any).candidates)) {
    items = (rawJson as any).candidates;
  } else {
    return [];
  }

  const validCandidates: z.infer<typeof RawCandidateSchema>[] = [];
  for (const item of items) {
    const parsed = RawCandidateSchema.safeParse(item);
    if (parsed.success) {
      const compacted = NameNormalizer.toCompact(parsed.data.name);
      if (NameNormalizer.isValid(compacted)) {
        validCandidates.push({
          ...parsed.data,
          name: compacted,
        });
      }
    }
  }

  return validCandidates;
}
