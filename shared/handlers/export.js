/**
 * Transport-agnostic export handler.
 *
 *   - handleExport — GET /api/export?type=calcs|data
 *
 * Returns a plain response envelope.  Because CSV is a string body (not JSON),
 * the response envelope carries extra fields so the adapter can set the
 * correct Content-Type and Content-Disposition headers:
 *
 *   { status, body, contentType, filename }
 *
 * For JSON error responses, contentType is absent (adapter defaults to JSON).
 *
 * Drift resolved from the dual-backend state:
 *   - Both backends had identical logic.  This module is a verbatim lift of
 *     that logic into the handler core so it is written exactly once.
 *   - CSV injection guard (sanitizeCsvValue) lives here — shared by both
 *     adapters through this module.
 *   - Error responses: sanitized; raw driver errors never reach the caller.
 *
 * @module shared/handlers/export
 */

// ---------------------------------------------------------------------------
// CSV helpers
// ---------------------------------------------------------------------------

const CSV_FORMULA_PREFIX = /^[=+\-@]/;

/**
 * Escape a single CSV cell value.
 * Quotes are doubled; CSV-injection prefixes are neutered with a leading
 * single-quote (Excel / Sheets ignore the quote visually but block formula
 * execution).
 *
 * @param {unknown} value
 * @returns {string}
 */
export function sanitizeCsvValue(value) {
  const stringValue = value === null || value === undefined ? '' : String(value);
  const escaped = stringValue.replace(/"/g, '""');
  return CSV_FORMULA_PREFIX.test(escaped.trimStart()) ? `'${escaped}` : escaped;
}

// ---------------------------------------------------------------------------
// Export handler
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} ExportRequest
 * @property {string|number} userId       - From the verified JWT / adapter
 * @property {string}        [exportType] - 'calcs' (default) | 'data'
 */

/**
 * @typedef {Object} ExportResponse
 * @property {number}  status
 * @property {string|Object} body         - CSV string on success, error object on failure
 * @property {string}  [contentType]      - Present on success ('text/csv')
 * @property {string}  [filename]         - Present on success (e.g. 'calculations.csv')
 */

/**
 * Export the authenticated user's calculations or user-data as CSV.
 *
 * @param {ExportRequest} input
 * @param {import('../db/interface.js').DbAdapter} db
 * @returns {Promise<ExportResponse>}
 */
export async function handleExport(input, db) {
  const { userId, exportType = 'calcs' } = input;

  if (!userId) {
    return { status: 401, body: { error: 'Unauthorized' } };
  }

  if (exportType !== 'calcs' && exportType !== 'data') {
    return { status: 400, body: { error: 'Invalid export type. Use type=calcs or type=data' } };
  }

  try {
    if (exportType === 'data') {
      const rows = await db.listUserDataForExport(userId);

      const csvHeader = 'Species,Product,Yield (%),Source\n';
      const csvRows = rows.map((data) => {
        const values = [
          sanitizeCsvValue(data.species),
          sanitizeCsvValue(data.product),
          sanitizeCsvValue(data.yield),
          sanitizeCsvValue(data.source || ''),
        ];
        return `"${values.join('","')}"`;
      }).join('\n');

      return {
        status: 200,
        body: csvHeader + csvRows,
        contentType: 'text/csv',
        filename: 'user_data.csv',
      };
    } else {
      // exportType === 'calcs'
      const rows = await db.listCalcsForExport(userId);

      const csvHeader = 'Date,Species,Conversion,Cost,Yield (%),Result\n';
      const csvRows = rows.map((calc) => {
        const date = sanitizeCsvValue(new Date(calc.date).toLocaleString());
        const values = [
          date,
          sanitizeCsvValue(calc.species),
          sanitizeCsvValue(calc.product),
          sanitizeCsvValue(calc.cost),
          sanitizeCsvValue(calc.yield),
          sanitizeCsvValue(calc.result),
        ];
        return `"${values.join('","')}"`;
      }).join('\n');

      return {
        status: 200,
        body: csvHeader + csvRows,
        contentType: 'text/csv',
        filename: 'calculations.csv',
      };
    }
  } catch (err) {
    console.error('[export] unexpected error:', err.message ?? err);
    return { status: 500, body: { error: 'Failed to export data' } };
  }
}
