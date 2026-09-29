/**
 * Public contributors listing — shaping (allowlist) for the wire format.
 *
 * The contributors listing is public and unauthenticated, so this module is
 * the single place that decides what a listed contributor looks like on the
 * wire. Mirrors shared/handlers/communityData.js (issue #26).
 *
 * Privacy rules (issue #115):
 *  - Only id (the contributor row id), display_name, organization, bio and
 *    contribution_count ever leave the server.
 *  - Never expose username, email, user_id, firebase_uid, created_at,
 *    updated_at or any other field, even if an adapter returns extra columns.
 *  - Only profiles with show_on_page explicitly true (Postgres boolean true,
 *    SQLite integer 1) are listed. Adapters filter in SQL; this is a second
 *    line of defence.
 *  - A profile with no usable display name (null/blank after trim) is not
 *    listed, since the page would render an empty heading.
 *
 * @module shared/handlers/contributorsList
 */

function isExplicitOptIn(value) {
  return value === true || value === 1;
}

function nonEmptyString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Postgres COUNT() returns a string/bigint, SQLite a number. Emit a number.
 * @param {unknown} value
 * @returns {number}
 */
function normalizeCount(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Whitelist-shape one adapter row into the public contributor, or null when
 * the row must not be listed.
 *
 * @param {Object} row - row from DbAdapter.listContributors()
 * @returns {{id: number|string, display_name: string, organization: string|null, bio: string|null, contribution_count: number}|null}
 */
export function shapeContributor(row) {
  if (!row) return null;
  // show_on_page is not selected by adapters that already filter on it; only
  // reject when a row explicitly says it is not opted in.
  if ('show_on_page' in row && !isExplicitOptIn(row.show_on_page)) return null;
  const displayName = nonEmptyString(row.display_name);
  if (displayName === null) return null;
  return {
    id: row.id,
    display_name: displayName,
    organization: nonEmptyString(row.organization),
    bio: nonEmptyString(row.bio),
    contribution_count: normalizeCount(row.contribution_count),
  };
}

/**
 * @param {Array<Object>} rows
 * @returns {ReturnType<typeof shapeContributor>[]}
 */
export function shapeContributors(rows) {
  return (rows ?? []).map(shapeContributor).filter((c) => c !== null);
}
