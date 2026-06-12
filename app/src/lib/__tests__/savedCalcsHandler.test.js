/**
 * Backend handler core tests — saved-calculations endpoints.
 *
 * Exercises the transport-agnostic handlers (shared/handlers/savedCalcs.js)
 * through a faked data layer.  Covers:
 *   - handleListSavedCalcs
 *   - handleSaveCalc
 *   - handleDeleteCalc
 *
 * Test runner: Vitest (run via `cd app && npm test`)
 */

import { describe, it, expect, vi } from 'vitest';
import {
  handleListSavedCalcs,
  handleSaveCalc,
  handleDeleteCalc,
} from '../../../../shared/handlers/savedCalcs.js';

// ---------------------------------------------------------------------------
// Fake DbAdapter factory
// ---------------------------------------------------------------------------

/**
 * @param {Partial<import('../../../../../shared/db/interface.js').DbAdapter>} overrides
 */
function makeFakeDb(overrides = {}) {
  return {
    findUserByUsername: vi.fn().mockResolvedValue(null),
    createUser: vi.fn(),
    listSavedCalcs: vi.fn().mockResolvedValue([]),
    saveCalc: vi.fn().mockResolvedValue({ id: 1 }),
    findCalcById: vi.fn().mockResolvedValue(null),
    deleteCalc: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const SAMPLE_CALC = {
  id: 1,
  user_id: 42,
  name: 'Test Calc',
  species: 'Pink Salmon',
  product: 'Skinless Fillet',
  cost: 2.5,
  yield: 42,
  result: '{"costPerLb":5.95}',
  date: '2026-06-11T00:00:00.000Z',
};

// ===========================================================================
// handleListSavedCalcs
// ===========================================================================

describe('handleListSavedCalcs — auth requirement', () => {
  it('returns 401 when userId is missing', async () => {
    const db = makeFakeDb();
    const result = await handleListSavedCalcs({}, db);
    expect(result.status).toBe(401);
    expect(result.body.error).toMatch(/unauthorized/i);
  });

  it('returns 401 when userId is null', async () => {
    const db = makeFakeDb();
    const result = await handleListSavedCalcs({ userId: null }, db);
    expect(result.status).toBe(401);
  });
});

describe('handleListSavedCalcs — success shape', () => {
  it('returns 200 with an array on success', async () => {
    const db = makeFakeDb({
      listSavedCalcs: vi.fn().mockResolvedValue([SAMPLE_CALC]),
    });
    const result = await handleListSavedCalcs({ userId: 42 }, db);
    expect(result.status).toBe(200);
    expect(Array.isArray(result.body)).toBe(true);
    expect(result.body).toHaveLength(1);
    expect(result.body[0].id).toBe(1);
  });

  it('returns 200 with empty array when user has no calcs', async () => {
    const db = makeFakeDb({ listSavedCalcs: vi.fn().mockResolvedValue([]) });
    const result = await handleListSavedCalcs({ userId: 99 }, db);
    expect(result.status).toBe(200);
    expect(result.body).toEqual([]);
  });

  it('queries by the correct userId', async () => {
    const db = makeFakeDb({ listSavedCalcs: vi.fn().mockResolvedValue([]) });
    await handleListSavedCalcs({ userId: 7 }, db);
    expect(db.listSavedCalcs).toHaveBeenCalledWith(7);
  });
});

describe('handleListSavedCalcs — sanitized failure', () => {
  it('returns 500 with generic message when db throws', async () => {
    const db = makeFakeDb({
      listSavedCalcs: vi.fn().mockRejectedValue(new Error('pg: relation does not exist')),
    });
    const result = await handleListSavedCalcs({ userId: 1 }, db);
    expect(result.status).toBe(500);
    expect(result.body.error).not.toMatch(/relation/i);
    expect(result.body.error).not.toMatch(/pg:/i);
    expect(result.body.error).toBe('Failed to fetch calculations');
  });
});

// ===========================================================================
// handleSaveCalc
// ===========================================================================

describe('handleSaveCalc — auth requirement', () => {
  it('returns 401 when userId is missing', async () => {
    const db = makeFakeDb();
    const result = await handleSaveCalc(
      { name: 'X', species: 'Salmon', product: 'Fillet', cost: 1, yield: 40, result: '{}' },
      db
    );
    expect(result.status).toBe(401);
  });

  it('returns 401 when userId is null', async () => {
    const db = makeFakeDb();
    const result = await handleSaveCalc({ userId: null }, db);
    expect(result.status).toBe(401);
  });
});

describe('handleSaveCalc — success shape', () => {
  it('returns 201 with id and message on success', async () => {
    const db = makeFakeDb({
      saveCalc: vi.fn().mockResolvedValue({ id: 99 }),
    });
    const result = await handleSaveCalc(
      { userId: 1, name: 'My Calc', species: 'Halibut', product: 'Fillet', cost: 3, yield: 55, result: '{}' },
      db
    );
    expect(result.status).toBe(201);
    expect(result.body.id).toBe(99);
    expect(result.body.message).toBe('Calculation saved successfully');
  });

  it('passes all fields to saveCalc', async () => {
    const db = makeFakeDb({ saveCalc: vi.fn().mockResolvedValue({ id: 1 }) });
    const input = {
      userId: 5,
      name: 'Halibut Fillet',
      species: 'Halibut',
      product: 'Skinless Fillet',
      cost: 4.5,
      yield: 55,
      result: '{"costPerLb":8.18}',
    };
    await handleSaveCalc(input, db);
    const [calledUserId, calledFields] = db.saveCalc.mock.calls[0];
    expect(calledUserId).toBe(5);
    expect(calledFields.name).toBe('Halibut Fillet');
    expect(calledFields.species).toBe('Halibut');
    expect(calledFields.yield).toBe(55);
  });

  it('does not pass a date in the fields — db generates the timestamp', async () => {
    const db = makeFakeDb({ saveCalc: vi.fn().mockResolvedValue({ id: 1 }) });
    await handleSaveCalc(
      { userId: 1, name: 'X', species: 'Cod', product: 'Fillet', cost: 1, yield: 40, result: '{}' },
      db
    );
    const [, calledFields] = db.saveCalc.mock.calls[0];
    expect(calledFields.date).toBeUndefined();
  });
});

describe('handleSaveCalc — sanitized failure', () => {
  it('returns 500 with generic message when db throws', async () => {
    const db = makeFakeDb({
      saveCalc: vi.fn().mockRejectedValue(new Error('SQLITE_CONSTRAINT: NOT NULL')),
    });
    const result = await handleSaveCalc(
      { userId: 1, name: 'X', species: 'Salmon', product: 'Fillet', cost: 2, yield: 42, result: '{}' },
      db
    );
    expect(result.status).toBe(500);
    expect(result.body.error).not.toMatch(/SQLITE/i);
    expect(result.body.error).toBe('Failed to save calculation');
  });
});

// ===========================================================================
// handleDeleteCalc
// ===========================================================================

describe('handleDeleteCalc — auth requirement', () => {
  it('returns 401 when userId is missing', async () => {
    const db = makeFakeDb();
    const result = await handleDeleteCalc({ id: 1 }, db);
    expect(result.status).toBe(401);
  });

  it('returns 401 when userId is null', async () => {
    const db = makeFakeDb();
    const result = await handleDeleteCalc({ userId: null, id: 1 }, db);
    expect(result.status).toBe(401);
  });
});

describe('handleDeleteCalc — validation', () => {
  it('returns 400 when id is missing', async () => {
    const db = makeFakeDb();
    const result = await handleDeleteCalc({ userId: 1 }, db);
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/invalid/i);
  });

  it('returns 400 when id is not a number', async () => {
    const db = makeFakeDb();
    const result = await handleDeleteCalc({ userId: 1, id: 'abc' }, db);
    expect(result.status).toBe(400);
  });

  it('returns 400 when id is 0', async () => {
    const db = makeFakeDb();
    const result = await handleDeleteCalc({ userId: 1, id: 0 }, db);
    expect(result.status).toBe(400);
  });
});

describe('handleDeleteCalc — ownership enforcement', () => {
  it('returns 404 when calc does not exist', async () => {
    const db = makeFakeDb({ findCalcById: vi.fn().mockResolvedValue(null) });
    const result = await handleDeleteCalc({ userId: 1, id: 999 }, db);
    expect(result.status).toBe(404);
    expect(result.body.error).toBe('Calculation not found');
  });

  it('returns 403 when calc belongs to a different user', async () => {
    const db = makeFakeDb({
      findCalcById: vi.fn().mockResolvedValue({ id: 5, user_id: 99 }),
    });
    const result = await handleDeleteCalc({ userId: 1, id: 5 }, db);
    expect(result.status).toBe(403);
    expect(result.body.error).toBe('Forbidden');
  });

  it('does NOT call deleteCalc when ownership check fails', async () => {
    const db = makeFakeDb({
      findCalcById: vi.fn().mockResolvedValue({ id: 5, user_id: 99 }),
    });
    await handleDeleteCalc({ userId: 1, id: 5 }, db);
    expect(db.deleteCalc).not.toHaveBeenCalled();
  });

  it('enforces ownership when user_id is string and userId is number (cross-type)', async () => {
    const db = makeFakeDb({
      findCalcById: vi.fn().mockResolvedValue({ id: 5, user_id: '99' }),
    });
    const result = await handleDeleteCalc({ userId: 1, id: 5 }, db);
    expect(result.status).toBe(403);
  });

  it('allows delete when userId matches (string vs number)', async () => {
    const db = makeFakeDb({
      findCalcById: vi.fn().mockResolvedValue({ id: 5, user_id: '42' }),
      deleteCalc: vi.fn().mockResolvedValue(undefined),
    });
    const result = await handleDeleteCalc({ userId: 42, id: 5 }, db);
    expect(result.status).toBe(200);
  });
});

describe('handleDeleteCalc — success shape', () => {
  it('returns 200 with message on success', async () => {
    const db = makeFakeDb({
      findCalcById: vi.fn().mockResolvedValue({ id: 3, user_id: 10 }),
      deleteCalc: vi.fn().mockResolvedValue(undefined),
    });
    const result = await handleDeleteCalc({ userId: 10, id: 3 }, db);
    expect(result.status).toBe(200);
    expect(result.body.message).toBe('Calculation deleted');
  });

  it('calls deleteCalc with the correct id', async () => {
    const db = makeFakeDb({
      findCalcById: vi.fn().mockResolvedValue({ id: 7, user_id: 5 }),
      deleteCalc: vi.fn().mockResolvedValue(undefined),
    });
    await handleDeleteCalc({ userId: 5, id: 7 }, db);
    expect(db.deleteCalc).toHaveBeenCalledWith(7);
  });
});

describe('handleDeleteCalc — sanitized failure', () => {
  it('returns 500 with generic message when deleteCalc throws', async () => {
    const db = makeFakeDb({
      findCalcById: vi.fn().mockResolvedValue({ id: 1, user_id: 1 }),
      deleteCalc: vi.fn().mockRejectedValue(new Error('deadlock detected: 23P01')),
    });
    const result = await handleDeleteCalc({ userId: 1, id: 1 }, db);
    expect(result.status).toBe(500);
    expect(result.body.error).not.toMatch(/deadlock/i);
    expect(result.body.error).not.toMatch(/23P01/i);
    expect(result.body.error).toBe('Failed to delete calculation');
  });

  it('returns 500 with generic message when findCalcById throws', async () => {
    const db = makeFakeDb({
      findCalcById: vi.fn().mockRejectedValue(new Error('connection lost')),
    });
    const result = await handleDeleteCalc({ userId: 1, id: 1 }, db);
    expect(result.status).toBe(500);
    expect(result.body.error).not.toMatch(/connection/i);
  });
});
