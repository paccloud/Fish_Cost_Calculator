/**
 * Fish Data Test Suite
 * Tests for fish_data_v3.js structure, completeness, and accuracy
 *
 * Run with: npm test (after adding test script to package.json)
 */

import { describe, it, expect } from 'vitest';
import { FISH_DATA_V3, DATA_SOURCE, ACRONYMS } from './fish_data_v3.js';
import {
  checkMissingSpecies,
  checkMissingConversions,
  validateYieldChain,
  validateSchema,
  EXPECTED_SPECIES
} from './validate_fish_data.js';

describe('Fish Data V3 - Structure', () => {
  it('should export FISH_DATA_V3', () => {
    expect(FISH_DATA_V3).toBeDefined();
    expect(typeof FISH_DATA_V3).toBe('object');
  });

  it('should export DATA_SOURCE', () => {
    expect(DATA_SOURCE).toBeDefined();
    expect(DATA_SOURCE.title).toBe("Recoveries and Yields from Pacific Fish and Shellfish");
    expect(DATA_SOURCE.year).toBe(2004);
  });

  it('should export ACRONYMS', () => {
    expect(ACRONYMS).toBeDefined();
    expect(ACRONYMS['D/H-On']).toBe("Dressed/Head-On - Gutted, head attached");
    expect(ACRONYMS['D/H-Off']).toBe("Dressed/Head-Off - Gutted, head removed");
    expect(ACRONYMS['S/B']).toBe("Skinless/Boneless");
  });
});

describe('Fish Data V3 - Species Completeness', () => {
  it('should have all expected species from MAB-37 PDF', () => {
    const missingSpecies = checkMissingSpecies();

    if (missingSpecies.length > 0) {
      console.warn('Missing species:', missingSpecies);
    }

    expect(missingSpecies).toHaveLength(0);
  });

  it('should have at least 80 species total', () => {
    const count = Object.keys(FISH_DATA_V3).length;
    expect(count).toBeGreaterThanOrEqual(80);
  });
});

describe('Fish Data V3 - Schema Validation', () => {
  Object.keys(FISH_DATA_V3).forEach(species => {
    describe(`${species}`, () => {
      it('should have required fields', () => {
        const data = FISH_DATA_V3[species];
        expect(data).toHaveProperty('scientific_name');
        expect(data).toHaveProperty('category');
        expect(data).toHaveProperty('conversions');
      });

      it('should have valid scientific name', () => {
        const scientificName = FISH_DATA_V3[species].scientific_name;
        expect(typeof scientificName).toBe('string');
        expect(scientificName.length).toBeGreaterThan(0);
      });

      it('should have valid category', () => {
        const category = FISH_DATA_V3[species].category;
        const validCategories = [
          'Salmon', 'Groundfish', 'Flatfish', 'Rockfish',
          'Shark', 'Other', 'Crab', 'Shrimp', 'Shellfish'
        ];
        expect(validCategories).toContain(category);
      });

      it('should have conversions object', () => {
        const conversions = FISH_DATA_V3[species].conversions;
        expect(typeof conversions).toBe('object');
        expect(Object.keys(conversions).length).toBeGreaterThan(0);
      });

      it('should pass full schema validation', () => {
        const errors = validateSchema(species);
        if (errors.length > 0) {
          console.error(`Schema errors for ${species}:`, errors);
        }
        expect(errors).toHaveLength(0);
      });
    });
  });
});

describe('Fish Data V3 - Conversion Validation', () => {
  Object.keys(FISH_DATA_V3).forEach(species => {
    const conversions = FISH_DATA_V3[species].conversions;

    Object.keys(conversions).forEach(conversionKey => {
      describe(`${species} - ${conversionKey}`, () => {
        const conv = conversions[conversionKey];

        it('should have valid yield value', () => {
          expect(typeof conv.yield).toBe('number');
          expect(conv.yield).toBeGreaterThan(0);
          expect(conv.yield).toBeLessThanOrEqual(100);
        });

        it('should have valid range (if present)', () => {
          if (conv.range !== null) {
            expect(Array.isArray(conv.range)).toBe(true);
            expect(conv.range).toHaveLength(2);
            expect(conv.range[0]).toBeLessThanOrEqual(conv.range[1]);

            // Yield should fall within range
            expect(conv.yield).toBeGreaterThanOrEqual(conv.range[0]);
            expect(conv.yield).toBeLessThanOrEqual(conv.range[1]);
          }
        });
      });
    });
  });
});

describe('Fish Data V3 - Yield Chain Consistency', () => {
  const testCases = [
    { species: "Pink Salmon", chain: ["Round", "D/H-On", "D/H-Off"] },
    { species: "Chum Salmon", chain: ["Round", "D/H-On", "D/H-Off"] },
    { species: "Sockeye Salmon", chain: ["Round", "D/H-On", "D/H-Off"] },
    { species: "Coho Salmon", chain: ["Round", "D/H-On", "D/H-Off"] },
    { species: "Pacific Cod", chain: ["Round", "D/H-On", "D/H-Off"] },
    { species: "Pacific Halibut", chain: ["Round", "D/H-On", "D/H-Off"] },
    { species: "Lingcod", chain: ["Round", "D/H-On", "D/H-Off"] },
  ];

  testCases.forEach(({ species, chain }) => {
    it(`${species}: ${chain.join(" → ")} should be mathematically consistent`, () => {
      const result = validateYieldChain(species, chain);

      if (result === null || result.valid === null) {
        const message = `Cannot validate ${species}: ${result?.message || 'species not found'}`;
        console.error(message);
        throw new Error(message);
      }

      if (!result.valid) {
        console.warn(
          `${species}: Compound yield ${result.compound}% vs direct ${result.direct}% ` +
          `(difference: ${result.difference}%)`
        );
      }

      // Allow 2% tolerance for rounding differences
      expect(result.valid).toBe(true);
    });
  });
});

describe('Fish Data V3 - Key Species Conversions', () => {
  describe('Pacific Cod', () => {
    it('should have D/H-On to fillet conversions', () => {
      const result = checkMissingConversions('Pacific Cod');
      const dhOnFillets = result.missing.filter(c =>
        c.startsWith('D/H-On →') && c.includes('Fillet')
      );

      if (dhOnFillets.length > 0) {
        console.warn('Pacific Cod missing D/H-On conversions:', dhOnFillets);
      }

      expect(dhOnFillets).toHaveLength(0);
    });

    it('should have D/H-Off to SIB fillet conversions', () => {
      const cod = FISH_DATA_V3['Pacific Cod'];
      expect(cod.conversions['D/H-Off → SIB Fillets']).toBeDefined();
    });
  });

  describe('Pink Salmon', () => {
    it('should have comprehensive D/H-On conversions', () => {
      const result = checkMissingConversions('Pink Salmon');
      const dhOnConversions = result.missing.filter(c => c.startsWith('D/H-On →'));

      if (dhOnConversions.length > 0) {
        console.warn('Pink Salmon missing D/H-On conversions:', dhOnConversions);
      }

      expect(dhOnConversions).toHaveLength(0);
    });

    it('should have comprehensive D/H-Off conversions', () => {
      const result = checkMissingConversions('Pink Salmon');
      const dhOffConversions = result.missing.filter(c => c.startsWith('D/H-Off →'));

      if (dhOffConversions.length > 0) {
        console.warn('Pink Salmon missing D/H-Off conversions:', dhOffConversions);
      }

      expect(dhOffConversions).toHaveLength(0);
    });

    it('should have thawed conversions', () => {
      const salmon = FISH_DATA_V3['Pink Salmon'];
      expect(salmon.conversions['D/H-On (Thawed) → Skin-On Fillet']).toBeDefined();
      expect(salmon.conversions['D/H-Off (Thawed) → Skin-On Fillet']).toBeDefined();
    });
  });

  describe('Pacific Halibut', () => {
    it('should have D/H-On to fillet conversions', () => {
      const halibut = FISH_DATA_V3['Pacific Halibut'];
      expect(halibut.conversions['D/H-On → Skin-On Fillet']).toBeDefined();
      expect(halibut.conversions['D/H-On → Skinless Fillet (Fletch)']).toBeDefined();
    });
  });

  describe('All Salmon Species', () => {
    const salmonSpecies = ['Pink Salmon', 'Chum Salmon', 'Sockeye Salmon', 'Coho Salmon', 'Chinook Salmon'];

    salmonSpecies.forEach(species => {
      it(`${species} should have D/H-On → Skinless Fillet conversion`, () => {
        const salmon = FISH_DATA_V3[species];
        expect(salmon?.conversions['D/H-On → Skinless Fillet']).toBeDefined();
      });

      it(`${species} should have D/H-Off → Skinless Fillet conversion`, () => {
        const salmon = FISH_DATA_V3[species];
        expect(salmon?.conversions['D/H-Off → Skinless Fillet']).toBeDefined();
      });
    });
  });
});

describe('Fish Data V3 - Special Cases', () => {
  it('should have Fish Meal entry', () => {
    expect(FISH_DATA_V3['Fish Meal']).toBeDefined();
  });

  it('should have Sharks General entry', () => {
    expect(FISH_DATA_V3['Sharks General']).toBeDefined();
  });

  it('should have Farmed Salmon entries', () => {
    expect(FISH_DATA_V3['Norwegian Farmed Salmon']).toBeDefined();
    expect(FISH_DATA_V3['Chilean Farmed Salmon']).toBeDefined();
  });

  it('should have Redstriped Rockfish', () => {
    expect(FISH_DATA_V3['Redstriped Rockfish']).toBeDefined();
  });

  it('should have Rosethorn Rockfish', () => {
    expect(FISH_DATA_V3['Rosethorn Rockfish']).toBeDefined();
  });
});
