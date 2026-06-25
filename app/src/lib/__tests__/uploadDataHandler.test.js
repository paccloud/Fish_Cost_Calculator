/**
 * Backend handler core tests — upload-data endpoint.
 *
 * Exercises the transport-agnostic handler (shared/handlers/uploadData.js)
 * through a faked data layer.  Covers:
 *   - handleUploadData
 *
 * File parsing stays adapter-side; this handler receives pre-normalised rows.
 *
 * Test runner: Vitest (run via `cd app && npm test`)
 */

import { describe, it, expect, vi } from 'vitest';
import { handleUploadData } from '../../../../shared/handlers/uploadData.js';

// ---------------------------------------------------------------------------
// Fake DbAdapter factory
// ---------------------------------------------------------------------------

function makeFakeDb(overrides = {}) {
  return {
    upsertUserDataRow: vi.fn().mockResolvedValue({ inserted: true }),
    ...overrides,
  };
}

const SAMPLE_ROWS = [
  { species: 'Pink Salmon', product: 'Skinless Fillet', yield: 42, source: 'Uploaded File' },
  { species: 'Halibut', product: 'D/H-On', yield: 70, source: 'Uploaded File' },
];

// ===========================================================================
// handleUploadData — auth requirement
// ===========================================================================

describe('handleUploadData — auth requirement', () => {
  it('returns 401 when userId is missing', async () => {
    const db = makeFakeDb();
    const result = await handleUploadData({ rows: SAMPLE_ROWS }, db);
    expect(result.status).toBe(401);
    expect(result.body.error).toMatch(/unauthorized/i);
  });

  it('returns 401 when userId is null', async () => {
    const db = makeFakeDb();
    const result = await handleUploadData({ userId: null, rows: SAMPLE_ROWS }, db);
    expect(result.status).toBe(401);
  });
});

// ===========================================================================
// handleUploadData — validation rejections
// ===========================================================================

describe('handleUploadData — validation rejections', () => {
  it('returns 400 when rows is not an array', async () => {
    const db = makeFakeDb();
    const result = await handleUploadData({ userId: 1, rows: null }, db);
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/invalid rows/i);
  });

  it('returns 400 when rows is a string', async () => {
    const db = makeFakeDb();
    const result = await handleUploadData({ userId: 1, rows: 'bad' }, db);
    expect(result.status).toBe(400);
  });
});

// ===========================================================================
// handleUploadData — success shape
// ===========================================================================

describe('handleUploadData — success shape', () => {
  it('returns 200 with inserted/updated/skipped counts', async () => {
    const db = makeFakeDb({
      upsertUserDataRow: vi.fn()
        .mockResolvedValueOnce({ inserted: true })
        .mockResolvedValueOnce({ inserted: false }),
    });
    const result = await handleUploadData({ userId: 1, rows: SAMPLE_ROWS }, db);
    expect(result.status).toBe(200);
    expect(result.body.inserted).toBe(1);
    expect(result.body.updated).toBe(1);
    expect(result.body.skipped).toBe(0);
  });

  it('includes skippedRows from input in the response', async () => {
    const db = makeFakeDb();
    const result = await handleUploadData({
      userId: 1,
      rows: SAMPLE_ROWS,
      skippedRows: [3, 7],
    }, db);
    expect(result.status).toBe(200);
    expect(result.body.skipped).toBe(2);
    expect(result.body.skippedRows).toEqual([3, 7]);
  });

  it('builds a human-readable message from counts', async () => {
    const db = makeFakeDb({
      upsertUserDataRow: vi.fn()
        .mockResolvedValueOnce({ inserted: true })
        .mockResolvedValueOnce({ inserted: false }),
    });
    const result = await handleUploadData({
      userId: 1,
      rows: SAMPLE_ROWS,
      skippedRows: [5],
    }, db);
    expect(result.body.message).toBe('1 added, 1 updated, 1 skipped');
  });

  it('returns "No valid records found" when rows is empty', async () => {
    const db = makeFakeDb();
    const result = await handleUploadData({ userId: 1, rows: [], skippedRows: [] }, db);
    expect(result.status).toBe(200);
    expect(result.body.message).toBe('No valid records found');
    expect(result.body.inserted).toBe(0);
    expect(result.body.updated).toBe(0);
  });

  it('processes all rows sequentially (not in parallel) — upsert called once per row', async () => {
    const upsert = vi.fn().mockResolvedValue({ inserted: true });
    const db = makeFakeDb({ upsertUserDataRow: upsert });
    await handleUploadData({ userId: 5, rows: SAMPLE_ROWS }, db);
    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it('passes userId and row fields to upsertUserDataRow', async () => {
    const upsert = vi.fn().mockResolvedValue({ inserted: true });
    const db = makeFakeDb({ upsertUserDataRow: upsert });
    await handleUploadData({ userId: 7, rows: [SAMPLE_ROWS[0]] }, db);
    expect(upsert).toHaveBeenCalledWith(7, {
      species: 'Pink Salmon',
      product: 'Skinless Fillet',
      yield: 42,
      source: 'Uploaded File',
    });
  });
});

// ===========================================================================
// handleUploadData — sanitized failure
// ===========================================================================

describe('handleUploadData — sanitized failure', () => {
  // Per-row upsert failures are now isolated (AC3): they count as skipped
  // rows and the request still returns 200.  The old whole-batch-failure
  // behaviour caused silent partial imports — that bug is fixed.
  it('returns 200 and counts failed upsert rows as skipped (not a 500)', async () => {
    const db = makeFakeDb({
      upsertUserDataRow: vi.fn().mockRejectedValue(new Error('deadlock: 23P01')),
    });
    const result = await handleUploadData({ userId: 1, rows: SAMPLE_ROWS }, db);
    expect(result.status).toBe(200);
    // deadlock message must not leak to the client
    expect(JSON.stringify(result.body)).not.toMatch(/deadlock/i);
    expect(result.body.skipped).toBe(SAMPLE_ROWS.length);
  });

  it('returns 200 and counts per-row validation errors as skipped (not a 400)', async () => {
    const db = makeFakeDb({
      upsertUserDataRow: vi.fn().mockRejectedValue(new Error('Unsupported file type')),
    });
    const result = await handleUploadData({ userId: 1, rows: SAMPLE_ROWS }, db);
    expect(result.status).toBe(200);
    expect(result.body.skipped).toBe(SAMPLE_ROWS.length);
  });
});

// ===========================================================================
// handleUploadData — row cap (AC3)
// ===========================================================================

describe('handleUploadData — row cap', () => {
  it('returns 400 when rows array exceeds MAX_IMPORT_ROWS', async () => {
    const db = makeFakeDb();
    const bigRows = Array.from({ length: 501 }, (_, i) => ({
      species: `Species ${i}`,
      product: 'General',
      yield: 50,
      source: 'Uploaded File',
    }));
    const result = await handleUploadData({ userId: 1, rows: bigRows }, db);
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/too many rows/i);
  });

  it('accepts exactly MAX_IMPORT_ROWS rows without error', async () => {
    const db = makeFakeDb();
    const maxRows = Array.from({ length: 500 }, (_, i) => ({
      species: `Species ${i}`,
      product: 'General',
      yield: 50,
      source: 'Uploaded File',
    }));
    const result = await handleUploadData({ userId: 1, rows: maxRows }, db);
    expect(result.status).toBe(200);
  });
});

// ===========================================================================
// handleUploadData — per-row field validation (AC2 / AC3)
// ===========================================================================

describe('handleUploadData — per-row field validation', () => {
  it('skips a row with missing species and reports it', async () => {
    const db = makeFakeDb();
    const rows = [
      { species: '', product: 'General', yield: 50, source: 'Uploaded File' },
      SAMPLE_ROWS[0],
    ];
    const result = await handleUploadData({ userId: 1, rows }, db);
    expect(result.status).toBe(200);
    expect(result.body.inserted).toBe(1);
    // the invalid row increments skipped count
    expect(result.body.skipped).toBeGreaterThanOrEqual(1);
  });

  it('skips a row with non-numeric yield and reports it', async () => {
    const db = makeFakeDb();
    const rows = [
      { species: 'Tuna', product: 'General', yield: 'bad', source: 'Uploaded File' },
      SAMPLE_ROWS[0],
    ];
    const result = await handleUploadData({ userId: 1, rows }, db);
    expect(result.status).toBe(200);
    expect(result.body.inserted).toBe(1);
    expect(result.body.skipped).toBeGreaterThanOrEqual(1);
  });

  it('skips a row with yield out of 0-100 range and reports it', async () => {
    const db = makeFakeDb();
    const rows = [
      { species: 'Tuna', product: 'General', yield: 150, source: 'Uploaded File' },
      SAMPLE_ROWS[0],
    ];
    const result = await handleUploadData({ userId: 1, rows }, db);
    expect(result.status).toBe(200);
    expect(result.body.inserted).toBe(1);
    expect(result.body.skipped).toBeGreaterThanOrEqual(1);
  });

  it('skips a row with species longer than 200 chars and reports it', async () => {
    const db = makeFakeDb();
    const rows = [
      { species: 'A'.repeat(201), product: 'General', yield: 50, source: 'Uploaded File' },
      SAMPLE_ROWS[0],
    ];
    const result = await handleUploadData({ userId: 1, rows }, db);
    expect(result.status).toBe(200);
    expect(result.body.inserted).toBe(1);
    expect(result.body.skipped).toBeGreaterThanOrEqual(1);
  });

  it('skips a row with product longer than 200 chars and reports it', async () => {
    const db = makeFakeDb();
    const rows = [
      { species: 'Tuna', product: 'P'.repeat(201), yield: 50, source: 'Uploaded File' },
      SAMPLE_ROWS[0],
    ];
    const result = await handleUploadData({ userId: 1, rows }, db);
    expect(result.status).toBe(200);
    expect(result.body.inserted).toBe(1);
    expect(result.body.skipped).toBeGreaterThanOrEqual(1);
  });

  it('does not call upsert for invalid rows', async () => {
    const upsert = vi.fn().mockResolvedValue({ inserted: true });
    const db = makeFakeDb({ upsertUserDataRow: upsert });
    const rows = [
      { species: '', product: 'General', yield: 50, source: 'Uploaded File' },
    ];
    await handleUploadData({ userId: 1, rows }, db);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('accepts yield of exactly 0 (zero-yield edge case)', async () => {
    const db = makeFakeDb();
    const rows = [{ species: 'Roe', product: 'Trim', yield: 0, source: 'Uploaded File' }];
    const result = await handleUploadData({ userId: 1, rows }, db);
    expect(result.status).toBe(200);
    expect(result.body.inserted).toBe(1);
  });

  it('accepts yield of exactly 100', async () => {
    const db = makeFakeDb();
    const rows = [{ species: 'Whole Fish', product: 'Round', yield: 100, source: 'Uploaded File' }];
    const result = await handleUploadData({ userId: 1, rows }, db);
    expect(result.status).toBe(200);
    expect(result.body.inserted).toBe(1);
  });
});

// ===========================================================================
// handleUploadData — upsert failure isolation (AC3 partial import protection)
// ===========================================================================

describe('handleUploadData — upsert failure isolation', () => {
  it('counts failed upserts in skipped and continues remaining rows', async () => {
    const upsert = vi.fn()
      .mockResolvedValueOnce({ inserted: true })
      .mockRejectedValueOnce(new Error('constraint violation'))
      .mockResolvedValueOnce({ inserted: true });
    const db = makeFakeDb({ upsertUserDataRow: upsert });
    const threeRows = [
      SAMPLE_ROWS[0],
      { species: 'Cod', product: 'General', yield: 55, source: 'Uploaded File' },
      SAMPLE_ROWS[1],
    ];
    const result = await handleUploadData({ userId: 1, rows: threeRows }, db);
    expect(result.status).toBe(200);
    expect(result.body.inserted).toBe(2);
    expect(result.body.skipped).toBeGreaterThanOrEqual(1);
    expect(upsert).toHaveBeenCalledTimes(3);
  });
});
