/**
 * The reference yields the app ships.
 *
 * They are generated from the bulletin as re-read (research/mab37/), so the first thing checked is
 * that the generated file is the one the generator would write today. The rest pins the shape the
 * calculator relies on and the corrections made in November 2026, so none of them can slip back.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { FISH_DATA_V3, PROCESSING_DATA, DATA_SOURCE, ACRONYMS, UNCERTAIN_DATA } from './fish_data_v3.js';
import { MAB37_YIELDS } from './mab37_yields.js';
import { buildYields, render, OUTPUT } from '../../../research/mab37/to-app.mjs';

const bulletin = JSON.parse(readFileSync(new URL('../../../research/mab37/mab37.json', import.meta.url), 'utf8'));
const ROWS = new Map(bulletin.rows.map((row) => [row.id, row]));
const ALL = Object.entries(FISH_DATA_V3).flatMap(([species, data]) =>
  Object.entries(data.conversions).map(([key, conv]) => ({ species, key, conv }))
);
const CATEGORIES = ['Salmon', 'Groundfish', 'Flatfish', 'Rockfish', 'Shark', 'Other', 'Crab', 'Shrimp', 'Shellfish'];

describe('the generated file', () => {
  it('is what research/mab37/to-app.mjs writes from mab37.json today', () => {
    const { yields, problems } = buildYields();
    expect(problems).toEqual([]);
    // If this fails, run: node research/mab37/to-app.mjs
    expect(readFileSync(OUTPUT, 'utf8')).toBe(render(yields));
  });

  it('is what the app exports as its reference yields', () => {
    expect(FISH_DATA_V3).toBe(MAB37_YIELDS);
  });
});

describe('every conversion is a row of the bulletin', () => {
  it('has 89 species and 709 conversions', () => {
    expect(Object.keys(FISH_DATA_V3)).toHaveLength(89);
    expect(ALL).toHaveLength(709);
  });

  it.each(ALL)('$species: $key', ({ key, conv }) => {
    const row = ROWS.get(conv.row);
    expect(row).toBeDefined();
    // The thawed salmon tables add "(Thawed)" to the starting form; nothing else is reworded
    expect(key.replace(' (Thawed) → ', ' → ')).toBe(`${row.from} → ${row.to}`);
    expect(conv.yield).toBe(row.average);
    expect(conv.range).toEqual(row.range);
  });
});

describe('the shape the calculator reads', () => {
  it.each(Object.entries(FISH_DATA_V3))('%s has a name, a category and conversions', (_species, data) => {
    expect(typeof data.scientific_name).toBe('string');
    expect(data.scientific_name).not.toBe('');
    expect(CATEGORIES).toContain(data.category);
    expect(Object.keys(data.conversions).length).toBeGreaterThan(0);
  });

  it.each(ALL)('$species: $key has a usable yield or a range to choose from', ({ key, conv }) => {
    expect(key.split(' → ')).toHaveLength(2);
    if (conv.yield === null) {
      // The bulletin printed only a range: the calculator asks for a yield within it
      expect(conv.range).not.toBeNull();
    } else {
      expect(conv.yield).toBeGreaterThan(0);
      expect(conv.yield).toBeLessThanOrEqual(100);
    }
    if (conv.range !== null) {
      expect(conv.range).toHaveLength(2);
      expect(conv.range[0]).toBeGreaterThan(0);
      expect(conv.range[0]).toBeLessThanOrEqual(conv.range[1]);
      expect(conv.range[1]).toBeLessThanOrEqual(100);
      if (conv.yield !== null) {
        expect(conv.yield).toBeGreaterThanOrEqual(conv.range[0]);
        expect(conv.yield).toBeLessThanOrEqual(conv.range[1]);
      }
    }
  });

  it('never invents an average: exactly the ten range-only rows have none', () => {
    const rangeOnly = ALL.filter(({ conv }) => conv.yield === null).map(({ species, key }) => `${species}: ${key}`);
    expect(rangeOnly).toEqual([
      'Pacific Hake: Round → Roe',
      'Sturgeon: Round → Roe',
      'American Shad: Round → Roe',
      'Dungeness Crab: Raw Whole → Cooked Meat (during molt)',
      'King Crab (Red/Brown/Golden): Raw Whole → Cooked Meat (during molt)',
      'Blue King Crab: Raw Whole → Cooked Meat (during molt)',
      'Tanner Crab: Raw Whole → Cooked Meat (during molt)',
      'Oysters: Raw Whole → Raw Meats',
      'Sea Urchin (Green): Round → Roe',
      'Sea Urchin (Red): Round → Roe',
    ]);
  });
});

describe('gutting then heading agrees with the direct yield', () => {
  it.each(['Pink Salmon', 'Chum Salmon', 'Sockeye Salmon', 'Coho Salmon', 'Pacific Cod', 'Pacific Halibut', 'Lingcod'])('%s', (species) => {
    const c = FISH_DATA_V3[species].conversions;
    const compound = (c['Round → D/H-On'].yield * c['D/H-On → D/H-Off'].yield) / 100;
    expect(Math.abs(compound - c['Round → D/H-Off'].yield)).toBeLessThanOrEqual(2);
  });
});

describe('the corrections of November 2026', () => {
  const conv = (species, key) => FISH_DATA_V3[species].conversions[key];

  it('spells skinless, boneless as the bulletin does', () => {
    expect(ALL.filter(({ key }) => /\bSIB\b/.test(key))).toEqual([]);
    expect(conv('Pacific Cod', 'Round → S/B Fillets (V-cut)')).toMatchObject({ yield: 33, range: [18, 39] });
    expect(ACRONYMS).not.toHaveProperty('SIB');
    expect(ACRONYMS['S/B']).toBe('Skinless/Boneless');
  });

  it('gives Rougheye and Shortraker rockfish the second rockfish table', () => {
    for (const species of ['Rougheye Rockfish', 'Shortraker Rockfish']) {
      expect(conv(species, 'Round → Skin-On Fillet')).toMatchObject({ yield: 28, range: [25, 35] });
      expect(conv(species, 'Round → Skinless Fillet')).toMatchObject({ yield: 23, range: [21, 30] });
      expect(conv(species, 'D/H-On → Skin-On Fillet').yield).toBe(49);
      expect(conv(species, 'D/H-On → Skinless Fillet').yield).toBe(40);
    }
    // The three species of the first table keep its higher yields
    expect(conv('Black Rockfish', 'Round → Skin-On Fillet')).toMatchObject({ yield: 32, range: [30, 36] });
  });

  it('puts salted and smoked whole-fish yields under whole fish', () => {
    expect(conv('Smelt', 'Round → Smoked D/H-Off').yield).toBe(57);
    expect(conv('Smelt', 'Round → Salted D/H-Off').yield).toBe(45);
    expect(conv('Atka Mackerel', 'Round → Salted D/H-Off').yield).toBe(41);
    expect(conv('Sturgeon', 'Round → Smoked D/H-Off').yield).toBe(56);
    expect(conv('Trout', 'Round → Smoked D/H-Off').yield).toBe(54);
    expect(conv('Eels', 'Round → Smoked D/H-Off').yield).toBe(65);
    for (const species of ['Smelt', 'Atka Mackerel', 'Sturgeon', 'Trout', 'Eels', 'Pacific Cod']) {
      expect(conv(species, 'D/H-Off → Smoked')).toBeUndefined();
      expect(conv(species, 'D/H-Off → Salted')).toBeUndefined();
    }
  });

  it('keeps the cod belly flaps on cod', () => {
    expect(conv('Capelin', 'Round → Belly Flaps')).toBeUndefined();
    expect(conv('Pacific Cod', 'Round → Belly Flaps').yield).toBe(10);
  });

  it('has the bulletin\'s numbers for hake, pollock, sablefish and trout', () => {
    expect(conv('Pacific Hake', 'D/H-On → Skin-On Fillets').yield).toBe(51);
    expect(conv('Pacific Hake', 'D/H-On → Skinless Fillets').yield).toBe(38);
    expect(conv('Pacific Hake', 'D/H-On → S/B Fillets').yield).toBe(32);
    expect(conv('Pacific Hake', 'Skin-On Fillets → Skinless Fillets').yield).toBe(75);
    expect(conv('Walleye Pollock', 'Trim → Mince').yield).toBe(90);
    expect(conv('Walleye Pollock', 'Round → Roe')).toMatchObject({ yield: 6.5, range: [3, 20] });
    expect(conv('Sablefish', 'D/H-Off (Eastern) → Skin-On Fillets').yield).toBe(64);
    expect(conv('Sablefish', 'D/H-Off (Eastern) → Skinless Fillet').yield).toBe(56);
    expect(conv('Trout', 'D/H-Off → Skinless Fillet').yield).toBe(79);
  });

  it('adds rows the bulletin prints and the app lacked', () => {
    expect(conv('Canary Rockfish', 'Round → D/H-Off (Eastern)')).toBeDefined();
    expect(conv('Canary Rockfish', 'Skin-On Fillet → Skinless Fillet')).toBeDefined();
    expect(conv('Chinook Salmon', 'Raw Steak → Baked Steak')).toBeDefined();
    expect(conv('Dungeness Crab', 'Raw Whole → Cooked Meat (during molt)')).toMatchObject({ yield: null, range: [13, 14] });
  });

  it('leaves unchanged what was right', () => {
    expect(conv('Sockeye Salmon', 'Round → Skinless Fillet')).toMatchObject({ yield: 46, range: [41, 49] });
    expect(conv('Pink Salmon', 'Round → D/H-On')).toMatchObject({ yield: 91, range: [84, 94] });
    expect(conv('Pink Salmon', 'D/H-On (Thawed) → Skin-On Fillet')).toMatchObject({ yield: 54, range: null });
    expect(conv('Pacific Halibut', 'D/H-On → Skinless Fillet (Fletch)')).toBeDefined();
  });
});

describe('notes and cautions', () => {
  it('carries the bulletin\'s own note on every thawed salmon row, and on no other', () => {
    const noted = ALL.filter(({ conv }) => conv.note);
    expect(noted).toHaveLength(16);
    for (const { key, conv } of noted) {
      expect(key).toContain('(Thawed)');
      expect(conv.note).toMatch(/^Freezing conditions and length of storage/);
    }
  });

  it('lists the eleven values that look wrong in the bulletin itself', () => {
    expect(UNCERTAIN_DATA.map((item) => `${item.species}: ${item.field}`)).toEqual([
      'Chum Salmon: D/H-Off → Salted D/H-Off',
      'Chum Salmon: D/H-Off → Smoked Sides',
      'Sockeye Salmon: D/H-On → S/B Trim',
      'Pacific Cod: Round → Skin-On Fillets',
      'Pacific Cod: D/H-Off → Skinless Fillets',
      'Walleye Pollock: Round → Mince',
      'Arrowtooth Flounder: Round → Kurimi',
      'Yellowfin Sole: Round → Kurimi',
      'Spiny Dogfish: Round → Viscera',
      'Sablefish: D/H-Off → Skinless Fillet',
      'Pink Shrimp: Raw Headless → Cooked Peeled',
    ]);
    for (const item of UNCERTAIN_DATA) {
      expect(item.note.length).toBeGreaterThan(20);
      expect(ROWS.get(item.row).check).toBeTruthy();
    }
  });

  it('keeps the printed value beside its caution', () => {
    expect(FISH_DATA_V3.Sablefish.conversions['D/H-Off → Skinless Fillet']).toMatchObject({ yield: 28, range: null });
    expect(FISH_DATA_V3.Sablefish.conversions['D/H-Off → Skinless Fillet'].caution).toMatch(/prints 28%/);
  });
});

describe('what the bulletin does not hold', () => {
  it('cites the source', () => {
    expect(DATA_SOURCE).toMatchObject({ publication: 'Marine Advisory Bulletin No. 37', year: 2004, isbn: '1-56612-012-8' });
  });

  it('has the fish meal table as the bulletin prints it', () => {
    expect(PROCESSING_DATA['Fish Meal'].conversions).toEqual({
      'Lean Fish → Meal': { yield: 18, range: [16, 20] },
      'Fatty Fish → Meal': { yield: 22, range: [20, 25] },
    });
  });
});
