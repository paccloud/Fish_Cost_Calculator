/**
 * Transport-agnostic contributor handlers.
 *
 * Two public + two authenticated handlers live here:
 *   - handleListContributors   — GET /api/contributors       (public)
 *   - handleGetContributor     — GET /api/contributor        (authenticated)
 *   - handleSaveContributor    — POST /api/contributor       (authenticated)
 *
 * Production shape wins on drift (matches api/contributors.js and
 * api/contributor.js behaviour).
 *
 * Sanitized errors — raw driver messages never reach the caller.
 *
 * @module shared/handlers/contributors
 */

// ---------------------------------------------------------------------------
// List contributors (public)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} ListContributorsResponse
 * @property {number}       status
 * @property {Array|Object} body  Array of contributor rows on success; {error} on failure
 */

/**
 * Return all visible contributors (no auth required).
 *
 * @param {Object} _input  Unused — kept for interface consistency
 * @param {import('../db/interface.js').DbAdapter} db
 * @returns {Promise<ListContributorsResponse>}
 */
export async function handleListContributors(_input, db) {
  try {
    const rows = await db.listContributors();
    return { status: 200, body: rows };
  } catch (err) {
    console.error('[contributors] unexpected error:', err.message ?? err);
    return { status: 500, body: { error: 'Failed to fetch contributors' } };
  }
}

// ---------------------------------------------------------------------------
// Get contributor profile (authenticated)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} GetContributorRequest
 * @property {string|number} userId  - From the verified JWT / adapter
 */

/**
 * @typedef {Object} GetContributorResponse
 * @property {number}  status
 * @property {Object}  body  Contributor row on success; {error} on failure
 */

/**
 * Return the contributor profile for the authenticated user.
 *
 * @param {GetContributorRequest} input
 * @param {import('../db/interface.js').DbAdapter} db
 * @returns {Promise<GetContributorResponse>}
 */
export async function handleGetContributor(input, db) {
  const { userId } = input;

  if (!userId) {
    return { status: 401, body: { error: 'Unauthorized' } };
  }

  try {
    const row = await db.getContributorProfile(userId);
    if (!row) {
      return { status: 404, body: { error: 'Profile not found' } };
    }
    return { status: 200, body: row };
  } catch (err) {
    console.error('[contributor-get] unexpected error:', err.message ?? err);
    return { status: 500, body: { error: 'Failed to fetch profile' } };
  }
}

// ---------------------------------------------------------------------------
// Save contributor profile (authenticated)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} SaveContributorRequest
 * @property {string|number} userId       - From the verified JWT / adapter
 * @property {string}        [display_name]
 * @property {string}        [organization]
 * @property {string}        [bio]
 * @property {boolean}       [show_on_page]
 */

/**
 * @typedef {Object} SaveContributorResponse
 * @property {number}  status
 * @property {Object}  body  {id, message} on success; {error} on failure
 */

/**
 * Create or update the contributor profile for the authenticated user.
 *
 * @param {SaveContributorRequest} input
 * @param {import('../db/interface.js').DbAdapter} db
 * @returns {Promise<SaveContributorResponse>}
 */
export async function handleSaveContributor(input, db) {
  const { userId, display_name, organization, bio, show_on_page } = input;

  if (!userId) {
    return { status: 401, body: { error: 'Unauthorized' } };
  }

  // Normalise show_on_page to boolean — callers may send string 'true' or 1
  const showOnPage = show_on_page === true || show_on_page === 'true' || show_on_page === 1;

  try {
    const { id, created } = await db.saveContributorProfile(userId, {
      display_name,
      organization,
      bio,
      show_on_page: showOnPage,
    });

    if (created) {
      return { status: 201, body: { id, message: 'Profile created successfully' } };
    }
    return { status: 200, body: { message: 'Profile updated successfully' } };
  } catch (err) {
    console.error('[contributor-save] unexpected error:', err.message ?? err);
    return { status: 500, body: { error: 'Failed to save profile' } };
  }
}
