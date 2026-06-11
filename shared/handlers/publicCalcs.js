/**
 * Transport-agnostic public-calculations handler.
 *
 *   - handlePublicCalcs — GET /api/public-calcs
 *
 * Unauthenticated — no userId required.  Returns recent calculations
 * (id, species, product, cost, yield, result, date) without user_id,
 * ordered by date DESC, limited to 100 rows.
 *
 * Production shape wins on drift (matches api/public-calcs.js behaviour).
 *
 * @module shared/handlers/publicCalcs
 */

// ---------------------------------------------------------------------------
// List public calculations
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} PublicCalcsResponse
 * @property {number} status
 * @property {Array|Object} body  Array of calc rows on success; {error} on failure
 */

/**
 * Return recent public calculations (no auth required).
 *
 * @param {Object} _input  Unused — kept for interface consistency
 * @param {import('../db/interface.js').DbAdapter} db
 * @returns {Promise<PublicCalcsResponse>}
 */
export async function handlePublicCalcs(_input, db) {
  try {
    const rows = await db.listPublicCalcs();
    return { status: 200, body: rows };
  } catch (err) {
    console.error('[public-calcs] unexpected error:', err.message ?? err);
    return { status: 500, body: { error: 'Failed to fetch calculations' } };
  }
}
