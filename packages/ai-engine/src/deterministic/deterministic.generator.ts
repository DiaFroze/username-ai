import { GeneratedCandidate, NamingIntent, GenerationType } from '@username/shared';
import { NameNormalizer } from '../normalizer/name.normalizer.js';

const POPULAR_PREFIXES = ['get', 'try', 'the', 'use', 'join', 'go', 'my', 'hey', 'we'];
const POPULAR_SUFFIXES = ['hq', 'app', 'lab', 'co', 'go', 'hub', 'io', 'ai', 'uz', 'ly', 'ify', 'box', 'up', 'pro', 'zone'];
const COMPOUND_TERMS = ['studio', 'space', 'craft', 'flow', 'tech', 'base', 'core', 'stack', 'link', 'point'];
const PHONETIC_ENDINGS = ['ex', 'exa', 'xa', 'er', 'is', 'ia', 'os', 'ly', 'ix', 'ora', 'iva'];

export class DeterministicGenerator {
  generate(query: string, _intent: NamingIntent = 'BRAND', maxCount = 40): GeneratedCandidate[] {
    const clean = NameNormalizer.clean(query);
    const compact = NameNormalizer.toCompact(query);
    if (!compact || compact.length < 2) return [];

    const candidates: GeneratedCandidate[] = [];

    const addCandidate = (name: string, type: GenerationType, reason?: string, tags?: string[]) => {
      const normalized = NameNormalizer.toCompact(name);
      if (NameNormalizer.isValid(normalized) && normalized.length <= 24) {
        candidates.push({
          name: normalized,
          generationType: type,
          reason,
          tags,
          aiScore: 75,
        });
      }
    };

    // 0. Base compact version if valid
    if (compact !== clean && NameNormalizer.isValid(compact)) {
      addCandidate(compact, 'SHORTEN', 'Компактное слитное написание', ['compact', 'base']);
    }

    // 1. ABBREVIATION for multi-word queries (e.g. "coffee shop" -> "coffeeshop", "csco", "cshq")
    const words = query.trim().toLowerCase().split(/[\s_-]+/);
    if (words.length >= 2) {
      const firstLetters = words.map(w => w[0]).join('');
      if (firstLetters.length >= 2) {
        if (firstLetters.length >= 3) {
          addCandidate(firstLetters, 'ABBREVIATION', 'Аббревиатура по первым буквам', ['acronym']);
        }
        addCandidate(`${firstLetters}co`, 'ABBREVIATION', 'Аббревиатура с окончанием "co"', ['acronym']);
        addCandidate(`${firstLetters}hq`, 'ABBREVIATION', 'Аббревиатура с окончанием "hq"', ['acronym']);
      }
    }

    // 2. PREFIX Strategy
    for (const pre of POPULAR_PREFIXES) {
      addCandidate(`${pre}${compact}`, 'PREFIX', `Фирменный префикс "${pre}"`, ['prefix', 'actionable']);
    }

    // 3. SUFFIX Strategy
    for (const suf of POPULAR_SUFFIXES) {
      addCandidate(`${compact}${suf}`, 'SUFFIX', `Отраслевой суффикс "${suf}"`, ['suffix', 'brandable']);
    }

    // 4. PHONETIC Alterations (e.g. nova -> novexa, novex, novis)
    const baseStem = compact.length > 3 && /[aeiouy]$/.test(compact)
      ? compact.slice(0, -1)
      : compact;

    for (const ending of PHONETIC_ENDINGS) {
      const phoneticVariant = `${baseStem}${ending}`;
      if (phoneticVariant !== compact) {
        addCandidate(phoneticVariant, 'PHONETIC', `Фонетическое окончание "-${ending}"`, ['phonetic', 'modern']);
      }
    }

    // 5. COMPOUND Strategy
    for (const term of COMPOUND_TERMS) {
      addCandidate(`${compact}${term}`, 'COMPOUND', `Составное имя со словом "${term}"`, ['compound', 'creative']);
    }

    // 6. SHORTEN Strategy (drop interior vowels if length > 4)
    if (compact.length >= 5) {
      const firstLetter = compact[0];
      const rest = compact.slice(1);
      const disemvoweled = firstLetter + rest.replace(/[aeiouy]/g, '');
      if (disemvoweled.length >= 3 && disemvoweled !== compact) {
        addCandidate(disemvoweled, 'SHORTEN', 'Сокращенная форма без гласных', ['shorten', 'minimal']);
      }
    }

    // Deduplicate and return up to maxCount
    const deduped = NameNormalizer.deduplicate(candidates, c => c.name);
    // Interleave strategies so a short result list is not consumed by prefixes.
    const groups = new Map<GenerationType, GeneratedCandidate[]>();
    for (const c of deduped) groups.set(c.generationType, [...(groups.get(c.generationType) || []), c]);
    const diverse: GeneratedCandidate[] = [];
    const order: GenerationType[] = ['PHONETIC', 'COMPOUND', 'SHORTEN', 'ABBREVIATION', 'SUFFIX', 'PREFIX'];
    for (let i = 0; diverse.length < deduped.length; i++) {
      for (const type of order) { const c = groups.get(type)?.[i]; if (c) diverse.push(c); }
    }
    return diverse.slice(0, maxCount);
  }
}
