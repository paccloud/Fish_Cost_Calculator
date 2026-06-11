/**
 * Transport-agnostic upload-data handler.
 *
 *   - handleUploadData — POST /api/upload-data
 *
 * File parsing (multipart, Excel/CSV byte parsing) is transport-specific and
 * stays in each adapter (multer for Express, formidable for Vercel).  The
 * adapter is responsible for calling the shared importRows helpers and passing
 * the already-normalised row array into this handler.
 *
 * This handler owns:
 *   - Auth guard
 *   - Validation of the pre-normalised rows array
 *   - The upsert logic (check for existing (userId, species, product) — update
 *     if found, insert if not) delegated to the db adapter
 *   - Counting inserted / updated / skipped rows
 *   - Sanitized error responses
 *
 * Drift resolved from the dual-backend state:
 *   - Row processing order: server used Promise.all (parallel); production used
 *     for-of (sequential).  Sequential is safer — race-free for upsert detection.
 *     Production shape wins.
 *   - Error message: server returned "Failed to process file. Ensure it is a
 *     valid spreadsheet."; production returned "Failed to process file".
 *     Production shape wins.
 *   - Validation errors (file-type, parse errors) come from the adapter layer
 *     through a thrown Error with a recognisable message — the adapter rethrows
 *     them; this handler detects them for 400 vs 500 classification.
 *
 * @module shared/handlers/uploadData
 */

/**
 * @typedef {Object} NormalisedRow
 * @property {string} species
 * @property {string} product
 * @property {number} yield
 * @property {string} source
 */

/**
 * @typedef {Object} UploadDataRequest
 * @property {string|number}   userId      - From the verified JWT / adapter
 * @property {NormalisedRow[]} rows        - Pre-parsed, normalised rows
 * @property {number[]}        [skippedRows] - Row numbers that failed normalisation
 */

/**
 * @typedef {Object} UploadDataResponse
 * @property {number}   status
 * @property {Object}   body
 * @property {string}   [body.message]     Present on success
 * @property {number}   [body.inserted]    Count of inserted rows
 * @property {number}   [body.updated]     Count of updated rows
 * @property {number}   [body.skipped]     Count of skipped rows
 * @property {number[]} [body.skippedRows] Row numbers that were skipped
 * @property {string}   [body.error]       Present on failure
 */

/** Regex to detect validation-error messages that should be 400, not 500. */
const VALIDATION_ERROR_RE = /unsupported file|parse csv|no valid/i;

/**
 * Process an already-parsed batch of yield rows for the authenticated user.
 * Upserts each row: if (userId, species, product) already exists, update
 * yield+source; otherwise insert.
 *
 * @param {UploadDataRequest} input
 * @param {import('../db/interface.js').DbAdapter} db
 * @returns {Promise<UploadDataResponse>}
 */
export async function handleUploadData(input, db) {
  const { userId, rows, skippedRows = [] } = input;

  if (!userId) {
    return { status: 401, body: { error: 'Unauthorized' } };
  }

  if (!Array.isArray(rows)) {
    return { status: 400, body: { error: 'Invalid rows payload' } };
  }

  let inserted = 0;
  let updated = 0;

  try {
    for (const row of rows) {
      const result = await db.upsertUserDataRow(userId, {
        species: row.species,
        product: row.product,
        yield: row.yield,
        source: row.source,
      });
      if (result.inserted) {
        inserted++;
      } else {
        updated++;
      }
    }

    const parts = [];
    if (inserted > 0) parts.push(`${inserted} added`);
    if (updated > 0) parts.push(`${updated} updated`);
    if (skippedRows.length > 0) parts.push(`${skippedRows.length} skipped`);

    return {
      status: 200,
      body: {
        message: parts.length ? parts.join(', ') : 'No valid records found',
        inserted,
        updated,
        skipped: skippedRows.length,
        skippedRows,
      },
    };
  } catch (err) {
    console.error('[upload-data] unexpected error:', err.message ?? err);
    const status = VALIDATION_ERROR_RE.test(err.message ?? '') ? 400 : 500;
    const message = status === 400 ? (err.message || 'Invalid file') : 'Failed to process file';
    return { status, body: { error: message } };
  }
}
