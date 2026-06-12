import { buildCsv } from './csv.js';

function isMissing(value) {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

function parseYield(value) {
  if (isMissing(value)) return { ok: false };
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) {
    return { ok: false };
  }
  return { ok: true, value: numeric };
}

function requireUser(userId) {
  return userId ? null : { status: 401, body: { error: 'Unauthorized' } };
}

function invalidId(id) {
  return isMissing(id) || Number.isNaN(Number(id));
}

function sameOwner(row, userId) {
  return String(row?.user_id) === String(userId);
}

function publicRowFields(input, existing = {}) {
  return {
    species: input.species !== undefined ? input.species : existing.species,
    product: input.product !== undefined ? input.product : existing.product,
    yield: input.yield !== undefined ? input.yield : existing.yield,
    source: input.source !== undefined ? input.source : existing.source,
  };
}

function validateUserDataFields(fields) {
  if (isMissing(fields.species) || isMissing(fields.product) || fields.yield === undefined) {
    return { ok: false, error: 'Species, product, and yield are required' };
  }

  const yieldResult = parseYield(fields.yield);
  if (!yieldResult.ok) {
    return { ok: false, error: 'Yield must be a number from 0 to 100' };
  }

  return {
    ok: true,
    fields: {
      species: String(fields.species).trim(),
      product: String(fields.product).trim(),
      yield: yieldResult.value,
      source: isMissing(fields.source) ? 'User Input' : String(fields.source).trim(),
    },
  };
}

function uploadMessage(inserted, updated, skipped) {
  const parts = [];
  if (inserted > 0) parts.push(`${inserted} added`);
  if (updated > 0) parts.push(`${updated} updated`);
  if (skipped > 0) parts.push(`${skipped} skipped`);
  return parts.length ? parts.join(', ') : 'No valid records found';
}

export async function handleListUserData(input, db) {
  const auth = requireUser(input.userId);
  if (auth) return auth;

  try {
    return { status: 200, body: await db.listUserData(input.userId) };
  } catch (err) {
    console.error('[list-user-data] unexpected error:', err.message ?? err);
    return { status: 500, body: { error: 'Failed to fetch user data' } };
  }
}

export async function handleCreateUserData(input, db) {
  const auth = requireUser(input.userId);
  if (auth) return auth;

  const validation = validateUserDataFields(publicRowFields(input));
  if (!validation.ok) return { status: 400, body: { error: validation.error } };

  try {
    const row = await db.createUserData(input.userId, validation.fields);
    return { status: 201, body: { id: row.id, message: 'Data added successfully' } };
  } catch (err) {
    console.error('[create-user-data] unexpected error:', err.message ?? err);
    return { status: 500, body: { error: 'Failed to add data' } };
  }
}

export async function handleUpdateUserData(input, db) {
  const auth = requireUser(input.userId);
  if (auth) return auth;
  if (invalidId(input.id)) return { status: 400, body: { error: 'Invalid data id' } };

  try {
    const existing = await db.findUserDataById(input.id);
    if (!existing || !sameOwner(existing, input.userId)) {
      return { status: 404, body: { error: 'Entry not found or not owned by user' } };
    }

    const validation = validateUserDataFields(publicRowFields(input, existing));
    if (!validation.ok) return { status: 400, body: { error: validation.error } };

    await db.updateUserData(input.userId, input.id, validation.fields);
    return { status: 200, body: { message: 'Updated successfully' } };
  } catch (err) {
    console.error('[update-user-data] unexpected error:', err.message ?? err);
    return { status: 500, body: { error: 'Failed to update data' } };
  }
}

export async function handleDeleteUserData(input, db) {
  const auth = requireUser(input.userId);
  if (auth) return auth;
  if (invalidId(input.id)) return { status: 400, body: { error: 'Invalid data id' } };

  try {
    const existing = await db.findUserDataById(input.id);
    if (!existing || !sameOwner(existing, input.userId)) {
      return { status: 404, body: { error: 'Entry not found or not owned by user' } };
    }

    await db.deleteUserData(input.userId, input.id);
    return { status: 200, body: { message: 'Deleted successfully' } };
  } catch (err) {
    console.error('[delete-user-data] unexpected error:', err.message ?? err);
    return { status: 500, body: { error: 'Failed to delete data' } };
  }
}

export async function handleUploadUserDataRows(input, db) {
  const auth = requireUser(input.userId);
  if (auth) return auth;

  try {
    const rows = Array.isArray(input.rows) ? input.rows : [];
    const skippedRows = Array.isArray(input.skippedRows) ? input.skippedRows : [];
    const { inserted, updated } = await db.upsertUserDataRows(input.userId, rows);

    return {
      status: 200,
      body: {
        message: uploadMessage(inserted, updated, skippedRows.length),
        inserted,
        updated,
        skipped: skippedRows.length,
        skippedRows,
      },
    };
  } catch (err) {
    console.error('[upload-user-data] unexpected error:', err.message ?? err);
    return { status: 500, body: { error: 'Failed to process file. Ensure it is a valid spreadsheet.' } };
  }
}

export async function handleExport(input, db) {
  const auth = requireUser(input.userId);
  if (auth) return auth;

  const type = input.type || 'calcs';
  if (type !== 'calcs' && type !== 'data') {
    return { status: 400, body: { error: 'Export type must be calcs or data' } };
  }

  try {
    if (type === 'data') {
      const rows = await db.listExportUserData(input.userId);
      return {
        status: 200,
        body: {
          filename: 'user_data.csv',
          csv: buildCsv(
            ['Species', 'Product', 'Yield (%)', 'Source'],
            rows.map((row) => [row.species, row.product, row.yield, row.source || ''])
          ),
        },
      };
    }

    const rows = await db.listExportCalcs(input.userId);
    return {
      status: 200,
      body: {
        filename: 'calculations.csv',
        csv: buildCsv(
          ['Date', 'Species', 'Conversion', 'Cost', 'Yield (%)', 'Result'],
          rows.map((row) => [
            new Date(row.date).toLocaleString(),
            row.species,
            row.product,
            row.cost,
            row.yield,
            row.result,
          ])
        ),
      },
    };
  } catch (err) {
    console.error('[export] unexpected error:', err.message ?? err);
    return { status: 500, body: { error: 'Failed to export data' } };
  }
}
