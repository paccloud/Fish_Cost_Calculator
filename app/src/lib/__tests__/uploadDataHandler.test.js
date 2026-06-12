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
  it('returns 500 with generic message when upsert throws unexpected error', async () => {
    const db = makeFakeDb({
      upsertUserDataRow: vi.fn().mockRejectedValue(new Error('deadlock: 23P01')),
    });
    const result = await handleUploadData({ userId: 1, rows: SAMPLE_ROWS }, db);
    expect(result.status).toBe(500);
    expect(result.body.error).not.toMatch(/deadlock/i);
    expect(result.body.error).toBe('Failed to process file');
  });

  it('returns 400 when error message indicates a validation/file error', async () => {
    const db = makeFakeDb({
      upsertUserDataRow: vi.fn().mockRejectedValue(new Error('Unsupported file type')),
    });
    const result = await handleUploadData({ userId: 1, rows: SAMPLE_ROWS }, db);
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/unsupported file/i);
  });
});
