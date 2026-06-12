import { describe, expect, it } from 'vitest';
import {
  normalizeYieldRows,
  upsertImportedYieldRows,
} from '../../../../api/_lib/importRows.js';

describe('normalizeYieldRows — yield parsing', () => {
  it('normalizes percent, decimal, whole-number, and comma-formatted yields', () => {
    const { rows, skippedRows } = normalizeYieldRows(
      [
        { Species: 'Coho Salmon', Product: 'Fillet', Yield: '42%' },
        { Species: 'King Salmon', Product: 'Fillet', Yield: '0.42' },
        { Species: 'Pink Salmon', Product: 'Fillet', Yield: '42' },
        { Species: 'Sockeye Salmon', Product: 'Fillet', Yield: '42,5%' },
      ],
      'Uploaded File'
    );

    expect(skippedRows).toEqual([]);
    expect(rows.map((row) => row.yield)).toEqual([42, 42, 42, 42.5]);
  });
});

describe('upsertImportedYieldRows — transaction behavior', () => {
  it('rolls back instead of committing when a row write fails', async () => {
    const calls = [];
    const runQuery = async (sql) => {
      calls.push(sql);
      if (sql.startsWith('SELECT')) return { rows: [] };
      if (sql.startsWith('INSERT') && calls.filter((call) => call.startsWith('INSERT')).length === 2) {
        throw new Error('duplicate key detail should not leak');
      }
      return { rows: [] };
    };

    await expect(
      upsertImportedYieldRows(7, [
        { species: 'Coho Salmon', product: 'Fillet', yield: 42, source: 'Uploaded File' },
        { species: 'Pink Salmon', product: 'Fillet', yield: 43, source: 'Uploaded File' },
      ], runQuery)
    ).rejects.toThrow(/duplicate key/);

    expect(calls[0]).toBe('BEGIN');
    expect(calls).toContain('ROLLBACK');
    expect(calls).not.toContain('COMMIT');
  });
});
