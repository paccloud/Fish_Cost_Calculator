import { describe, expect, it } from 'vitest';
import { Buffer } from 'node:buffer';
import {
  normalizeYieldRows,
  parseImportRows,
  upsertImportedYieldRows,
} from '../../../../api/_lib/importRows.js';

describe('normalizeYieldRows — yield parsing', () => {
  it('normalizes percent, whole-number, and comma-formatted text yields', () => {
    const { rows, skippedRows } = normalizeYieldRows(
      [
        { Species: 'Coho Salmon', Product: 'Fillet', Yield: '42%' },
        { Species: 'Pink Salmon', Product: 'Fillet', Yield: '42' },
        { Species: 'Sockeye Salmon', Product: 'Fillet', Yield: '42,5%' },
      ],
      'Uploaded File'
    );

    expect(skippedRows).toEqual([]);
    expect(rows.map((row) => row.yield)).toEqual([42, 42, 42.5]);
  });

  it('converts XLSX numeric percentage fractions (0.42 number → 42%)', () => {
    // ExcelJS emits percentage-formatted XLSX cells as numbers (0.42 for 42%).
    const { rows } = normalizeYieldRows(
      [{ Species: 'King Salmon', Product: 'Fillet', Yield: 0.42 }],
      'Uploaded File'
    );
    expect(rows[0].yield).toBe(42);
  });

  it('preserves sub-one-percent string yields from CSV (0.5 string → 0.5%)', () => {
    // When a CSV is exported by this app, a 0.5% yield is written as the
    // literal string "0.5". Re-importing must not multiply it by 100.
    const { rows } = normalizeYieldRows(
      [{ Species: 'Anchovy', Product: 'Fillet', '% Yield': '0.5' }],
      'Uploaded File'
    );
    expect(rows[0].yield).toBe(0.5);
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

describe('parseImportRows — real files end to end', () => {
  it('imports an Excel "42%" percent cell as a 42% yield', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Yields');
    sheet.addRow(['Species', '% Yield', 'Product', 'Source']);
    const row = sheet.addRow(['Coho Salmon', 0.42, 'Skinless Fillet', 'Test']);
    row.getCell(2).numFmt = '0%';
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const parsed = await parseImportRows(buffer, '.xlsx');
    const { rows, skippedRows } = normalizeYieldRows(parsed, 'test.xlsx');

    expect(skippedRows).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0].yield).toBe(42);
  });

  it('keeps a CSV "0.5" yield as 0.5%, not 50%', async () => {
    const csv = 'Species,% Yield,Product,Source\nAnchovy,0.5,Fillet,Test\nPink Salmon,42%,Fillet,Test\n';
    const parsed = await parseImportRows(Buffer.from(csv), '.csv');
    const { rows } = normalizeYieldRows(parsed, 'test.csv');

    expect(rows.map((r) => r.yield)).toEqual([0.5, 42]);
  });
});
