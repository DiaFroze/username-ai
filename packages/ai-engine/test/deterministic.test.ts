import { describe, it, expect } from 'vitest';
import { DeterministicGenerator } from '../src/deterministic/deterministic.generator.js';

describe('DeterministicGenerator', () => {
  const generator = new DeterministicGenerator();

  it('generates expected variations across multiple strategies', () => {
    const results = generator.generate('nova', 'BRAND', 50);

    const names = results.map(r => r.name);

    // Prefix strategy
    expect(names).toContain('getnova');
    expect(names).toContain('trynova');

    // Suffix strategy
    expect(names).toContain('novahq');
    expect(names).toContain('novaapp');
    expect(names).toContain('novaai');

    // Phonetic strategy
    expect(names).toContain('novexa');

    // Compound strategy
    expect(names).toContain('novastudio');

    // No junk names
    for (const name of names) {
      expect(name).not.toMatch(/\d{4,}/); // no long numbers
      expect(name).not.toContain('__');
      expect(name.length).toBeGreaterThanOrEqual(3);
      expect(name.length).toBeLessThanOrEqual(25);
    }
  });

  it('generates abbreviations for multi-word queries', () => {
    const results = generator.generate('Coffee Shop', 'BUSINESS', 30);
    const names = results.map(r => r.name);

    expect(names).toContain('csco');
    expect(names).toContain('cshq');
  });
});
