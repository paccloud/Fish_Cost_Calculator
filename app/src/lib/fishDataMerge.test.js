import { describe, it, expect } from 'vitest';
import { mergeFishData } from './fishDataMerge.js';

// ---------------------------------------------------------------------------
// Fixtures — minimal shapes mirroring real data
// ---------------------------------------------------------------------------

const STATIC = {
  'Pink Salmon': {
    scientific_name: 'Oncorhynchus gorbuscha',
    category: 'Salmon',
    conversions: {
      'Skinless Fillet': { yield: 42, range: [41, 46], from: 'Round', to: 'Skinless Fillet' },
      'D/H-On':          { yield: 91, range: [84, 94], from: 'Round', to: 'D/H-On' },
    },
  },
  'Atlantic Cod': {
    scientific_name: 'Gadus morhua',
    category: 'Groundfish',
    conversions: {
      'Skinless Fillet': { yield: 38, range: [35, 42], from: 'Round', to: 'Skinless Fillet' },
    },
  },
};

// ---------------------------------------------------------------------------
// 1. Empty / null inputs
// ---------------------------------------------------------------------------
describe('empty inputs', () => {
  it('returns empty object when all inputs are empty/null', () => {
    expect(mergeFishData({}, [], {})).toEqual({});
    expect(mergeFishData(null, [], {})).toEqual({});
    expect(mergeFishData(undefined, null, null)).toEqual({});
  });

  it('returns static data unchanged when no user data', () => {
    const result = mergeFishData(STATIC, [], {});
    expect(result['Pink Salmon'].conversions['Skinless Fillet'].yield).toBe(42);
    expect(result['Atlantic Cod'].conversions['Skinless Fillet'].yield).toBe(38);
  });

  it('does not mutate the staticData input', () => {
    const staticCopy = JSON.parse(JSON.stringify(STATIC));
    mergeFishData(staticCopy, [{ species: 'Pink Salmon', product: 'Skinless Fillet', yield: 99 }], {});
    expect(staticCopy['Pink Salmon'].conversions['Skinless Fillet'].yield).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// 2. Precedence: user-synced yields override static data
// ---------------------------------------------------------------------------
describe('customYields precedence over static data', () => {
  it('adds a new conversion key for an existing species', () => {
    const yields = [{ species: 'Pink Salmon', product: 'My Product', yield: 55, syncStatus: 'synced' }];
    const result = mergeFishData(STATIC, yields, {});
    expect(result['Pink Salmon'].conversions['Custom: My Product']).toBeDefined();
    expect(result['Pink Salmon'].conversions['Custom: My Product'].yield).toBe(55);
    // static conversions still present
    expect(result['Pink Salmon'].conversions['Skinless Fillet'].yield).toBe(42);
  });

  it('preserves static scientific_name and category on existing species', () => {
    const yields = [{ species: 'Pink Salmon', product: 'Test', yield: 50, syncStatus: 'synced' }];
    const result = mergeFishData(STATIC, yields, {});
    expect(result['Pink Salmon'].scientific_name).toBe('Oncorhynchus gorbuscha');
    expect(result['Pink Salmon'].category).toBe('Salmon');
  });

  it('creates a new species entry for unknown species in customYields', () => {
    const yields = [{ species: 'Tilapia', product: 'Fillet', yield: 33, syncStatus: 'synced' }];
    const result = mergeFishData(STATIC, yields, {});
    expect(result['Tilapia']).toBeDefined();
    expect(result['Tilapia'].conversions['Custom: Fillet'].yield).toBe(33);
  });

  it('maps yield to from:Custom, to:product', () => {
    const yields = [{ species: 'Pink Salmon', product: 'SIB', yield: 44, syncStatus: 'synced' }];
    const result = mergeFishData(STATIC, yields, {});
    const conv = result['Pink Salmon'].conversions['Custom: SIB'];
    expect(conv.from).toBe('Custom');
    expect(conv.to).toBe('SIB');
  });

  it('parses yield as float when given as a string', () => {
    const yields = [{ species: 'Atlantic Cod', product: 'Fillet', yield: '38.5', syncStatus: 'synced' }];
    const result = mergeFishData(STATIC, yields, {});
    expect(result['Atlantic Cod'].conversions['Custom: Fillet'].yield).toBe(38.5);
  });
});

// ---------------------------------------------------------------------------
// 3. Sync-status flags
// ---------------------------------------------------------------------------
describe('syncStatus flags', () => {
  it('includes synced items', () => {
    const yields = [{ species: 'Pink Salmon', product: 'SIB', yield: 44, syncStatus: 'synced' }];
    const result = mergeFishData(STATIC, yields, {});
    expect(result['Pink Salmon'].conversions['Custom: SIB']).toBeDefined();
  });

  it('includes local items', () => {
    const yields = [{ species: 'Pink Salmon', product: 'SIB', yield: 44, syncStatus: 'local' }];
    const result = mergeFishData(STATIC, yields, {});
    expect(result['Pink Salmon'].conversions['Custom: SIB']).toBeDefined();
  });

  it('excludes pending-delete items', () => {
    const yields = [{ species: 'Pink Salmon', product: 'SIB', yield: 44, syncStatus: 'pending-delete' }];
    const result = mergeFishData(STATIC, yields, {});
    expect(result['Pink Salmon'].conversions['Custom: SIB']).toBeUndefined();
  });

  it('excludes pending-delete while keeping other items for the same species', () => {
    const yields = [
      { species: 'Pink Salmon', product: 'SIB',     yield: 44, syncStatus: 'pending-delete' },
      { species: 'Pink Salmon', product: 'D/H-Off',  yield: 82, syncStatus: 'synced' },
    ];
    const result = mergeFishData(STATIC, yields, {});
    expect(result['Pink Salmon'].conversions['Custom: SIB']).toBeUndefined();
    expect(result['Pink Salmon'].conversions['Custom: D/H-Off'].yield).toBe(82);
  });

  it('treats missing syncStatus as included (legacy items)', () => {
    const yields = [{ species: 'Pink Salmon', product: 'SIB', yield: 44 }];
    const result = mergeFishData(STATIC, yields, {});
    expect(result['Pink Salmon'].conversions['Custom: SIB']).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 4. Custom species layering (highest precedence)
// ---------------------------------------------------------------------------
describe('customSpecies layering', () => {
  it('adds a brand-new species from customSpecies', () => {
    const customSpecies = {
      'Butterfish': {
        conversions: {
          'Round to Fillet': { yield: 30, from: 'Round', to: 'Fillet' },
        },
      },
    };
    const result = mergeFishData(STATIC, [], customSpecies);
    expect(result['Butterfish']).toBeDefined();
    expect(result['Butterfish'].conversions['Round to Fillet'].yield).toBe(30);
  });

  it('adds new conversions to an existing species', () => {
    const customSpecies = {
      'Pink Salmon': {
        conversions: {
          'Round to Collar': { yield: 15, from: 'Round', to: 'Collar' },
        },
      },
    };
    const result = mergeFishData(STATIC, [], customSpecies);
    expect(result['Pink Salmon'].conversions['Round to Collar'].yield).toBe(15);
    // static still there
    expect(result['Pink Salmon'].conversions['Skinless Fillet'].yield).toBe(42);
  });

  it('customSpecies wins over static when conversion keys collide', () => {
    const customSpecies = {
      'Pink Salmon': {
        conversions: {
          'Skinless Fillet': { yield: 99, from: 'Round', to: 'Skinless Fillet' },
        },
      },
    };
    const result = mergeFishData(STATIC, [], customSpecies);
    expect(result['Pink Salmon'].conversions['Skinless Fillet'].yield).toBe(99);
  });

  it('customSpecies wins over customYields when conversion keys collide', () => {
    const yields = [{ species: 'Pink Salmon', product: 'SIB', yield: 44, syncStatus: 'synced' }];
    const customSpecies = {
      'Pink Salmon': {
        conversions: {
          'Custom: SIB': { yield: 77, from: 'Custom', to: 'SIB' },
        },
      },
    };
    const result = mergeFishData(STATIC, yields, customSpecies);
    // customSpecies is applied last, so its value wins
    expect(result['Pink Salmon'].conversions['Custom: SIB'].yield).toBe(77);
  });
});

// ---------------------------------------------------------------------------
// 5. Multiple yields for the same species
// ---------------------------------------------------------------------------
describe('multiple yields for same species', () => {
  it('merges all custom conversions for the same species', () => {
    const yields = [
      { species: 'Atlantic Cod', product: 'SIB',      yield: 35, syncStatus: 'synced' },
      { species: 'Atlantic Cod', product: 'Collar',    yield: 12, syncStatus: 'local' },
    ];
    const result = mergeFishData(STATIC, yields, {});
    expect(result['Atlantic Cod'].conversions['Custom: SIB'].yield).toBe(35);
    expect(result['Atlantic Cod'].conversions['Custom: Collar'].yield).toBe(12);
    // static still present
    expect(result['Atlantic Cod'].conversions['Skinless Fillet'].yield).toBe(38);
  });
});

// ---------------------------------------------------------------------------
// 6. Full three-layer precedence chain
// ---------------------------------------------------------------------------
describe('full three-layer precedence', () => {
  it('static < customYields < customSpecies for overlapping conversion keys', () => {
    // static has Skinless Fillet = 42
    // customYields has "Custom: SIB" = 55 (different key — no collision with static)
    // customSpecies overrides "Skinless Fillet" = 99 (overrides static)
    const yields = [{ species: 'Pink Salmon', product: 'SIB', yield: 55, syncStatus: 'synced' }];
    const customSpecies = {
      'Pink Salmon': {
        conversions: {
          'Skinless Fillet': { yield: 99, from: 'Round', to: 'Skinless Fillet' },
        },
      },
    };
    const result = mergeFishData(STATIC, yields, customSpecies);
    expect(result['Pink Salmon'].conversions['Skinless Fillet'].yield).toBe(99); // customSpecies wins
    expect(result['Pink Salmon'].conversions['Custom: SIB'].yield).toBe(55);     // customYields present
    expect(result['Pink Salmon'].conversions['D/H-On'].yield).toBe(91);          // static present
  });
});
