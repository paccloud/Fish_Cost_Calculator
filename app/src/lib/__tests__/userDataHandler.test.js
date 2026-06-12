import { describe, expect, it, vi } from 'vitest';
import {
  handleCreateUserData,
  handleDeleteUserData,
  handleExport,
  handleListUserData,
  handleUpdateUserData,
  handleUploadUserDataRows,
} from '../../../../shared/handlers/userData.js';

function makeFakeDb(overrides = {}) {
  return {
    listUserData: vi.fn().mockResolvedValue([]),
    createUserData: vi.fn().mockResolvedValue({ id: 1 }),
    findUserDataById: vi.fn().mockResolvedValue(null),
    updateUserData: vi.fn().mockResolvedValue(undefined),
    deleteUserData: vi.fn().mockResolvedValue(undefined),
    upsertUserDataRows: vi.fn().mockResolvedValue({ inserted: 0, updated: 0 }),
    listExportCalcs: vi.fn().mockResolvedValue([]),
    listExportUserData: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe('user-data handlers — auth and validation', () => {
  it('requires auth before listing user data', async () => {
    const db = makeFakeDb();

    const result = await handleListUserData({}, db);

    expect(result.status).toBe(401);
    expect(db.listUserData).not.toHaveBeenCalled();
  });

  it('rejects missing species, product, or yield before creating user data', async () => {
    const db = makeFakeDb();

    const result = await handleCreateUserData({ userId: 7, species: 'Coho Salmon', yield: 42 }, db);

    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/required/i);
    expect(db.createUserData).not.toHaveBeenCalled();
  });

  it('rejects non-numeric and out-of-range yields', async () => {
    const db = makeFakeDb();

    const nonNumeric = await handleCreateUserData(
      { userId: 7, species: 'Coho Salmon', product: 'Fillet', yield: 'forty-two' },
      db
    );
    const outOfRange = await handleCreateUserData(
      { userId: 7, species: 'Coho Salmon', product: 'Fillet', yield: 101 },
      db
    );

    expect(nonNumeric.status).toBe(400);
    expect(outOfRange.status).toBe(400);
    expect(db.createUserData).not.toHaveBeenCalled();
  });
});

describe('user-data handlers — ownership', () => {
  it('does not update another user entry', async () => {
    const db = makeFakeDb({
      findUserDataById: vi.fn().mockResolvedValue({ id: 12, user_id: 99, species: 'Coho Salmon', product: 'Fillet', yield: 42 }),
    });

    const result = await handleUpdateUserData({ userId: 7, id: 12, yield: 44 }, db);

    expect(result.status).toBe(404);
    expect(db.updateUserData).not.toHaveBeenCalled();
  });

  it('does not delete another user entry', async () => {
    const db = makeFakeDb({
      findUserDataById: vi.fn().mockResolvedValue({ id: 12, user_id: 99 }),
    });

    const result = await handleDeleteUserData({ userId: 7, id: 12 }, db);

    expect(result.status).toBe(404);
    expect(db.deleteUserData).not.toHaveBeenCalled();
  });
});

describe('upload handler — row summary', () => {
  it('returns added, updated, and skipped counts from normalized rows', async () => {
    const db = makeFakeDb({
      upsertUserDataRows: vi.fn().mockResolvedValue({ inserted: 2, updated: 1 }),
    });

    const result = await handleUploadUserDataRows(
      {
        userId: 7,
        rows: [
          { species: 'Coho Salmon', product: 'Fillet', yield: 42, source: 'Uploaded File' },
          { species: 'Pink Salmon', product: 'Fillet', yield: 43, source: 'Uploaded File' },
          { species: 'King Salmon', product: 'Fillet', yield: 44, source: 'Uploaded File' },
        ],
        skippedRows: [5],
      },
      db
    );

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ inserted: 2, updated: 1, skipped: 1, skippedRows: [5] });
    expect(result.body.message).toBe('2 added, 1 updated, 1 skipped');
  });
});

describe('export handler — CSV contract', () => {
  it('exports custom yield data with formula-prefix and quote escaping', async () => {
    const db = makeFakeDb({
      listExportUserData: vi.fn().mockResolvedValue([
        { species: '=Bad Fish', product: 'Skinless "Fillet"', yield: 42, source: '+Sheet' },
      ]),
    });

    const result = await handleExport({ userId: 7, type: 'data' }, db);

    expect(result.status).toBe(200);
    expect(result.body.filename).toBe('user_data.csv');
    expect(result.body.csv).toContain('Species,Product,Yield (%),Source');
    expect(result.body.csv).toContain('"\'=Bad Fish","Skinless ""Fillet""","42","\'+Sheet"');
  });

  it('rejects unknown export types instead of silently exporting calculations', async () => {
    const db = makeFakeDb();

    const result = await handleExport({ userId: 7, type: 'inventory' }, db);

    expect(result.status).toBe(400);
    expect(db.listExportCalcs).not.toHaveBeenCalled();
    expect(db.listExportUserData).not.toHaveBeenCalled();
  });
});

describe('user-data handlers — sanitized failures', () => {
  it('does not leak driver details when create fails', async () => {
    const db = makeFakeDb({
      createUserData: vi.fn().mockRejectedValue(new Error('SQLITE_CONSTRAINT: private detail')),
    });

    const result = await handleCreateUserData(
      { userId: 7, species: 'Coho Salmon', product: 'Fillet', yield: 42 },
      db
    );

    expect(result.status).toBe(500);
    expect(result.body.error).toBe('Failed to add data');
    expect(result.body.error).not.toMatch(/SQLITE/i);
  });
});
