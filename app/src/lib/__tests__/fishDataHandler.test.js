/**
 * Backend handler core tests — fish-data endpoint.
 *
 * Exercises the transport-agnostic handler (shared/handlers/fishData.js)
 * through a faked data layer.  Covers:
 *   - handleFishData response shape (fishData, profiles, source keys)
 *   - empty-result behaviour
 *   - source citation object is always present
 *   - sanitized error on db failure
 *
 * Test runner: Vitest (run via `cd app && npm test`)
 */

import { describe, it, expect, vi } from 'vitest';
import { handleFishData } from '../../../../shared/handlers/fishData.js';

// ---------------------------------------------------------------------------
// Fake DbAdapter factory
// ---------------------------------------------------------------------------

const SAMPLE_PAYLOAD = {
  fishData: {
    'Pink Salmon': {
      scientific_name: 'Oncorhynchus gorbuscha',
      category: 'Salmon',
      conversions: {
        'Skinless Fillet': { yield: 42, range: [41, 46], from: 'Round', to: 'Skinless Fillet' },
      },
    },
  },
  profiles: {
    'Pink Salmon': {
      description: 'A Pacific salmon species.',
      culinary_uses: 'Grilling, smoking',
      edible_portions: null,
      url: null,
    },
  },
  source: {
    title: 'Recoveries and Yields from Pacific Fish and Shellfish',
    authors: ['Chuck Crapo', 'Brian Paust', 'Jerry Babbitt'],
    publisher: 'Alaska Sea Grant College Program',
    publication: 'Marine Advisory Bulletin No. 37',
    year: 2004,
  },
};

const EMPTY_PAYLOAD = {
  fishData: {},
  profiles: {},
  source: {
    title: 'Recoveries and Yields from Pacific Fish and Shellfish',
    authors: ['Chuck Crapo', 'Brian Paust', 'Jerry Babbitt'],
    publisher: 'Alaska Sea Grant College Program',
    publication: 'Marine Advisory Bulletin No. 37',
    year: 2004,
  },
};

function makeFakeDb(overrides = {}) {
  return {
    getFishData: vi.fn().mockResolvedValue(EMPTY_PAYLOAD),
    ...overrides,
  };
}

// ===========================================================================
// handleFishData — success shape
// ===========================================================================

describe('handleFishData — success shape', () => {
  it('returns 200 on success', async () => {
    const db = makeFakeDb({ getFishData: vi.fn().mockResolvedValue(SAMPLE_PAYLOAD) });
    const result = await handleFishData({}, db);
    expect(result.status).toBe(200);
  });

  it('body has fishData, profiles, and source keys', async () => {
    const db = makeFakeDb({ getFishData: vi.fn().mockResolvedValue(SAMPLE_PAYLOAD) });
    const result = await handleFishData({}, db);
    expect(result.body).toHaveProperty('fishData');
    expect(result.body).toHaveProperty('profiles');
    expect(result.body).toHaveProperty('source');
  });

  it('source always contains the MAB-37 citation', async () => {
    const db = makeFakeDb({ getFishData: vi.fn().mockResolvedValue(SAMPLE_PAYLOAD) });
    const result = await handleFishData({}, db);
    expect(result.body.source.publication).toBe('Marine Advisory Bulletin No. 37');
    expect(result.body.source.year).toBe(2004);
  });

  it('returns the full payload from db.getFishData unchanged', async () => {
    const db = makeFakeDb({ getFishData: vi.fn().mockResolvedValue(SAMPLE_PAYLOAD) });
    const result = await handleFishData({}, db);
    expect(result.body).toEqual(SAMPLE_PAYLOAD);
  });

  it('returns 200 with empty fishData and profiles when db returns empty', async () => {
    const db = makeFakeDb({ getFishData: vi.fn().mockResolvedValue(EMPTY_PAYLOAD) });
    const result = await handleFishData({}, db);
    expect(result.status).toBe(200);
    expect(result.body.fishData).toEqual({});
    expect(result.body.profiles).toEqual({});
  });

  it('works with no input argument (handler takes no userId)', async () => {
    const db = makeFakeDb();
    const result = await handleFishData(undefined, db);
    expect(result.status).toBe(200);
    expect(db.getFishData).toHaveBeenCalled();
  });
});

// ===========================================================================
// handleFishData — sanitized failure
// ===========================================================================

describe('handleFishData — sanitized failure', () => {
  it('returns 500 with a generic message when db throws', async () => {
    const db = makeFakeDb({
      getFishData: vi.fn().mockRejectedValue(new Error('pg: relation "species" does not exist')),
    });
    const result = await handleFishData({}, db);
    expect(result.status).toBe(500);
    expect(result.body.error).not.toMatch(/pg:|relation/i);
    expect(result.body.error).toBe('Failed to fetch fish data');
  });

  it('sanitizes SQLITE error messages', async () => {
    const db = makeFakeDb({
      getFishData: vi.fn().mockRejectedValue(new Error('SQLITE_ERROR: no such table: species')),
    });
    const result = await handleFishData({}, db);
    expect(result.status).toBe(500);
    expect(result.body.error).not.toMatch(/SQLITE/i);
    expect(result.body.error).toBe('Failed to fetch fish data');
  });
});
