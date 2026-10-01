import { describe, expect, it } from 'vitest';
import {
  CUSTOM_YIELD_LIMITS,
  conversionLabel,
  hasStartingForm,
  normalizeCustomYieldInput,
  validateCustomYield,
} from './customYield.js';

const VALID = { species: 'Pink Salmon', from: 'Round', to: 'Skinless Fillet', yield: '42', source: 'Measured 2026' };

describe('normalizeCustomYieldInput', () => {
  it('trims text and parses the yield', () => {
    expect(normalizeCustomYieldInput({ species: '  Pink Salmon ', from: ' Round', to: 'Fillet ', yield: ' 42.5 ', source: ' x ' }))
      .toEqual({ species: 'Pink Salmon', from: 'Round', to: 'Fillet', yield: 42.5, source: 'x' });
  });

  it('turns missing or odd fields into blanks and null', () => {
    expect(normalizeCustomYieldInput({})).toEqual({ species: '', from: '', to: '', yield: null, source: '' });
    expect(normalizeCustomYieldInput({ species: 3, yield: 'abc', source: null })).toEqual({ species: '', from: '', to: '', yield: null, source: '' });
    expect(normalizeCustomYieldInput({ yield: Infinity }).yield).toBeNull();
  });
});

describe('validateCustomYield', () => {
  it('accepts a complete custom yield', () => {
    const result = validateCustomYield(VALID);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual({});
    expect(result.value.yield).toBe(42);
  });

  it('accepts a blank starting form (yields copied from Neon) and a blank note', () => {
    expect(validateCustomYield({ ...VALID, from: '', source: '' }).ok).toBe(true);
    expect(validateCustomYield({ ...VALID, from: undefined, source: undefined }).ok).toBe(true);
  });

  it('requires the species and the finished product', () => {
    expect(validateCustomYield({ ...VALID, species: ' ' }).errors.species).toMatch(/species/);
    expect(validateCustomYield({ ...VALID, to: '' }).errors.to).toMatch(/finished product/);
  });

  it('keeps the yield above 0 and up to 100', () => {
    expect(validateCustomYield({ ...VALID, yield: 0 }).ok).toBe(false);
    expect(validateCustomYield({ ...VALID, yield: '100.0001' }).ok).toBe(false);
    expect(validateCustomYield({ ...VALID, yield: -5 }).ok).toBe(false);
    expect(validateCustomYield({ ...VALID, yield: 'forty' }).errors.yield).toMatch(/number/);
    expect(validateCustomYield({ ...VALID, yield: 100 }).ok).toBe(true);
    expect(validateCustomYield({ ...VALID, yield: 0.5 }).ok).toBe(true);
  });

  it('applies the same length limits as the rules', () => {
    expect(validateCustomYield({ ...VALID, species: 'x'.repeat(CUSTOM_YIELD_LIMITS.species) }).ok).toBe(true);
    expect(validateCustomYield({ ...VALID, species: 'x'.repeat(CUSTOM_YIELD_LIMITS.species + 1) }).ok).toBe(false);
    expect(validateCustomYield({ ...VALID, from: 'x'.repeat(CUSTOM_YIELD_LIMITS.from + 1) }).ok).toBe(false);
    expect(validateCustomYield({ ...VALID, to: 'x'.repeat(CUSTOM_YIELD_LIMITS.to + 1) }).ok).toBe(false);
    expect(validateCustomYield({ ...VALID, source: 'x'.repeat(CUSTOM_YIELD_LIMITS.source) }).ok).toBe(true);
    expect(validateCustomYield({ ...VALID, source: 'x'.repeat(CUSTOM_YIELD_LIMITS.source + 1) }).ok).toBe(false);
  });

  it('reports every failing field at once', () => {
    const { errors } = validateCustomYield({});
    expect(Object.keys(errors).sort()).toEqual(['species', 'to', 'yield']);
  });
});

describe('labels', () => {
  it('writes the conversion as From → To', () => {
    expect(conversionLabel({ from: 'Round', to: 'Skinless Fillet' })).toBe('Round → Skinless Fillet');
    expect(conversionLabel({ from: '', to: 'Skinless Fillet' })).toBe('? → Skinless Fillet');
  });

  it('knows when the starting form is missing', () => {
    expect(hasStartingForm({ from: 'Round' })).toBe(true);
    expect(hasStartingForm({ from: '' })).toBe(false);
    expect(hasStartingForm(null)).toBe(false);
  });
});
