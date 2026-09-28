/**
 * Community yield-data feed — transport-agnostic handler core.
 *
 * The community feed is public and unauthenticated, so this module is the
 * single place that decides what a shared yield row looks like on the wire.
 * Both backends (Express/SQLite and Vercel/Neon) call handleListCommunityData
 * with their DbAdapter, so the JSON and CSV outputs are identical.
 *
 * Privacy rules (issue #26):
 *  - Never expose account identifiers (username, email, user_id, firebase_uid).
 *  - Attribution only with explicit consent: display name and organization
 *    appear only when the owner has a contributor profile AND show_on_page is
 *    true. Otherwise the contributor is anonymous (null) and organization null.
 *
 * @module shared/handlers/communityData
 */

const CSV_FORMULA_PREFIX = /^[=+\-@]/;

/**
 * Escape a value for a double-quoted CSV cell and neutralise spreadsheet
 * formula injection (cells starting with = + - @).
 * @param {unknown} value
 * @returns {string}
 */
export function sanitizeCsvValue(value) {
  const s = value === null || value === undefined ? '' : String(value);
  const escaped = s.replace(/"/g, '""');
  return CSV_FORMULA_PREFIX.test(escaped.trimStart()) ? `'${escaped}` : escaped;
}

/**
 * True only for an explicit opt-in. SQLite stores booleans as INTEGER 0/1,
 * Postgres returns real booleans; a missing profile yields null/undefined.
 * @param {unknown} value
 * @returns {boolean}
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
 * Decide the public attribution for a shared row from the owner's
 * contributor-profile fields.
 *
 * @param {{contributor_display_name?: string|null, contributor_organization?: string|null, contributor_show_on_page?: boolean|number|null}} row
 * @returns {{contributor: string|null, organization: string|null}}
 */
export function resolveCommunityAttribution(row) {
  if (!row || !isExplicitOptIn(row.contributor_show_on_page)) {
    return { contributor: null, organization: null };
  }
  return {
    contributor: nonEmptyString(row.contributor_display_name),
    organization: nonEmptyString(row.contributor_organization),
  };
}

/**
 * Postgres returns DECIMAL columns as strings ("40.00") while SQLite returns
 * numbers (40). Normalise numeric strings so both backends emit the same type.
 * @param {unknown} value
 * @returns {unknown}
 */
function normalizeYield(value) {
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return value;
}

/**
 * Whitelist-shape one adapter row into the public community row.
 * Only the fields listed here can ever leave the server.
 *
 * @param {Object} row - row from DbAdapter.listSharedYieldRows()
 * @returns {{id: number|string, species: string, product: string, yield: number, source: string|null, contributor: string|null, organization: string|null}}
 */
export function shapeCommunityRow(row) {
  const { contributor, organization } = resolveCommunityAttribution(row);
  return {
    id: row.id,
    species: row.species,
    product: row.product,
    yield: normalizeYield(row.yield),
    source: row.source ?? null,
    contributor,
    organization,
  };
}

export const COMMUNITY_CSV_HEADER = 'Species,Product,Yield (%),Source,Contributor,Organization';

/**
 * Render shaped community rows as CSV (formula-injection safe).
 * Anonymous contributors / missing organizations are blank cells.
 *
 * @param {ReturnType<typeof shapeCommunityRow>[]} rows
 * @returns {string}
 */
export function communityRowsToCsv(rows) {
  const lines = rows.map((r) =>
    [r.species, r.product, r.yield, r.source, r.contributor, r.organization]
      .map((v) => `"${sanitizeCsvValue(v)}"`)
      .join(',')
  );
  return `${COMMUNITY_CSV_HEADER}\n${lines.join('\n')}`;
}

/**
 * GET community data — JSON by default, CSV when input.format === 'csv'.
 *
 * Returns {status, body} plus, for CSV, a `headers` map the transport must
 * set (Content-Type / Content-Disposition) and send `body` as text.
 *
 * @param {{format?: string}} input
 * @param {import('../db/interface.js').DbAdapter} db
 */
export async function handleListCommunityData(input, db) {
  const format = input?.format === 'csv' ? 'csv' : 'json';
  let rows;
  try {
    rows = (await db.listSharedYieldRows()).map(shapeCommunityRow);
  } catch (err) {
    console.error('[community-data] unexpected error:', err?.message ?? err);
    return {
      status: 500,
      body: { error: format === 'csv' ? 'Failed to export community data' : 'Failed to load community data' },
    };
  }

  if (format === 'csv') {
    return {
      status: 200,
      body: communityRowsToCsv(rows),
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="community-yield-data.csv"',
      },
    };
  }

  return { status: 200, body: rows };
}
