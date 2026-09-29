import { describe, expect, it } from 'vitest';
import { FISH_DATA_V3 } from '../data/fish_data_v3';
import {
  hasUsableConversions,
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
    expect(hasUsableConversions(data)).toBe(true);
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

  it('treats data without usable conversions as unusable', () => {
    expect(hasUsableConversions({})).toBe(false);
    expect(hasUsableConversions({ Cod: { conversions: { Fillet: { yield: 40 } } } })).toBe(false);
  });
});

describe('hasUsableConversions', () => {
  it('rejects API data whose only yields are outside 0-100%', () => {
    const conv = (y) => ({ Cod: { conversions: { 'Round → Fillet': { from: 'Round', to: 'Fillet', yield: y } } } });
    expect(hasUsableConversions(conv(150))).toBe(false);
    expect(hasUsableConversions(conv(0))).toBe(false);
    expect(hasUsableConversions(conv(42))).toBe(true);
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
