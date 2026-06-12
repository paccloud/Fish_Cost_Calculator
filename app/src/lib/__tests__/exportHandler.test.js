/**
 * Backend handler core tests — export endpoint.
 *
 * Exercises the transport-agnostic handler (shared/handlers/export.js)
 * through a faked data layer.  Covers:
 *   - handleExport (type=calcs and type=data)
 *   - sanitizeCsvValue CSV injection guard
 *
 * Test runner: Vitest (run via `cd app && npm test`)
 */

import { describe, it, expect, vi } from 'vitest';
import { handleExport, sanitizeCsvValue } from '../../../../shared/handlers/export.js';

// ---------------------------------------------------------------------------
// Fake DbAdapter factory
// ---------------------------------------------------------------------------

function makeFakeDb(overrides = {}) {
  return {
    listCalcsForExport: vi.fn().mockResolvedValue([]),
    listUserDataForExport: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

const SAMPLE_CALC = {
  id: 1,
  user_id: 42,
  species: 'Pink Salmon',
  product: 'Skinless Fillet',
  cost: 2.5,
  yield: 42,
  result: '{"costPerLb":5.95}',
  date: '2026-06-11T00:00:00.000Z',
};

const SAMPLE_USER_DATA = {
  id: 1,
  user_id: 42,
  species: 'Pink Salmon',
  product: 'Skinless Fillet',
  yield: 42,
  source: 'User Input',
};

// ===========================================================================
// handleExport — auth requirement
// ===========================================================================

describe('handleExport — auth requirement', () => {
  it('returns 401 when userId is missing', async () => {
    const db = makeFakeDb();
    const result = await handleExport({}, db);
    expect(result.status).toBe(401);
    expect(result.body.error).toMatch(/unauthorized/i);
  });

  it('returns 401 when userId is null', async () => {
    const db = makeFakeDb();
    const result = await handleExport({ userId: null }, db);
    expect(result.status).toBe(401);
  });
});

// ===========================================================================
// handleExport — type param validation
// ===========================================================================

describe('handleExport — type param', () => {
  it('returns 400 for an unknown type', async () => {
    const db = makeFakeDb();
    const result = await handleExport({ userId: 1, exportType: 'invoices' }, db);
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/invalid export type/i);
  });

  it('defaults to calcs when exportType is omitted', async () => {
    const db = makeFakeDb({ listCalcsForExport: vi.fn().mockResolvedValue([]) });
    const result = await handleExport({ userId: 1 }, db);
    expect(result.status).toBe(200);
    expect(db.listCalcsForExport).toHaveBeenCalled();
  });
});

// ===========================================================================
// handleExport — type=calcs
// ===========================================================================

describe('handleExport — type=calcs success shape', () => {
  it('returns 200 with CSV content-type and filename', async () => {
    const db = makeFakeDb({ listCalcsForExport: vi.fn().mockResolvedValue([SAMPLE_CALC]) });
    const result = await handleExport({ userId: 42, exportType: 'calcs' }, db);
    expect(result.status).toBe(200);
    expect(result.contentType).toBe('text/csv');
    expect(result.filename).toBe('calculations.csv');
  });

  it('CSV starts with the correct header row', async () => {
    const db = makeFakeDb({ listCalcsForExport: vi.fn().mockResolvedValue([]) });
    const result = await handleExport({ userId: 1, exportType: 'calcs' }, db);
    expect(typeof result.body).toBe('string');
    expect(result.body).toMatch(/^Date,Species,Conversion,Cost,Yield \(%\),Result\n/);
  });

  it('CSV contains one data row per calculation', async () => {
    const db = makeFakeDb({
      listCalcsForExport: vi.fn().mockResolvedValue([SAMPLE_CALC, SAMPLE_CALC]),
    });
    const result = await handleExport({ userId: 42, exportType: 'calcs' }, db);
    // header + 2 data rows
    const lines = result.body.split('\n');
    expect(lines.length).toBe(3); // header + 2 rows (no trailing newline)
  });

  it('queries by the correct userId', async () => {
    const db = makeFakeDb({ listCalcsForExport: vi.fn().mockResolvedValue([]) });
    await handleExport({ userId: 7, exportType: 'calcs' }, db);
    expect(db.listCalcsForExport).toHaveBeenCalledWith(7);
  });
});

// ===========================================================================
// handleExport — type=data
// ===========================================================================

describe('handleExport — type=data success shape', () => {
  it('returns 200 with CSV content-type and filename', async () => {
    const db = makeFakeDb({ listUserDataForExport: vi.fn().mockResolvedValue([SAMPLE_USER_DATA]) });
    const result = await handleExport({ userId: 42, exportType: 'data' }, db);
    expect(result.status).toBe(200);
    expect(result.contentType).toBe('text/csv');
    expect(result.filename).toBe('user_data.csv');
  });

  it('CSV starts with the correct header row', async () => {
    const db = makeFakeDb({ listUserDataForExport: vi.fn().mockResolvedValue([]) });
    const result = await handleExport({ userId: 1, exportType: 'data' }, db);
    expect(typeof result.body).toBe('string');
    expect(result.body).toMatch(/^Species,Product,Yield \(%\),Source\n/);
  });

  it('CSV contains one data row per user-data entry', async () => {
    const db = makeFakeDb({
      listUserDataForExport: vi.fn().mockResolvedValue([SAMPLE_USER_DATA, SAMPLE_USER_DATA]),
    });
    const result = await handleExport({ userId: 42, exportType: 'data' }, db);
    const lines = result.body.split('\n');
    expect(lines.length).toBe(3); // header + 2 rows
  });

  it('queries by the correct userId', async () => {
    const db = makeFakeDb({ listUserDataForExport: vi.fn().mockResolvedValue([]) });
    await handleExport({ userId: 9, exportType: 'data' }, db);
    expect(db.listUserDataForExport).toHaveBeenCalledWith(9);
  });
});

// ===========================================================================
// handleExport — sanitized failure
// ===========================================================================

describe('handleExport — sanitized failure', () => {
  it('returns 500 with generic message when db throws on calcs', async () => {
    const db = makeFakeDb({
      listCalcsForExport: vi.fn().mockRejectedValue(new Error('pg: relation "calculations" does not exist')),
    });
    const result = await handleExport({ userId: 1, exportType: 'calcs' }, db);
    expect(result.status).toBe(500);
    expect(result.body.error).not.toMatch(/pg:|relation/i);
    expect(result.body.error).toBe('Failed to export data');
  });

  it('returns 500 with generic message when db throws on data', async () => {
    const db = makeFakeDb({
      listUserDataForExport: vi.fn().mockRejectedValue(new Error('SQLITE_ERROR: no such table')),
    });
    const result = await handleExport({ userId: 1, exportType: 'data' }, db);
    expect(result.status).toBe(500);
    expect(result.body.error).not.toMatch(/SQLITE/i);
    expect(result.body.error).toBe('Failed to export data');
  });
});

// ===========================================================================
// sanitizeCsvValue — CSV injection guard
// ===========================================================================

describe('sanitizeCsvValue — CSV injection prevention', () => {
  it('passes through plain values unchanged', () => {
    expect(sanitizeCsvValue('Pink Salmon')).toBe('Pink Salmon');
    expect(sanitizeCsvValue(42)).toBe('42');
    expect(sanitizeCsvValue(null)).toBe('');
    expect(sanitizeCsvValue(undefined)).toBe('');
  });

  it('doubles internal double-quotes', () => {
    expect(sanitizeCsvValue('say "hello"')).toBe('say ""hello""');
  });

  it('prepends single-quote to formula-starting values', () => {
    expect(sanitizeCsvValue('=SUM(A1:A10)')).toBe("'=SUM(A1:A10)");
    expect(sanitizeCsvValue('+CMD')).toBe("'+CMD");
    expect(sanitizeCsvValue('-1')).toBe("'-1");
    expect(sanitizeCsvValue('@user')).toBe("'@user");
  });

  it('does not alter values that start with whitespace then a formula prefix', () => {
    // Leading space means trimStart() sees the formula prefix
    expect(sanitizeCsvValue(' =formula')).toBe("' =formula");
  });
});
