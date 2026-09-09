/**
 * Utility for normalizing, cleaning, and deduplicating candidate names and queries.
 */
export class NameNormalizer {
  /**
   * Normalizes a raw string for handle/brand name usage:
   * trims, lowercases, removes emojis/diacritics, collapses multiple hyphens/underscores/spaces.
   */
  static clean(raw: string): string {
    if (!raw || typeof raw !== 'string') return '';

    return raw
      .trim()
      .toLowerCase()
      // Remove leading @ symbols
      .replace(/^@+/, '')
      // Replace spaces, hyphens with underscores or empty
      .replace(/[\s-]+/g, '_')
      // Remove all non-alphanumeric and non-underscore chars
      .replace(/[^a-z0-9_]/g, '')
      // Collapse consecutive underscores
      .replace(/_+/g, '_')
      // Trim underscores from ends
      .replace(/^_+|_+$/g, '');
  }

  /**
   * Strips all separators completely for compact handle usage (e.g. "nova_ai" -> "novaai").
   */
  static toCompact(raw: string): string {
    return this.clean(raw).replace(/_/g, '');
  }

  /**
   * Validates if a candidate name conforms to acceptable length and character rules.
   */
  static isValid(name: string): boolean {
    if (!name || typeof name !== 'string') return false;
    const clean = this.clean(name);
    if (clean.length < 3 || clean.length > 30) return false;
    // Must start with letter
    if (!/^[a-z]/.test(clean)) return false;
    // No trailing or consecutive underscores
    if (clean.endsWith('_') || clean.includes('__')) return false;
    return true;
  }

  /**
   * Deduplicates candidate names case-insensitively, preserving order.
   */
  static deduplicate<T>(items: T[], keyFn: (item: T) => string): T[] {
    const seen = new Set<string>();
    const result: T[] = [];

    for (const item of items) {
      const key = this.clean(keyFn(item));
      if (key && !seen.has(key)) {
        seen.add(key);
        result.push(item);
      }
    }

    return result;
  }
}
