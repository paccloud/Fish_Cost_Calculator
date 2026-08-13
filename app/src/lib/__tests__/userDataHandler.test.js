/**
 * Backend handler core tests — user-data endpoints.
 *
 * Exercises the transport-agnostic handlers (shared/handlers/userData.js)
 * through a faked data layer. Covers:
 *   - handleListUserData
 *   - handleCreateUserData
 *   - handleUpdateUserData
 *   - handleDeleteUserData
 *   - handleSetUserDataSharing
 *
 * Test runner: Vitest (run via `cd app && npm test`)
 */

import { describe, it, expect, vi } from 'vitest';
import {
  handleListUserData,
  handleCreateUserData,
  handleUpdateUserData,
  handleDeleteUserData,
  handleSetUserDataSharing,
} from '../../../../shared/handlers/userData.js';

// ---------------------------------------------------------------------------
// Fake DbAdapter factory
// ---------------------------------------------------------------------------

const SAMPLE_ENTRY = {
  id: 1,
  species: 'Pink Salmon',
  product: 'Fillet',
  yield: 42,
  source: 'User Input',
  is_shared: false,
  client_id: 'client-uuid-1',
  revision: 1,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

function makeFakeDb(overrides = {}) {
  return {
    listUserData: vi.fn().mockResolvedValue([SAMPLE_ENTRY]),
    createUserDataEntry: vi.fn().mockResolvedValue({
      id: 99,
      revision: 1,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    }),
    findUserDataEntryById: vi.fn().mockResolvedValue(SAMPLE_ENTRY),
    updateUserDataEntry: vi.fn().mockResolvedValue(undefined),
    deleteUserDataEntry: vi.fn().mockResolvedValue(undefined),
    setUserDataSharing: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ===========================================================================
// handleListUserData
// ===========================================================================

describe('handleListUserData', () => {
  it('returns 401 when userId is missing', async () => {
    const db = makeFakeDb();
    const result = await handleListUserData({}, db);
    expect(result.status).toBe(401);
    expect(db.listUserData).not.toHaveBeenCalled();
  });

  it('returns 200 with rows on success', async () => {
    const db = makeFakeDb();
    const result = await handleListUserData({ userId: 1 }, db);
    expect(result.status).toBe(200);
    expect(result.body).toEqual([SAMPLE_ENTRY]);
    expect(db.listUserData).toHaveBeenCalledWith(1);
  });

  it('returns 500 when db throws', async () => {
    const db = makeFakeDb({ listUserData: vi.fn().mockRejectedValue(new Error('db error')) });
    const result = await handleListUserData({ userId: 1 }, db);
    expect(result.status).toBe(500);
    expect(result.body.error).toMatch(/failed to fetch/i);
  });
});

// ===========================================================================
// handleCreateUserData
// ===========================================================================

describe('handleCreateUserData', () => {
  it('returns 401 when userId is missing', async () => {
    const db = makeFakeDb();
    const result = await handleCreateUserData({ species: 'Salmon', product: 'Fillet', yield: 42 }, db);
    expect(result.status).toBe(401);
  });

  it('returns 400 when required fields are missing', async () => {
    const db = makeFakeDb();
    const cases = [
      { userId: 1, product: 'Fillet', yield: 42 },       // no species
      { userId: 1, species: 'Salmon', yield: 42 },        // no product
      { userId: 1, species: 'Salmon', product: 'Fillet' }, // no yield
    ];
    for (const input of cases) {
      const result = await handleCreateUserData(input, db);
      expect(result.status).toBe(400);
      expect(result.body.error).toMatch(/required/i);
    }
    expect(db.createUserDataEntry).not.toHaveBeenCalled();
  });

  it('returns 200 with id, revision, and timestamps on success', async () => {
    const db = makeFakeDb();
    const result = await handleCreateUserData(
      { userId: 1, species: 'Salmon', product: 'Fillet', yield: 42 },
      db
    );
    expect(result.status).toBe(200);
    expect(result.body.id).toBe(99);
    expect(result.body.revision).toBe(1);
    expect(result.body.created_at).toBe('2026-01-01T00:00:00Z');
    expect(result.body.updated_at).toBe('2026-01-01T00:00:00Z');
    expect(db.createUserDataEntry).toHaveBeenCalledWith(1, {
      species: 'Salmon',
      product: 'Fillet',
      yield: 42,
      source: 'User Input',
      clientId: undefined,
    });
  });

  it('passes custom source through', async () => {
    const db = makeFakeDb();
    await handleCreateUserData(
      { userId: 1, species: 'Salmon', product: 'Fillet', yield: 42, source: 'NMFS' },
      db
    );
    expect(db.createUserDataEntry).toHaveBeenCalledWith(1, expect.objectContaining({ source: 'NMFS' }));
  });

  it('returns 500 when db throws', async () => {
    const db = makeFakeDb({ createUserDataEntry: vi.fn().mockRejectedValue(new Error('db error')) });
    const result = await handleCreateUserData(
      { userId: 1, species: 'Salmon', product: 'Fillet', yield: 42 },
      db
    );
    expect(result.status).toBe(500);
    expect(result.body.error).toMatch(/failed to add/i);
  });
});

// ===========================================================================
// handleCreateUserData — clientId idempotency
// ===========================================================================

describe('handleCreateUserData — clientId idempotency', () => {
  it('passes clientId to createUserDataEntry', async () => {
    const db = makeFakeDb();
    await handleCreateUserData(
      { userId: 1, species: 'Salmon', product: 'Fillet', yield: 42, clientId: 'stable-uuid-123' },
      db
    );
    expect(db.createUserDataEntry).toHaveBeenCalledWith(1, expect.objectContaining({ clientId: 'stable-uuid-123' }));
  });

  it('returns same id and revision on idempotent retry', async () => {
    const db = makeFakeDb({
      createUserDataEntry: vi.fn().mockResolvedValue({ id: 99, revision: 1, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }),
    });
    const result = await handleCreateUserData(
      { userId: 1, species: 'Salmon', product: 'Fillet', yield: 42, clientId: 'stable-uuid-123' },
      db
    );
    expect(result.status).toBe(200);
    expect(result.body.id).toBe(99);
    expect(result.body.revision).toBe(1);
  });

  it('strips whitespace-only clientId', async () => {
    const db = makeFakeDb();
    await handleCreateUserData(
      { userId: 1, species: 'Salmon', product: 'Fillet', yield: 42, clientId: '   ' },
      db
    );
    expect(db.createUserDataEntry).toHaveBeenCalledWith(1, expect.objectContaining({ clientId: undefined }));
  });

  it('ignores non-string clientId', async () => {
    const db = makeFakeDb();
    await handleCreateUserData(
      { userId: 1, species: 'Salmon', product: 'Fillet', yield: 42, clientId: 12345 },
      db
    );
    expect(db.createUserDataEntry).toHaveBeenCalledWith(1, expect.objectContaining({ clientId: undefined }));
  });
});

// ===========================================================================
// handleUpdateUserData
// ===========================================================================

describe('handleUpdateUserData', () => {
  it('returns 401 when userId is missing', async () => {
    const db = makeFakeDb();
    const result = await handleUpdateUserData({ id: 1, species: 'Salmon' }, db);
    expect(result.status).toBe(401);
  });

  it('returns 400 when id is missing', async () => {
    const db = makeFakeDb();
    const result = await handleUpdateUserData({ userId: 1, species: 'Salmon' }, db);
    expect(result.status).toBe(400);
  });

  it('returns 404 when entry not found or not owned', async () => {
    const db = makeFakeDb({ findUserDataEntryById: vi.fn().mockResolvedValue(null) });
    const result = await handleUpdateUserData({ userId: 1, id: 99, species: 'Tuna' }, db);
    expect(result.status).toBe(404);
    expect(result.body.error).toMatch(/not found/i);
  });

  it('returns 200 on success and calls updateUserDataEntry', async () => {
    const db = makeFakeDb();
    const result = await handleUpdateUserData({ userId: 1, id: 1, species: 'Tuna' }, db);
    expect(result.status).toBe(200);
    expect(db.updateUserDataEntry).toHaveBeenCalledWith(1, 1, { species: 'Tuna', product: undefined, yield: undefined, source: undefined });
  });

  it('returns 500 when db throws', async () => {
    const db = makeFakeDb({ updateUserDataEntry: vi.fn().mockRejectedValue(new Error('db')) });
    const result = await handleUpdateUserData({ userId: 1, id: 1, species: 'Tuna' }, db);
    expect(result.status).toBe(500);
    expect(result.body.error).toMatch(/failed to update/i);
  });
});

// ===========================================================================
// handleUpdateUserData — revision guard
// ===========================================================================

describe('handleUpdateUserData — revision guard', () => {
  it('returns 409 when expectedRevision does not match the current revision', async () => {
    const db = makeFakeDb({
      findUserDataEntryById: vi.fn().mockResolvedValue({ ...SAMPLE_ENTRY, revision: 5 }),
    });
    const result = await handleUpdateUserData(
      { userId: 1, id: 1, species: 'Tuna', expectedRevision: 3 },
      db
    );
    expect(result.status).toBe(409);
    expect(result.body.error).toMatch(/conflict/i);
    expect(db.updateUserDataEntry).not.toHaveBeenCalled();
  });

  it('proceeds when expectedRevision matches', async () => {
    const db = makeFakeDb({
      findUserDataEntryById: vi.fn().mockResolvedValue({ ...SAMPLE_ENTRY, revision: 5 }),
    });
    const result = await handleUpdateUserData(
      { userId: 1, id: 1, species: 'Tuna', expectedRevision: 5 },
      db
    );
    expect(result.status).toBe(200);
    expect(db.updateUserDataEntry).toHaveBeenCalledTimes(1);
  });

  it('skips revision check when expectedRevision is not provided', async () => {
    const db = makeFakeDb({
      findUserDataEntryById: vi.fn().mockResolvedValue({ ...SAMPLE_ENTRY, revision: 99 }),
    });
    const result = await handleUpdateUserData(
      { userId: 1, id: 1, species: 'Tuna' },
      db
    );
    expect(result.status).toBe(200);
  });
});

// ===========================================================================
// handleDeleteUserData
// ===========================================================================

describe('handleDeleteUserData', () => {
  it('returns 401 when userId is missing', async () => {
    const db = makeFakeDb();
    const result = await handleDeleteUserData({ id: 1 }, db);
    expect(result.status).toBe(401);
  });

  it('returns 400 when id is missing', async () => {
    const db = makeFakeDb();
    const result = await handleDeleteUserData({ userId: 1 }, db);
    expect(result.status).toBe(400);
  });

  it('returns 404 when entry not found or not owned', async () => {
    const db = makeFakeDb({ findUserDataEntryById: vi.fn().mockResolvedValue(null) });
    const result = await handleDeleteUserData({ userId: 1, id: 99 }, db);
    expect(result.status).toBe(404);
    expect(result.body.error).toMatch(/not found/i);
  });

  it('returns 200 on success', async () => {
    const db = makeFakeDb();
    const result = await handleDeleteUserData({ userId: 1, id: 1 }, db);
    expect(result.status).toBe(200);
    expect(db.deleteUserDataEntry).toHaveBeenCalledWith(1, 1);
  });

  it('returns 500 when db throws', async () => {
    const db = makeFakeDb({ deleteUserDataEntry: vi.fn().mockRejectedValue(new Error('db')) });
    const result = await handleDeleteUserData({ userId: 1, id: 1 }, db);
    expect(result.status).toBe(500);
    expect(result.body.error).toMatch(/failed to delete/i);
  });
});

// ===========================================================================
// handleDeleteUserData — revision guard (stale-delete)
// ===========================================================================

describe('handleDeleteUserData — revision guard', () => {
  it('returns 409 when expectedRevision does not match the current revision', async () => {
    const db = makeFakeDb({
      findUserDataEntryById: vi.fn().mockResolvedValue({ ...SAMPLE_ENTRY, revision: 3 }),
    });
    const result = await handleDeleteUserData(
      { userId: 1, id: 1, expectedRevision: 1 },
      db
    );
    expect(result.status).toBe(409);
    expect(result.body.error).toMatch(/conflict/i);
    expect(db.deleteUserDataEntry).not.toHaveBeenCalled();
  });

  it('proceeds when expectedRevision matches', async () => {
    const db = makeFakeDb({
      findUserDataEntryById: vi.fn().mockResolvedValue({ ...SAMPLE_ENTRY, revision: 3 }),
    });
    const result = await handleDeleteUserData(
      { userId: 1, id: 1, expectedRevision: 3 },
      db
    );
    expect(result.status).toBe(200);
    expect(db.deleteUserDataEntry).toHaveBeenCalledWith(1, 1);
  });

  it('skips revision check when expectedRevision is not provided', async () => {
    const db = makeFakeDb({
      findUserDataEntryById: vi.fn().mockResolvedValue({ ...SAMPLE_ENTRY, revision: 99 }),
    });
    const result = await handleDeleteUserData({ userId: 1, id: 1 }, db);
    expect(result.status).toBe(200);
    expect(db.deleteUserDataEntry).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// Ownership isolation
// ===========================================================================

describe('ownership isolation', () => {
  it('does not let user 2 update user 1 entry', async () => {
    const db = makeFakeDb({
      findUserDataEntryById: vi.fn().mockResolvedValue(null),
    });
    const result = await handleUpdateUserData(
      { userId: 2, id: 1, species: 'Tuna' },
      db
    );
    expect(result.status).toBe(404);
    expect(db.updateUserDataEntry).not.toHaveBeenCalled();
  });

  it('does not let user 2 delete user 1 entry', async () => {
    const db = makeFakeDb({
      findUserDataEntryById: vi.fn().mockResolvedValue(null),
    });
    const result = await handleDeleteUserData({ userId: 2, id: 1 }, db);
    expect(result.status).toBe(404);
    expect(db.deleteUserDataEntry).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Revision advancement
// ===========================================================================

describe('revision advancement', () => {
  it('calls updateUserDataEntry after confirming ownership', async () => {
    const db = makeFakeDb({
      findUserDataEntryById: vi.fn().mockResolvedValue({ ...SAMPLE_ENTRY, revision: 2 }),
    });
    const result = await handleUpdateUserData(
      { userId: 1, id: 1, species: 'Coho Salmon', expectedRevision: 2 },
      db
    );
    expect(result.status).toBe(200);
    expect(db.updateUserDataEntry).toHaveBeenCalledWith(
      1, 1,
      { species: 'Coho Salmon', product: undefined, yield: undefined, source: undefined }
    );
  });

  it('rejects stale update when entry has been revised by another session', async () => {
    const db = makeFakeDb({
      findUserDataEntryById: vi.fn().mockResolvedValue({ ...SAMPLE_ENTRY, revision: 5 }),
    });
    const result = await handleUpdateUserData(
      { userId: 1, id: 1, species: 'Coho Salmon', expectedRevision: 2 },
      db
    );
    expect(result.status).toBe(409);
    expect(db.updateUserDataEntry).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// handleSetUserDataSharing
// ===========================================================================

describe('handleSetUserDataSharing', () => {
  it('returns 401 when userId is missing', async () => {
    const db = makeFakeDb();
    const result = await handleSetUserDataSharing({ id: 1, isShared: true }, db);
    expect(result.status).toBe(401);
  });

  it('returns 400 when id is missing', async () => {
    const db = makeFakeDb();
    const result = await handleSetUserDataSharing({ userId: 1, isShared: true }, db);
    expect(result.status).toBe(400);
  });

  it('returns 400 when isShared is not a boolean', async () => {
    const db = makeFakeDb();
    const cases = [
      { userId: 1, id: 1, isShared: 'yes' },
      { userId: 1, id: 1, isShared: 1 },
      { userId: 1, id: 1, isShared: undefined },
    ];
    for (const input of cases) {
      const result = await handleSetUserDataSharing(input, db);
      expect(result.status).toBe(400);
      expect(result.body.error).toMatch(/isShared.*boolean/i);
    }
  });

  it('returns 404 when entry not found or not owned', async () => {
    const db = makeFakeDb({ findUserDataEntryById: vi.fn().mockResolvedValue(null) });
    const result = await handleSetUserDataSharing({ userId: 1, id: 99, isShared: true }, db);
    expect(result.status).toBe(404);
  });

  it('returns 200 with share message when isShared=true', async () => {
    const db = makeFakeDb();
    const result = await handleSetUserDataSharing({ userId: 1, id: 1, isShared: true }, db);
    expect(result.status).toBe(200);
    expect(result.body.message).toMatch(/shared with community/i);
    expect(db.setUserDataSharing).toHaveBeenCalledWith(1, 1, true);
  });

  it('returns 200 with unshare message when isShared=false', async () => {
    const db = makeFakeDb();
    const result = await handleSetUserDataSharing({ userId: 1, id: 1, isShared: false }, db);
    expect(result.status).toBe(200);
    expect(result.body.message).toMatch(/removed from community/i);
    expect(db.setUserDataSharing).toHaveBeenCalledWith(1, 1, false);
  });

  it('returns 500 when db throws', async () => {
    const db = makeFakeDb({ setUserDataSharing: vi.fn().mockRejectedValue(new Error('db')) });
    const result = await handleSetUserDataSharing({ userId: 1, id: 1, isShared: true }, db);
    expect(result.status).toBe(500);
    expect(result.body.error).toMatch(/failed to update sharing/i);
  });
});
