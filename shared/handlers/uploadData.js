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
 * Maximum number of data rows accepted per upload request.
 * Prevents runaway upsert loops on malformed or adversarial files.
 */
export const MAX_IMPORT_ROWS = 500;

/** Maximum character length for species and product string fields. */
const MAX_FIELD_LENGTH = 200;

/**
 * Validate a single pre-normalised row before upserting.
 * Returns null on success or an error string describing the first violation.
 *
 * @param {NormalisedRow} row
 * @returns {string|null}
 */
function validateRow(row) {
  if (!row.species || typeof row.species !== 'string' || row.species.trim() === '') {
    return 'missing species';
  }
  if (row.species.length > MAX_FIELD_LENGTH) {
    return `species exceeds ${MAX_FIELD_LENGTH} characters`;
  }
  if (row.product && row.product.length > MAX_FIELD_LENGTH) {
    return `product exceeds ${MAX_FIELD_LENGTH} characters`;
  }
  const yieldNum = Number(row.yield);
  if (!Number.isFinite(yieldNum)) {
    return 'yield is not a number';
  }
  if (yieldNum < 0 || yieldNum > 100) {
    return `yield ${yieldNum} is out of range 0-100`;
  }
  return null;
}

/**
 * Process an already-parsed batch of yield rows for the authenticated user.
 * Upserts each row: if (userId, species, product) already exists, update
 * yield+source; otherwise insert.
 *
 * Rows that fail semantic validation or whose upsert throws are counted as
 * skipped and included in the skippedRows list — no silent partial imports.
 *
 * @param {UploadDataRequest} input
 * @param {import('../db/interface.js').DbAdapter} db
 * @returns {Promise<UploadDataResponse>}
 */
export async function handleUploadData(input, db) {
  const { userId, rows, skippedRows: adapterSkipped = [] } = input;

  if (!userId) {
    return { status: 401, body: { error: 'Unauthorized' } };
  }

  if (!Array.isArray(rows)) {
    return { status: 400, body: { error: 'Invalid rows payload' } };
  }

  if (rows.length > MAX_IMPORT_ROWS) {
    return {
      status: 400,
      body: { error: `Too many rows: ${rows.length} exceeds the ${MAX_IMPORT_ROWS}-row limit per upload.` },
    };
  }

  let inserted = 0;
  let updated = 0;
  // Collect row indices (1-based worksheet row number) for rows skipped here
  const handlerSkipped = [];

  try {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const validationError = validateRow(row);
      if (validationError) {
        // Use 1-based index relative to the data rows the handler received.
        // (adapter-level skippedRows already carry worksheet line numbers)
        handlerSkipped.push(i + 1);
        continue;
      }

      try {
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
      } catch (upsertErr) {
        // Isolate per-row upsert failures: log privately, count as skipped.
        console.error('[upload-data] row upsert failed (row %d):', i + 1, upsertErr.message ?? upsertErr);
        handlerSkipped.push(i + 1);
      }
    }

    // Merge adapter-level skipped (parse/normalisation failures) with
    // handler-level skipped (validation + upsert failures) for the response.
    const allSkipped = [...adapterSkipped, ...handlerSkipped];

    const parts = [];
    if (inserted > 0) parts.push(`${inserted} added`);
    if (updated > 0) parts.push(`${updated} updated`);
    if (allSkipped.length > 0) parts.push(`${allSkipped.length} skipped`);

    return {
      status: 200,
      body: {
        message: parts.length ? parts.join(', ') : 'No valid records found',
        inserted,
        updated,
        skipped: allSkipped.length,
        skippedRows: allSkipped,
      },
    };
  } catch (err) {
    console.error('[upload-data] unexpected error:', err.message ?? err);
    const status = VALIDATION_ERROR_RE.test(err.message ?? '') ? 400 : 500;
    const message = status === 400 ? (err.message || 'Invalid file') : 'Failed to process file';
    return { status, body: { error: message } };
  }
}
