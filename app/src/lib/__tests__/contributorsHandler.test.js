/**
 * Backend handler core tests — contributors endpoints.
 *
 * Exercises the transport-agnostic handlers (shared/handlers/contributors.js)
 * through a faked data layer.  Covers:
 *   - handleListContributors: response shape, empty list, sanitized error
 *   - handleGetContributor: auth check, found/not-found, sanitized error
 *   - handleSaveContributor: auth check, insert path, update path,
 *     show_on_page normalisation, sanitized error
 *
 * Test runner: Vitest (run via `cd app && npm test`)
 */

import { describe, it, expect, vi } from 'vitest';
import {
  handleListContributors,
  handleGetContributor,
  handleSaveContributor,
} from '../../../../shared/handlers/contributors.js';

// ---------------------------------------------------------------------------
// Fake DbAdapter factory
// ---------------------------------------------------------------------------

function makeFakeDb(overrides = {}) {
  return {
    listContributors: vi.fn().mockResolvedValue([]),
    getContributorProfile: vi.fn().mockResolvedValue(null),
    saveContributorProfile: vi.fn().mockResolvedValue({ id: 1, created: true }),
    ...overrides,
  };
}

const SAMPLE_CONTRIBUTOR = {
  id: 1,
  user_id: 42,
  username: 'angler42',
  display_name: 'Angler McGee',
  organization: 'Pacific Seafoods',
  bio: 'Fish enthusiast.',
  show_on_page: true,
  contribution_count: 5,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-06-01T00:00:00.000Z',
};

// ===========================================================================
// handleListContributors — public, no auth
// ===========================================================================

describe('handleListContributors — success shape', () => {
  it('returns 200 with an array on success', async () => {
    const db = makeFakeDb({ listContributors: vi.fn().mockResolvedValue([SAMPLE_CONTRIBUTOR]) });
    const result = await handleListContributors({}, db);
    expect(result.status).toBe(200);
    expect(Array.isArray(result.body)).toBe(true);
  });

  it('returns the rows from db.listContributors', async () => {
    const db = makeFakeDb({ listContributors: vi.fn().mockResolvedValue([SAMPLE_CONTRIBUTOR]) });
    const result = await handleListContributors({}, db);
    expect(result.body).toHaveLength(1);
    expect(result.body[0].username).toBe('angler42');
  });

  it('returns an empty array when there are no visible contributors', async () => {
    const db = makeFakeDb({ listContributors: vi.fn().mockResolvedValue([]) });
    const result = await handleListContributors({}, db);
    expect(result.status).toBe(200);
    expect(result.body).toEqual([]);
  });

  it('works with no input argument', async () => {
    const db = makeFakeDb();
    const result = await handleListContributors(undefined, db);
    expect(result.status).toBe(200);
    expect(db.listContributors).toHaveBeenCalled();
  });
});

describe('handleListContributors — sanitized failure', () => {
  it('returns 500 with a generic message when db throws', async () => {
    const db = makeFakeDb({
      listContributors: vi.fn().mockRejectedValue(new Error('pg: relation "contributors" does not exist')),
    });
    const result = await handleListContributors({}, db);
    expect(result.status).toBe(500);
    expect(result.body.error).not.toMatch(/pg:|relation/i);
    expect(result.body.error).toBe('Failed to fetch contributors');
  });
});

// ===========================================================================
// handleGetContributor — authenticated
// ===========================================================================

describe('handleGetContributor — auth requirement', () => {
  it('returns 401 when userId is missing', async () => {
    const db = makeFakeDb();
    const result = await handleGetContributor({}, db);
    expect(result.status).toBe(401);
    expect(result.body.error).toMatch(/unauthorized/i);
  });

  it('returns 401 when userId is null', async () => {
    const db = makeFakeDb();
    const result = await handleGetContributor({ userId: null }, db);
    expect(result.status).toBe(401);
  });
});

describe('handleGetContributor — profile found', () => {
  it('returns 200 with the profile row', async () => {
    const profile = { id: 1, user_id: 42, display_name: 'Angler McGee' };
    const db = makeFakeDb({ getContributorProfile: vi.fn().mockResolvedValue(profile) });
    const result = await handleGetContributor({ userId: 42 }, db);
    expect(result.status).toBe(200);
    expect(result.body).toEqual(profile);
  });

  it('queries by the correct userId', async () => {
    const db = makeFakeDb({ getContributorProfile: vi.fn().mockResolvedValue(SAMPLE_CONTRIBUTOR) });
    await handleGetContributor({ userId: 99 }, db);
    expect(db.getContributorProfile).toHaveBeenCalledWith(99);
  });
});

describe('handleGetContributor — profile not found', () => {
  it('returns 404 when profile does not exist', async () => {
    const db = makeFakeDb({ getContributorProfile: vi.fn().mockResolvedValue(null) });
    const result = await handleGetContributor({ userId: 42 }, db);
    expect(result.status).toBe(404);
    expect(result.body.error).toMatch(/not found/i);
  });
});

describe('handleGetContributor — sanitized failure', () => {
  it('returns 500 with a generic message when db throws', async () => {
    const db = makeFakeDb({
      getContributorProfile: vi.fn().mockRejectedValue(new Error('SQLITE_ERROR: no such table')),
    });
    const result = await handleGetContributor({ userId: 1 }, db);
    expect(result.status).toBe(500);
    expect(result.body.error).not.toMatch(/SQLITE/i);
    expect(result.body.error).toBe('Failed to fetch profile');
  });
});

// ===========================================================================
// handleSaveContributor — authenticated
// ===========================================================================

describe('handleSaveContributor — auth requirement', () => {
  it('returns 401 when userId is missing', async () => {
    const db = makeFakeDb();
    const result = await handleSaveContributor({}, db);
    expect(result.status).toBe(401);
    expect(result.body.error).toMatch(/unauthorized/i);
  });

  it('returns 401 when userId is null', async () => {
    const db = makeFakeDb();
    const result = await handleSaveContributor({ userId: null }, db);
    expect(result.status).toBe(401);
  });
});

describe('handleSaveContributor — insert path', () => {
  it('returns 201 with id and message when profile is created', async () => {
    const db = makeFakeDb({ saveContributorProfile: vi.fn().mockResolvedValue({ id: 7, created: true }) });
    const result = await handleSaveContributor({
      userId: 42,
      display_name: 'Angler McGee',
      organization: 'Pacific Seafoods',
      bio: 'Fish fan.',
      show_on_page: true,
    }, db);
    expect(result.status).toBe(201);
    expect(result.body.id).toBe(7);
    expect(result.body.message).toMatch(/created/i);
  });
});

describe('handleSaveContributor — update path', () => {
  it('returns 200 with message when profile is updated', async () => {
    const db = makeFakeDb({ saveContributorProfile: vi.fn().mockResolvedValue({ id: 7, created: false }) });
    const result = await handleSaveContributor({
      userId: 42,
      display_name: 'Updated Name',
      show_on_page: false,
    }, db);
    expect(result.status).toBe(200);
    expect(result.body.message).toMatch(/updated/i);
  });
});

describe('handleSaveContributor — show_on_page normalisation', () => {
  it('normalises string "true" to boolean true', async () => {
    const db = makeFakeDb({ saveContributorProfile: vi.fn().mockResolvedValue({ id: 1, created: true }) });
    await handleSaveContributor({ userId: 1, show_on_page: 'true' }, db);
    const [, fields] = db.saveContributorProfile.mock.calls[0];
    expect(fields.show_on_page).toBe(true);
  });

  it('normalises numeric 1 to boolean true', async () => {
    const db = makeFakeDb({ saveContributorProfile: vi.fn().mockResolvedValue({ id: 1, created: true }) });
    await handleSaveContributor({ userId: 1, show_on_page: 1 }, db);
    const [, fields] = db.saveContributorProfile.mock.calls[0];
    expect(fields.show_on_page).toBe(true);
  });

  it('normalises falsy values to boolean false', async () => {
    const db = makeFakeDb({ saveContributorProfile: vi.fn().mockResolvedValue({ id: 1, created: false }) });
    await handleSaveContributor({ userId: 1, show_on_page: false }, db);
    const [, fields] = db.saveContributorProfile.mock.calls[0];
    expect(fields.show_on_page).toBe(false);
  });
});

describe('handleSaveContributor — sanitized failure', () => {
  it('returns 500 with a generic message when db throws', async () => {
    const db = makeFakeDb({
      saveContributorProfile: vi.fn().mockRejectedValue(new Error('pg: column "bio" does not exist')),
    });
    const result = await handleSaveContributor({ userId: 1, display_name: 'Test' }, db);
    expect(result.status).toBe(500);
    expect(result.body.error).not.toMatch(/pg:|column/i);
    expect(result.body.error).toBe('Failed to save profile');
  });
});
