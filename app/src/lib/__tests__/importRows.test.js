import { describe, expect, it } from 'vitest';
import { normalizeYieldRows } from '../../../../api/_lib/importRows.js';

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
