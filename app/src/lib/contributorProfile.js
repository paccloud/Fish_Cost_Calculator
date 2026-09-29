/**
 * Contributor profile form helpers (issue #116).
 *
 * The API returns show_on_page as integer 1/0 (SQLite), a boolean (Postgres),
 * and the save handler also accepts the string 'true'. These pure helpers keep
 * that mapping out of the React component so it can be unit-tested.
 *
 * @module lib/contributorProfile
 */

/**
 * Strict opt-in: only boolean true or integer 1. Anything else (including the
 * string 'true') is NOT consent. Matches the server's public attribution rule
 * (isExplicitOptIn in shared/handlers/communityData.js), so use it wherever
 * attribution is previewed.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isExplicitOptIn(value) {
  return value === true || value === 1;
}

/**
 * Checkbox state for a stored show_on_page value: true / 1 / 'true' are
 * checked; false / 0 / 'false' / null / undefined / anything else are not.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function normalizeShowOnPage(value) {
  return isExplicitOptIn(value) || value === 'true';
}

/** Form state for a brand-new profile (no stored profile yet). */
export const DEFAULT_PROFILE_FORM = Object.freeze({
  display_name: '',
  organization: '',
  bio: '',
  show_on_page: true,
});

/**
 * Map a loaded profile (GET /api/contributor/me) to form state. A missing
 * profile keeps the new-profile default.
 *
 * @param {Object|null|undefined} data
 * @returns {{display_name: string, organization: string, bio: string, show_on_page: boolean}}
 */
export function profileToFormData(data) {
  if (!data) return { ...DEFAULT_PROFILE_FORM };
  return {
    display_name: data.display_name || '',
    organization: data.organization || '',
    bio: data.bio || '',
    show_on_page: normalizeShowOnPage(data.show_on_page),
  };
}

/**
 * Build the POST /api/contributor body from form state. show_on_page is
 * always sent as a real boolean.
 *
 * @param {{display_name?: string, organization?: string, bio?: string, show_on_page?: unknown}} formData
 * @returns {{display_name: string, organization: string, bio: string, show_on_page: boolean}}
 */
export function buildProfilePayload(formData) {
  return {
    display_name: formData.display_name ?? '',
    organization: formData.organization ?? '',
    bio: formData.bio ?? '',
    show_on_page: normalizeShowOnPage(formData.show_on_page),
  };
}
