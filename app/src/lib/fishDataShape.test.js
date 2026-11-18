import { describe, expect, it } from 'vitest';
import { FISH_DATA_V3 } from '../data/fish_data_v3';
import {
  normalizeConversion,
  parseYieldPercent,
  withConversionStates,
} from './fishDataShape';

describe('withConversionStates', () => {
  const data = withConversionStates(FISH_DATA_V3);

  it('gives every bundled conversion a from and to state', () => {
    const conversions = Object.values(data).flatMap((sp) => Object.values(sp.conversions));
    expect(conversions.length).toBeGreaterThan(600);
    expect(conversions.every((c) => c.from && c.to)).toBe(true);
  });

  it('lets the calculator offer Round → Skinless Fillet for Pink Salmon', () => {
    const conversions = Object.values(data['Pink Salmon'].conversions);
    const fromStates = new Set(conversions.map((c) => c.from));
    expect(fromStates.has('Round')).toBe(true);
    const fillet = conversions.find((c) => c.from === 'Round' && c.to === 'Skinless Fillet');
    expect(fillet).toMatchObject({ yield: 42, range: [41, 46] });
  });

  it('keeps API-shaped conversions and coerces numeric fields', () => {
    const conv = normalizeConversion('whatever', { from: 'Round', to: 'Fillet', yield: '45.5', range: '40-50' });
    expect(conv).toMatchObject({ from: 'Round', to: 'Fillet', yield: 45.5, range: [40, 50] });
  });

  it('keeps a yield the source does not give as null, with its range', () => {
    const roe = data['Sea Urchin (Green)'].conversions['Round → Roe'];
    expect(roe).toMatchObject({ from: 'Round', to: 'Roe', yield: null, range: [5, 30] });
  });

  it('passes through the row, the note and the caution', () => {
    const fillet = data.Sablefish.conversions['D/H-Off → Skinless Fillet'];
    expect(fillet.row).toBe('p09R-10');
    expect(fillet.caution).toMatch(/prints 28%/);
    expect(data['Pink Salmon'].conversions['D/H-On (Thawed) → Skin-On Fillet'].note).toMatch(/^Freezing conditions/);
  });
});

describe('parseYieldPercent', () => {
  it('accepts yields in (0, 100]', () => {
    expect(parseYieldPercent('42')).toBe(42);
    expect(parseYieldPercent(100)).toBe(100);
  });

  it('rejects zero, negative, over-100 and blank yields', () => {
    expect(parseYieldPercent('0')).toBeNull();
    expect(parseYieldPercent('-42')).toBeNull();
    expect(parseYieldPercent('420')).toBeNull();
    expect(parseYieldPercent('')).toBeNull();
  });
});
