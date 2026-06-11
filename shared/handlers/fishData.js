/**
 * Transport-agnostic fish-data handler.
 *
 *   - handleFishData — GET /api/fish-data
 *
 * Unauthenticated — no userId required.  Returns the full fish-data payload:
 *
 *   {
 *     fishData: { [speciesName]: { scientific_name, category, conversions } },
 *     profiles: { [speciesName]: { description, culinary_uses, edible_portions, url } },
 *     source:   { title, authors, publisher, publication, year }
 *   }
 *
 * Production shape wins on drift (matches api/fish-data.js behaviour).
 *
 * @module shared/handlers/fishData
 */

// ---------------------------------------------------------------------------
// Fish data
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} FishDataResponse
 * @property {number} status
 * @property {Object} body  {fishData, profiles, source} on success; {error} on failure
 */

/**
 * Return the full fish-data payload (no auth required).
 *
 * @param {Object} _input  Unused — kept for interface consistency
 * @param {import('../db/interface.js').DbAdapter} db
 * @returns {Promise<FishDataResponse>}
 */
export async function handleFishData(_input, db) {
  try {
    const payload = await db.getFishData();
    return { status: 200, body: payload };
  } catch (err) {
    console.error('[fish-data] unexpected error:', err.message ?? err);
    return { status: 500, body: { error: 'Failed to fetch fish data' } };
  }
}
