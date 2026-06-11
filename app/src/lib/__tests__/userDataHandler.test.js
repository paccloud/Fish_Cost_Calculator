/**
 * Backend handler core tests — user-data endpoints.
 *
 * Exercises the transport-agnostic handlers (shared/handlers/userData.js)
 * through a faked data layer.  Covers:
 *   - handleListUserData
 *   - handleCreateUserData
 *   - handleUpdateUserData
 *   - handleDeleteUserData
 *
 * Test runner: Vitest (run via `cd app && npm test`)
 */

import { describe, it, expect, vi } from 'vitest';
import {
  handleListUserData,
  handleCreateUserData,
  handleUpdateUserData,
  handleDeleteUserData,
} from '../../../../shared/handlers/userData.js';

// ---------------------------------------------------------------------------
// Fake DbAdapter factory
// ---------------------------------------------------------------------------

/**
 * @param {Partial<import('../../../../../shared/db/interface.js').DbAdapter>} overrides
 */
function makeFakeDb(overrides = {}) {
  return {
    listUserData: vi.fn().mockResolvedValue([]),
    createUserData: vi.fn().mockResolvedValue({ id: 1 }),
    findUserDataById: vi.fn().mockResolvedValue(null),
    updateUserData: vi.fn().mockResolvedValue(undefined),
    deleteUserData: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const SAMPLE_ROW = {
  id: 1,
  user_id: 42,
  species: 'Pink Salmon',
  product: 'Skinless Fillet',
  yield: 42,
  source: 'User Input',
};

// ===========================================================================
// handleListUserData
// ===========================================================================

describe('handleListUserData — auth requirement', () => {
  it('returns 401 when userId is missing', async () => {
    const db = makeFakeDb();
    const result = await handleListUserData({}, db);
    expect(result.status).toBe(401);
    expect(result.body.error).toMatch(/unauthorized/i);
  });

  it('returns 401 when userId is null', async () => {
    const db = makeFakeDb();
    const result = await handleListUserData({ userId: null }, db);
    expect(result.status).toBe(401);
  });
});

describe('handleListUserData — success shape', () => {
  it('returns 200 with an array on success', async () => {
    const db = makeFakeDb({ listUserData: vi.fn().mockResolvedValue([SAMPLE_ROW]) });
    const result = await handleListUserData({ userId: 42 }, db);
    expect(result.status).toBe(200);
    expect(Array.isArray(result.body)).toBe(true);
    expect(result.body).toHaveLength(1);
    expect(result.body[0].id).toBe(1);
  });

  it('returns 200 with empty array when user has no data', async () => {
    const db = makeFakeDb({ listUserData: vi.fn().mockResolvedValue([]) });
    const result = await handleListUserData({ userId: 99 }, db);
    expect(result.status).toBe(200);
    expect(result.body).toEqual([]);
  });

  it('queries by the correct userId', async () => {
    const db = makeFakeDb({ listUserData: vi.fn().mockResolvedValue([]) });
    await handleListUserData({ userId: 7 }, db);
    expect(db.listUserData).toHaveBeenCalledWith(7);
  });
});

describe('handleListUserData — sanitized failure', () => {
  it('returns 500 with generic message when db throws', async () => {
    const db = makeFakeDb({
      listUserData: vi.fn().mockRejectedValue(new Error('pg: relation does not exist')),
    });
    const result = await handleListUserData({ userId: 1 }, db);
    expect(result.status).toBe(500);
    expect(result.body.error).not.toMatch(/pg:|relation/i);
    expect(result.body.error).toBe('Failed to fetch user data');
  });
});

// ===========================================================================
// handleCreateUserData
// ===========================================================================

describe('handleCreateUserData — auth requirement', () => {
  it('returns 401 when userId is missing', async () => {
    const db = makeFakeDb();
    const result = await handleCreateUserData(
      { species: 'Salmon', product: 'Fillet', yield: 42 },
      db
    );
    expect(result.status).toBe(401);
  });

  it('returns 401 when userId is null', async () => {
    const db = makeFakeDb();
    const result = await handleCreateUserData({ userId: null }, db);
    expect(result.status).toBe(401);
  });
});

describe('handleCreateUserData — validation rejections', () => {
  it('returns 400 when species is missing', async () => {
    const db = makeFakeDb();
    const result = await handleCreateUserData({ userId: 1, product: 'Fillet', yield: 42 }, db);
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/required/i);
  });

  it('returns 400 when product is missing', async () => {
    const db = makeFakeDb();
    const result = await handleCreateUserData({ userId: 1, species: 'Salmon', yield: 42 }, db);
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/required/i);
  });

  it('returns 400 when yield is missing', async () => {
    const db = makeFakeDb();
    const result = await handleCreateUserData({ userId: 1, species: 'Salmon', product: 'Fillet' }, db);
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/required/i);
  });

  it('returns 400 when yield is not a number', async () => {
    const db = makeFakeDb();
    const result = await handleCreateUserData(
      { userId: 1, species: 'Salmon', product: 'Fillet', yield: 'abc' },
      db
    );
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/number/i);
  });

  it('returns 400 when species is empty string', async () => {
    const db = makeFakeDb();
    const result = await handleCreateUserData(
      { userId: 1, species: '   ', product: 'Fillet', yield: 42 },
      db
    );
    expect(result.status).toBe(400);
  });
});

describe('handleCreateUserData — success shape', () => {
  it('returns 201 with id and production message on success', async () => {
    const db = makeFakeDb({ createUserData: vi.fn().mockResolvedValue({ id: 7 }) });
    const result = await handleCreateUserData(
      { userId: 1, species: 'Halibut', product: 'Fillet', yield: 55 },
      db
    );
    expect(result.status).toBe(201);
    expect(result.body.id).toBe(7);
    // Production message wins (drift: server said "Added successfully")
    expect(result.body.message).toBe('Data added successfully');
  });

  it('passes trimmed fields to createUserData', async () => {
    const db = makeFakeDb({ createUserData: vi.fn().mockResolvedValue({ id: 1 }) });
    await handleCreateUserData(
      { userId: 3, species: ' Pink Salmon ', product: '  Fillet ', yield: 42, source: 'Lab' },
      db
    );
    const [calledUserId, calledFields] = db.createUserData.mock.calls[0];
    expect(calledUserId).toBe(3);
    expect(calledFields.species).toBe('Pink Salmon');
    expect(calledFields.product).toBe('Fillet');
    expect(calledFields.yield).toBe(42);
    expect(calledFields.source).toBe('Lab');
  });

  it('defaults source to "User Input" when not provided', async () => {
    const db = makeFakeDb({ createUserData: vi.fn().mockResolvedValue({ id: 1 }) });
    await handleCreateUserData(
      { userId: 3, species: 'Cod', product: 'Fillet', yield: 38 },
      db
    );
    const [, calledFields] = db.createUserData.mock.calls[0];
    expect(calledFields.source).toBe('User Input');
  });
});

describe('handleCreateUserData — sanitized failure', () => {
  it('returns 500 with generic message when db throws', async () => {
    const db = makeFakeDb({
      createUserData: vi.fn().mockRejectedValue(new Error('SQLITE_CONSTRAINT: NOT NULL')),
    });
    const result = await handleCreateUserData(
      { userId: 1, species: 'Salmon', product: 'Fillet', yield: 42 },
      db
    );
    expect(result.status).toBe(500);
    expect(result.body.error).not.toMatch(/SQLITE/i);
    expect(result.body.error).toBe('Failed to add data');
  });
});

// ===========================================================================
// handleUpdateUserData
// ===========================================================================

describe('handleUpdateUserData — auth requirement', () => {
  it('returns 401 when userId is missing', async () => {
    const db = makeFakeDb();
    const result = await handleUpdateUserData({ id: 1, species: 'Salmon' }, db);
    expect(result.status).toBe(401);
  });

  it('returns 401 when userId is null', async () => {
    const db = makeFakeDb();
    const result = await handleUpdateUserData({ userId: null, id: 1 }, db);
    expect(result.status).toBe(401);
  });
});

describe('handleUpdateUserData — identifier contract', () => {
  it('returns 400 when id is missing', async () => {
    const db = makeFakeDb();
    const result = await handleUpdateUserData({ userId: 1, species: 'Salmon' }, db);
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/invalid entry id/i);
  });

  it('returns 400 when id is not numeric', async () => {
    const db = makeFakeDb();
    const result = await handleUpdateUserData({ userId: 1, id: 'abc' }, db);
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/invalid entry id/i);
  });
});

describe('handleUpdateUserData — ownership enforcement', () => {
  it('returns 404 when entry does not exist', async () => {
    const db = makeFakeDb({ findUserDataById: vi.fn().mockResolvedValue(null) });
    const result = await handleUpdateUserData({ userId: 1, id: 99 }, db);
    expect(result.status).toBe(404);
    expect(result.body.error).toMatch(/not found/i);
  });

  it('returns 404 when entry belongs to a different user', async () => {
    const db = makeFakeDb({
      findUserDataById: vi.fn().mockResolvedValue({ id: 5, user_id: 99 }),
    });
    const result = await handleUpdateUserData({ userId: 1, id: 5 }, db);
    expect(result.status).toBe(404);
    expect(result.body.error).toMatch(/not found/i);
  });

  it('does NOT call updateUserData when ownership check fails', async () => {
    const db = makeFakeDb({
      findUserDataById: vi.fn().mockResolvedValue({ id: 5, user_id: 99 }),
    });
    await handleUpdateUserData({ userId: 1, id: 5 }, db);
    expect(db.updateUserData).not.toHaveBeenCalled();
  });

  it('enforces ownership when user_id is string and userId is number', async () => {
    const db = makeFakeDb({
      findUserDataById: vi.fn().mockResolvedValue({ id: 5, user_id: '99' }),
    });
    const result = await handleUpdateUserData({ userId: 1, id: 5 }, db);
    expect(result.status).toBe(404);
  });

  it('allows update when userId matches (string vs number)', async () => {
    const db = makeFakeDb({
      findUserDataById: vi.fn().mockResolvedValue({ id: 5, user_id: '42' }),
      updateUserData: vi.fn().mockResolvedValue(undefined),
    });
    const result = await handleUpdateUserData({ userId: 42, id: 5, species: 'Cod' }, db);
    expect(result.status).toBe(200);
  });
});

describe('handleUpdateUserData — success shape', () => {
  it('returns 200 with message on success', async () => {
    const db = makeFakeDb({
      findUserDataById: vi.fn().mockResolvedValue({ id: 3, user_id: 10 }),
      updateUserData: vi.fn().mockResolvedValue(undefined),
    });
    const result = await handleUpdateUserData({ userId: 10, id: 3, species: 'Cod' }, db);
    expect(result.status).toBe(200);
    expect(result.body.message).toBe('Updated successfully');
  });

  it('passes null for fields not in input (COALESCE contract)', async () => {
    const db = makeFakeDb({
      findUserDataById: vi.fn().mockResolvedValue({ id: 3, user_id: 10 }),
      updateUserData: vi.fn().mockResolvedValue(undefined),
    });
    // Only species is provided — other fields must be null so adapter COALESCE keeps current values
    await handleUpdateUserData({ userId: 10, id: 3, species: 'Cod' }, db);
    const [, calledFields] = db.updateUserData.mock.calls[0];
    expect(calledFields.species).toBe('Cod');
    expect(calledFields.product).toBeNull();
    expect(calledFields.yield).toBeNull();
    expect(calledFields.source).toBeNull();
  });
});

describe('handleUpdateUserData — sanitized failure', () => {
  it('returns 500 with generic message when db throws', async () => {
    const db = makeFakeDb({
      findUserDataById: vi.fn().mockResolvedValue({ id: 1, user_id: 1 }),
      updateUserData: vi.fn().mockRejectedValue(new Error('deadlock: 23P01')),
    });
    const result = await handleUpdateUserData({ userId: 1, id: 1, species: 'Cod' }, db);
    expect(result.status).toBe(500);
    expect(result.body.error).not.toMatch(/deadlock/i);
    expect(result.body.error).toBe('Failed to update data');
  });
});

// ===========================================================================
// handleDeleteUserData
// ===========================================================================

describe('handleDeleteUserData — auth requirement', () => {
  it('returns 401 when userId is missing', async () => {
    const db = makeFakeDb();
    const result = await handleDeleteUserData({ id: 1 }, db);
    expect(result.status).toBe(401);
  });

  it('returns 401 when userId is null', async () => {
    const db = makeFakeDb();
    const result = await handleDeleteUserData({ userId: null, id: 1 }, db);
    expect(result.status).toBe(401);
  });
});

describe('handleDeleteUserData — identifier contract', () => {
  it('returns 400 when id is missing', async () => {
    const db = makeFakeDb();
    const result = await handleDeleteUserData({ userId: 1 }, db);
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/invalid entry id/i);
  });

  it('returns 400 when id is not numeric', async () => {
    const db = makeFakeDb();
    const result = await handleDeleteUserData({ userId: 1, id: 'xyz' }, db);
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/invalid entry id/i);
  });
});

describe('handleDeleteUserData — ownership enforcement', () => {
  it('returns 404 when entry does not exist', async () => {
    const db = makeFakeDb({ findUserDataById: vi.fn().mockResolvedValue(null) });
    const result = await handleDeleteUserData({ userId: 1, id: 999 }, db);
    expect(result.status).toBe(404);
    expect(result.body.error).toMatch(/not found/i);
  });

  it('returns 404 when entry belongs to a different user', async () => {
    const db = makeFakeDb({
      findUserDataById: vi.fn().mockResolvedValue({ id: 5, user_id: 99 }),
    });
    const result = await handleDeleteUserData({ userId: 1, id: 5 }, db);
    expect(result.status).toBe(404);
    expect(result.body.error).toMatch(/not found/i);
  });

  it('does NOT call deleteUserData when ownership check fails', async () => {
    const db = makeFakeDb({
      findUserDataById: vi.fn().mockResolvedValue({ id: 5, user_id: 99 }),
    });
    await handleDeleteUserData({ userId: 1, id: 5 }, db);
    expect(db.deleteUserData).not.toHaveBeenCalled();
  });

  it('enforces ownership when user_id is string and userId is number', async () => {
    const db = makeFakeDb({
      findUserDataById: vi.fn().mockResolvedValue({ id: 5, user_id: '99' }),
    });
    const result = await handleDeleteUserData({ userId: 1, id: 5 }, db);
    expect(result.status).toBe(404);
  });

  it('allows delete when userId matches (string vs number)', async () => {
    const db = makeFakeDb({
      findUserDataById: vi.fn().mockResolvedValue({ id: 5, user_id: '42' }),
      deleteUserData: vi.fn().mockResolvedValue(undefined),
    });
    const result = await handleDeleteUserData({ userId: 42, id: 5 }, db);
    expect(result.status).toBe(200);
  });
});

describe('handleDeleteUserData — success shape', () => {
  it('returns 200 with message on success', async () => {
    const db = makeFakeDb({
      findUserDataById: vi.fn().mockResolvedValue({ id: 3, user_id: 10 }),
      deleteUserData: vi.fn().mockResolvedValue(undefined),
    });
    const result = await handleDeleteUserData({ userId: 10, id: 3 }, db);
    expect(result.status).toBe(200);
    expect(result.body.message).toBe('Deleted successfully');
  });

  it('calls deleteUserData with the correct id', async () => {
    const db = makeFakeDb({
      findUserDataById: vi.fn().mockResolvedValue({ id: 7, user_id: 5 }),
      deleteUserData: vi.fn().mockResolvedValue(undefined),
    });
    await handleDeleteUserData({ userId: 5, id: 7 }, db);
    expect(db.deleteUserData).toHaveBeenCalledWith(7);
  });
});

describe('handleDeleteUserData — sanitized failure', () => {
  it('returns 500 with generic message when deleteUserData throws', async () => {
    const db = makeFakeDb({
      findUserDataById: vi.fn().mockResolvedValue({ id: 1, user_id: 1 }),
      deleteUserData: vi.fn().mockRejectedValue(new Error('deadlock detected: 23P01')),
    });
    const result = await handleDeleteUserData({ userId: 1, id: 1 }, db);
    expect(result.status).toBe(500);
    expect(result.body.error).not.toMatch(/deadlock/i);
    expect(result.body.error).not.toMatch(/23P01/i);
    expect(result.body.error).toBe('Failed to delete data');
  });
});
