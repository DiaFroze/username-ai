import { describe, it, expect } from 'vitest';
import { NameNormalizer } from '../src/normalizer/name.normalizer.js';

describe('NameNormalizer', () => {
  it('cleans raw inputs into standardized handles', () => {
    expect(NameNormalizer.clean('@Nova-AI!')).toBe('nova_ai');
    expect(NameNormalizer.clean('   Cool   Brand   ')).toBe('cool_brand');
    expect(NameNormalizer.clean('___special___')).toBe('special');
  });

  it('converts to compact single-word representation', () => {
    expect(NameNormalizer.toCompact('Nova AI')).toBe('novaai');
    expect(NameNormalizer.toCompact('get-nova_co')).toBe('getnovaco');
  });

  it('validates name structure', () => {
    expect(NameNormalizer.isValid('nova')).toBe(true);
    expect(NameNormalizer.isValid('novexa')).toBe(true);
    expect(NameNormalizer.isValid('1nova')).toBe(false); // starts with digit
    expect(NameNormalizer.isValid('no')).toBe(false); // too short
    expect(NameNormalizer.isValid('a'.repeat(35))).toBe(false); // too long
  });

  it('deduplicates case-insensitively while preserving order', () => {
    const list = [{ id: 1, name: 'Nova' }, { id: 2, name: 'nova' }, { id: 3, name: 'Novexa' }];
    const deduped = NameNormalizer.deduplicate(list, x => x.name);
    expect(deduped).toHaveLength(2);
    expect(deduped[0]!.name).toBe('Nova');
    expect(deduped[1]!.name).toBe('Novexa');
  });
});
