/**
 * Backend handler core tests — public-calcs endpoint.
 *
 * Exercises the transport-agnostic handler (shared/handlers/publicCalcs.js)
 * through a faked data layer.  Covers:
 *   - handlePublicCalcs response shape
 *   - empty-result behaviour
 *   - sanitized error on db failure
 *
 * Test runner: Vitest (run via `cd app && npm test`)
 */

import { describe, it, expect, vi } from 'vitest';
import { handlePublicCalcs } from '../../../../shared/handlers/publicCalcs.js';

// ---------------------------------------------------------------------------
// Fake DbAdapter factory
// ---------------------------------------------------------------------------

function makeFakeDb(overrides = {}) {
  return {
    listPublicCalcs: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

const SAMPLE_CALC = {
  id: 1,
  species: 'Pink Salmon',
  product: 'Skinless Fillet',
  cost: 2.5,
  yield: 42,
  result: '{"costPerLb":5.95}',
  date: '2026-06-11T00:00:00.000Z',
};

// ===========================================================================
// handlePublicCalcs — success shape
// ===========================================================================

describe('handlePublicCalcs — success shape', () => {
  it('returns 200 with an array on success', async () => {
    const db = makeFakeDb({ listPublicCalcs: vi.fn().mockResolvedValue([SAMPLE_CALC]) });
    const result = await handlePublicCalcs({}, db);
    expect(result.status).toBe(200);
    expect(Array.isArray(result.body)).toBe(true);
  });

  it('returns the rows from db.listPublicCalcs', async () => {
    const db = makeFakeDb({ listPublicCalcs: vi.fn().mockResolvedValue([SAMPLE_CALC]) });
    const result = await handlePublicCalcs({}, db);
    expect(result.body).toHaveLength(1);
    expect(result.body[0]).toMatchObject({ species: 'Pink Salmon' });
  });

  it('returns an empty array when there are no public calculations', async () => {
    const db = makeFakeDb({ listPublicCalcs: vi.fn().mockResolvedValue([]) });
    const result = await handlePublicCalcs({}, db);
    expect(result.status).toBe(200);
    expect(result.body).toEqual([]);
  });

  it('works with no input argument (handler takes no userId)', async () => {
    const db = makeFakeDb();
    const result = await handlePublicCalcs(undefined, db);
    expect(result.status).toBe(200);
    expect(db.listPublicCalcs).toHaveBeenCalled();
  });
});

// ===========================================================================
// handlePublicCalcs — sanitized failure
// ===========================================================================

describe('handlePublicCalcs — sanitized failure', () => {
  it('returns 500 with a generic message when db throws', async () => {
    const db = makeFakeDb({
      listPublicCalcs: vi.fn().mockRejectedValue(new Error('pg: relation "calculations" does not exist')),
    });
    const result = await handlePublicCalcs({}, db);
    expect(result.status).toBe(500);
    expect(result.body.error).not.toMatch(/pg:|relation/i);
    expect(result.body.error).toBe('Failed to fetch calculations');
  });

  it('sanitizes SQLITE error messages', async () => {
    const db = makeFakeDb({
      listPublicCalcs: vi.fn().mockRejectedValue(new Error('SQLITE_ERROR: no such table: calculations')),
    });
    const result = await handlePublicCalcs({}, db);
    expect(result.status).toBe(500);
    expect(result.body.error).not.toMatch(/SQLITE/i);
    expect(result.body.error).toBe('Failed to fetch calculations');
  });
});
