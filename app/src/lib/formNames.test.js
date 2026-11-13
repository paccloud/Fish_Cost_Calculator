import { describe, it, expect } from 'vitest';
import { plainFormName } from './formNames.js';
import { FISH_DATA_V3 } from '../data/fish_data_v3.js';
import { withConversionStates } from './fishDataShape.js';

// Every distinct starting form and product in the reference data, read the way the calculator reads it
function formsInData() {
  const from = new Set();
  const to = new Set();
  for (const species of Object.values(withConversionStates(FISH_DATA_V3))) {
    for (const conv of Object.values(species.conversions)) {
      from.add(conv.from);
      to.add(conv.to);
    }
  }
  return { from: [...from], to: [...to], all: [...new Set([...from, ...to])] };
}

const DATA_FORMS = formsInData();

describe('plainFormName — the names in the style guide', () => {
  it.each([
    ['Round', { name: 'Whole fish', code: 'Round' }],
    ['D/H-On', { name: 'Gutted, head on', code: 'D/H-On' }],
    ['D/H-Off', { name: 'Gutted, head off', code: 'D/H-Off' }],
    ['Skinless Fillet', { name: 'Skinless fillet', code: null }],
  ])('%s', (code, expected) => {
    expect(plainFormName(code)).toEqual(expected);
  });
});

describe('plainFormName — starting forms', () => {
  it.each([
    ['D/H-On (Thawed)', { name: 'Gutted, head on, thawed', code: 'D/H-On (Thawed)' }],
    ['D/H-Off (Thawed)', { name: 'Gutted, head off, thawed', code: 'D/H-Off (Thawed)' }],
    ['D/H-Off (Eastern)', { name: 'Gutted, head off, Eastern cut', code: 'D/H-Off (Eastern)' }],
    ['Whole', { name: 'Whole', code: null }],
    ['Raw Whole', { name: 'Raw whole', code: null }],
    ['Cooked Whole', { name: 'Cooked whole', code: null }],
    ['Raw Sections', { name: 'Raw sections', code: null }],
    ['Cooked Sections', { name: 'Cooked sections', code: null }],
    ['Raw Headless', { name: 'Raw headless', code: null }],
    ['Raw Meats', { name: 'Raw meats', code: null }],
    ['Skin-On Fillet', { name: 'Skin-on fillet', code: null }],
    ['Skin-On Fillets', { name: 'Skin-on fillets', code: null }],
    ['Skinless Fillets', { name: 'Skinless fillets', code: null }],
    ['Trim', { name: 'Trim', code: null }],
  ])('%s', (code, expected) => {
    expect(plainFormName(code)).toEqual(expected);
  });

  it('covers every starting form in the data', () => {
    expect(DATA_FORMS.from.length).toBeGreaterThan(0);
    for (const form of ['Round', 'D/H-On', 'D/H-Off', 'Whole', 'Raw Whole', 'D/H-On (Thawed)', 'D/H-Off (Thawed)']) {
      expect(DATA_FORMS.from).toContain(form);
    }
  });
});

describe('plainFormName — products', () => {
  it.each([
    ['Skin-On Fillet (Hand)', { name: 'Skin-on fillet, hand cut', code: null }],
    ['Skin-On Fillet (Machine)', { name: 'Skin-on fillet, machine cut', code: null }],
    ['SIB Fillet (V-Cut)', { name: 'Skinless, boneless fillet, V-cut', code: 'SIB Fillet (V-Cut)' }],
    ['SIB Fillet (Pinboning)', { name: 'Skinless, boneless fillet, pin-boned', code: 'SIB Fillet (Pinboning)' }],
    ['SIB Fillets', { name: 'Skinless, boneless fillets', code: 'SIB Fillets' }],
    ['SIB Trim', { name: 'Skinless, boneless trim', code: 'SIB Trim' }],
    ['Skinless Fillet (Fletch)', { name: 'Skinless fillet (fletch)', code: null }],
    ['Smoked D/H-Off', { name: 'Smoked, gutted, head off', code: 'Smoked D/H-Off' }],
    ['Salted D/H-Off', { name: 'Salted, gutted, head off', code: 'Salted D/H-Off' }],
    ['Salted Round', { name: 'Salted whole fish', code: 'Salted Round' }],
    ['Steaks', { name: 'Steaks', code: null }],
    ['Smoked Sides', { name: 'Smoked sides', code: null }],
    ['Dry-Salt Sides', { name: 'Dry-salt sides', code: null }],
    ['Mild Cure Sides', { name: 'Mild cure sides', code: null }],
    ['Cooked Peeled', { name: 'Cooked, peeled', code: null }],
    ['Mantle w/Fins', { name: 'Mantle with fins', code: 'Mantle w/Fins' }],
    ['Mantle w/o Fins', { name: 'Mantle without fins', code: 'Mantle w/o Fins' }],
    ['Gutted/Skin-On', { name: 'Gutted, skin on', code: null }],
    ['Gutted/Skinned', { name: 'Gutted, skinned', code: null }],
    ['Kurimi', { name: 'Kurimi', code: null }],
  ])('%s', (code, expected) => {
    expect(plainFormName(code)).toEqual(expected);
  });
});

describe('plainFormName — every form in the reference data', () => {
  it('finds forms to check', () => {
    expect(DATA_FORMS.from.length).toBeGreaterThanOrEqual(17);
    expect(DATA_FORMS.to.length).toBeGreaterThanOrEqual(77);
  });

  it.each(DATA_FORMS.all)('%s has a name', (form) => {
    const { name, code } = plainFormName(form);
    expect(typeof name).toBe('string');
    expect(name.trim()).not.toBe('');
    expect(code === null || (typeof code === 'string' && code.trim() !== '')).toBe(true);
  });

  // A data form left out of the list would come back in the data's Title Case or with its code,
  // so this fails when a new form is added to the data without a name here.
  it.each(DATA_FORMS.all)('%s is named in sentence case, in plain words', (form) => {
    const { name } = plainFormName(form);
    expect(name[0]).toBe(name[0].toUpperCase());
    const laterWords = name.slice(1).split(/[\s,()/]+/).filter(Boolean);
    const capitalised = laterWords.filter((word) => /^[A-Z]/.test(word) && !['Eastern', 'V-cut', 'J-cut'].includes(word));
    expect(capitalised).toEqual([]);
    expect(name).not.toMatch(/D\/H|SIB|S\/B|w\/|Round/);
  });

  it.each(DATA_FORMS.all)('%s keeps its code only when the name says something different', (form) => {
    const { name, code } = plainFormName(form);
    if (code !== null) expect(code.toLowerCase()).not.toBe(name.toLowerCase());
  });
});

describe('plainFormName — text it does not know', () => {
  it.each([
    ['Collars'],
    ['Cheeks'],
    ['my special cut'],
    ['  Padded  '],
    ['H&G'],
    [''],
  ])('%j comes back unchanged with no code', (text) => {
    expect(plainFormName(text)).toEqual({ name: text, code: null });
  });

  it('does not guess from part of a known name', () => {
    expect(plainFormName('Round (Thawed)')).toEqual({ name: 'Round (Thawed)', code: null });
    expect(plainFormName('D/H')).toEqual({ name: 'D/H', code: null });
  });

  it.each([[undefined], [null], [42], [{}], [['Round']]])('%j, which is not text, has an empty name', (value) => {
    expect(plainFormName(value)).toEqual({ name: '', code: null });
  });
});

describe('plainFormName — how it matches', () => {
  it('ignores letter case and extra spaces, and returns the code as the data spells it', () => {
    expect(plainFormName('round')).toEqual({ name: 'Whole fish', code: 'Round' });
    expect(plainFormName('  d/h-on ')).toEqual({ name: 'Gutted, head on', code: 'D/H-On' });
    expect(plainFormName('skinless   fillet')).toEqual({ name: 'Skinless fillet', code: null });
    // The data has both "SIB Fillets" and "SIB fillets"
    expect(plainFormName('SIB fillets')).toEqual({ name: 'Skinless, boneless fillets', code: 'SIB Fillets' });
  });

  it('returns a fresh object each time', () => {
    const first = plainFormName('Round');
    first.name = 'changed';
    expect(plainFormName('Round').name).toBe('Whole fish');
  });
});
