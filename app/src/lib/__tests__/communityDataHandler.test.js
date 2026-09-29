/**
 * Community yield-data feed tests (issue #26).
 *
 * Covers the shared handler core (shared/handlers/communityData.js) through a
 * fake DbAdapter, plus both real adapter queries:
 *   - SQLite adapter against an in-memory sqlite3 database (server/adapters)
 *   - Neon adapter SQL text with the query function mocked (api/_lib)
 *
 * Test runner: Vitest (run via `cd app && npm test`)
 */

import { createRequire } from 'node:module';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  handleListCommunityData,
  resolveCommunityAttribution,
  shapeCommunityRow,
  communityRowsToCsv,
} from '../../../../shared/handlers/communityData.js';

vi.mock('../../../../api/_lib/db.js', () => ({ query: vi.fn() }));

const require = createRequire(import.meta.url);

// server/ dependencies are not installed in CI (only app/ and shared/ are), so
// the real-SQLite checks run only where sqlite3 is available (local dev).
let sqlite3 = null;
try {
  sqlite3 = require('../../../../server/node_modules/sqlite3');
} catch {
  sqlite3 = null;
}

// Identifier strings that must never appear in any community response.
const FORBIDDEN_VALUES = ['fisher@example.com', 'uid-secret-123', 'private@example.com', 'hidden-uid-456'];
const FORBIDDEN_KEYS = ['username', 'email', 'user_id', 'firebase_uid'];

// Adapter rows for the three attribution cases. Extra identifier fields are
// included deliberately to prove the shaper whitelists its output even if an
// adapter ever returned more than it should.
const NO_PROFILE_ROW = {
  id: 1, species: 'Cod', product: 'Fillet', yield: 40, source: 'Dock test',
  contributor_display_name: null, contributor_organization: null, contributor_show_on_page: null,
  username: 'fisher@example.com', user_id: 7, firebase_uid: 'uid-secret-123',
};
const HIDDEN_PROFILE_ROW = {
  id: 2, species: 'Halibut', product: 'Steak', yield: 55, source: null,
  contributor_display_name: 'Quiet Skipper', contributor_organization: 'Hidden Co-op', contributor_show_on_page: 0,
  email: 'private@example.com', firebase_uid: 'hidden-uid-456',
};
const PUBLIC_PROFILE_ROW = {
  id: 3, species: 'Pink Salmon', product: 'Skinless Fillet', yield: 42, source: 'MAB-37',
  contributor_display_name: 'Deckhand Dana', contributor_organization: 'Sitka Fishers', contributor_show_on_page: true,
};

function makeFakeDb(rows) {
  return { listSharedYieldRows: vi.fn().mockResolvedValue(rows) };
}

function assertNoIdentifiers(body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  for (const value of FORBIDDEN_VALUES) expect(text).not.toContain(value);
  if (Array.isArray(body)) {
    for (const row of body) {
      for (const key of FORBIDDEN_KEYS) expect(row).not.toHaveProperty(key);
    }
  }
}

describe('resolveCommunityAttribution', () => {
  it('is anonymous when the owner has no contributor profile', () => {
    expect(resolveCommunityAttribution(NO_PROFILE_ROW)).toEqual({ contributor: null, organization: null });
  });

  it('is anonymous with no organization when show_on_page is false (SQLite 0 or Postgres false)', () => {
    expect(resolveCommunityAttribution(HIDDEN_PROFILE_ROW)).toEqual({ contributor: null, organization: null });
    expect(resolveCommunityAttribution({ ...HIDDEN_PROFILE_ROW, contributor_show_on_page: false }))
      .toEqual({ contributor: null, organization: null });
  });

  it('uses display name and organization when show_on_page is true (Postgres true or SQLite 1)', () => {
    expect(resolveCommunityAttribution(PUBLIC_PROFILE_ROW))
      .toEqual({ contributor: 'Deckhand Dana', organization: 'Sitka Fishers' });
    expect(resolveCommunityAttribution({ ...PUBLIC_PROFILE_ROW, contributor_show_on_page: 1 }))
      .toEqual({ contributor: 'Deckhand Dana', organization: 'Sitka Fishers' });
  });

  it('does not treat truthy non-boolean values as consent', () => {
    for (const v of ['true', '1', 'yes', {}]) {
      expect(resolveCommunityAttribution({ ...PUBLIC_PROFILE_ROW, contributor_show_on_page: v }))
        .toEqual({ contributor: null, organization: null });
    }
  });

  it('treats a blank display name as anonymous', () => {
    expect(resolveCommunityAttribution({ ...PUBLIC_PROFILE_ROW, contributor_display_name: '  ' }))
      .toEqual({ contributor: null, organization: 'Sitka Fishers' });
  });
});

describe('shapeCommunityRow', () => {
  it('returns exactly the public fields', () => {
    expect(Object.keys(shapeCommunityRow(NO_PROFILE_ROW)).sort())
      .toEqual(['contributor', 'id', 'organization', 'product', 'source', 'species', 'yield']);
  });

  it('emits yield as a number on both backends (Postgres DECIMAL string vs SQLite number)', () => {
    expect(shapeCommunityRow({ ...NO_PROFILE_ROW, yield: '40.00' }).yield).toBe(40);
    expect(shapeCommunityRow({ ...NO_PROFILE_ROW, yield: 40 }).yield).toBe(40);
    expect(shapeCommunityRow({ ...NO_PROFILE_ROW, yield: '42.5' }).yield).toBe(42.5);
  });
});

describe('handleListCommunityData — JSON', () => {
  it('shapes all three attribution cases and never leaks identifiers', async () => {
    const db = makeFakeDb([NO_PROFILE_ROW, HIDDEN_PROFILE_ROW, PUBLIC_PROFILE_ROW]);

    const result = await handleListCommunityData({}, db);

    expect(result.status).toBe(200);
    expect(result.headers).toBeUndefined();
    expect(result.body).toEqual([
      { id: 1, species: 'Cod', product: 'Fillet', yield: 40, source: 'Dock test', contributor: null, organization: null },
      { id: 2, species: 'Halibut', product: 'Steak', yield: 55, source: null, contributor: null, organization: null },
      { id: 3, species: 'Pink Salmon', product: 'Skinless Fillet', yield: 42, source: 'MAB-37', contributor: 'Deckhand Dana', organization: 'Sitka Fishers' },
    ]);
    assertNoIdentifiers(result.body);
    expect(JSON.stringify(result.body)).not.toContain('Quiet Skipper');
    expect(JSON.stringify(result.body)).not.toContain('Hidden Co-op');
  });

  it('returns 500 with a generic error when the adapter throws', async () => {
    const db = { listSharedYieldRows: vi.fn().mockRejectedValue(new Error('boom')) };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await handleListCommunityData({}, db);
    spy.mockRestore();
    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: 'Failed to load community data' });
  });
});

describe('handleListCommunityData — CSV', () => {
  it('renders anonymous contributors as blank cells and never leaks identifiers', async () => {
    const db = makeFakeDb([NO_PROFILE_ROW, HIDDEN_PROFILE_ROW, PUBLIC_PROFILE_ROW]);

    const result = await handleListCommunityData({ format: 'csv' }, db);

    expect(result.status).toBe(200);
    expect(result.headers['Content-Type']).toBe('text/csv');
    expect(result.headers['Content-Disposition']).toContain('community-yield-data.csv');
    expect(result.body.split('\n')).toEqual([
      'Species,Product,Yield (%),Source,Contributor,Organization',
      '"Cod","Fillet","40","Dock test","",""',
      '"Halibut","Steak","55","","",""',
      '"Pink Salmon","Skinless Fillet","42","MAB-37","Deckhand Dana","Sitka Fishers"',
    ]);
    assertNoIdentifiers(result.body);
    expect(result.body).not.toContain('Quiet Skipper');
    expect(result.body).not.toContain('Hidden Co-op');
  });

  it('keeps formula-injection sanitization and quote escaping', () => {
    const csv = communityRowsToCsv([
      { species: '=HYPERLINK("x")', product: '+1', yield: '-2', source: '@cmd', contributor: 'A "B"', organization: null },
    ]);
    expect(csv.split('\n')[1]).toBe(`"'=HYPERLINK(""x"")","'+1","'-2","'@cmd","A ""B""",""`);
  });
});

// ---------------------------------------------------------------------------
// SQLite adapter — real query against an in-memory database
// ---------------------------------------------------------------------------

describe.skipIf(!sqlite3)('SQLite adapter listSharedYieldRows + handler', () => {
  let db;
  let makeSqliteAdapter;

  const run = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, (err) => (err ? reject(err) : resolve()));
  });

  beforeEach(async () => {
    ({ makeSqliteAdapter } = require('../../../../server/adapters/sqliteDb.js'));
    db = new sqlite3.Database(':memory:');
    await run('CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, firebase_uid TEXT, email TEXT)');
    await run(`CREATE TABLE user_data (id INTEGER PRIMARY KEY, user_id INTEGER, species TEXT, product TEXT,
               yield REAL, source TEXT, is_shared INTEGER DEFAULT 0)`);
    await run(`CREATE TABLE contributors (id INTEGER PRIMARY KEY, user_id INTEGER UNIQUE, display_name TEXT,
               organization TEXT, bio TEXT, show_on_page INTEGER DEFAULT 1)`);
    await run("INSERT INTO users VALUES (1, 'fisher@example.com', 'uid-secret-123', 'fisher@example.com')");
    await run("INSERT INTO users VALUES (2, 'private@example.com', 'hidden-uid-456', 'private@example.com')");
    await run("INSERT INTO users VALUES (3, 'dana@example.com', 'uid-dana', 'dana@example.com')");
    await run("INSERT INTO contributors (user_id, display_name, organization, show_on_page) VALUES (2, 'Quiet Skipper', 'Hidden Co-op', 0)");
    await run("INSERT INTO contributors (user_id, display_name, organization, show_on_page) VALUES (3, 'Deckhand Dana', 'Sitka Fishers', 1)");
    await run("INSERT INTO user_data VALUES (1, 1, 'Cod', 'Fillet', 40, 'Dock test', 1)");
    await run("INSERT INTO user_data VALUES (2, 2, 'Halibut', 'Steak', 55, NULL, 1)");
    await run("INSERT INTO user_data VALUES (3, 3, 'Pink Salmon', 'Skinless Fillet', 42, 'MAB-37', 1)");
    await run("INSERT INTO user_data VALUES (4, 3, 'Albacore', 'Loin', 60, 'Unshared secret', 0)");
    await run("INSERT INTO user_data (id, user_id, species, product, yield, source) VALUES (5, 1, 'Black Cod', 'D/H-Off', 65, 'Default unshared')");
  });

  afterEach(() => new Promise((resolve) => db.close(resolve)));

  it('selects no account identifiers and excludes unshared rows', async () => {
    const rows = await makeSqliteAdapter(db).listSharedYieldRows();
    expect(rows.map((r) => r.id)).toEqual([1, 2, 3]);
    for (const row of rows) {
      for (const key of FORBIDDEN_KEYS) expect(row).not.toHaveProperty(key);
    }
    assertNoIdentifiers(rows);
  });

  it('produces the same shapes as the handler contract in JSON and CSV', async () => {
    const adapter = makeSqliteAdapter(db);
    const json = await handleListCommunityData({}, adapter);
    expect(json.body).toEqual([
      { id: 1, species: 'Cod', product: 'Fillet', yield: 40, source: 'Dock test', contributor: null, organization: null },
      { id: 2, species: 'Halibut', product: 'Steak', yield: 55, source: null, contributor: null, organization: null },
      { id: 3, species: 'Pink Salmon', product: 'Skinless Fillet', yield: 42, source: 'MAB-37', contributor: 'Deckhand Dana', organization: 'Sitka Fishers' },
    ]);
    assertNoIdentifiers(json.body);

    const csv = await handleListCommunityData({ format: 'csv' }, adapter);
    assertNoIdentifiers(csv.body);
    expect(csv.body).not.toContain('Albacore');
    expect(csv.body).not.toContain('Black Cod');
    expect(csv.body).not.toContain('Quiet Skipper');
  });
});

// ---------------------------------------------------------------------------
// Neon adapter — SQL text (query function mocked)
// ---------------------------------------------------------------------------

describe('Neon adapter listSharedYieldRows', () => {
  it('filters on is_shared and never selects account identifiers', async () => {
    const { query } = await import('../../../../api/_lib/db.js');
    const { makeNeonAdapter } = await import('../../../../api/_lib/neonDb.js');
    query.mockResolvedValueOnce({ rows: [PUBLIC_PROFILE_ROW] });

    const rows = await makeNeonAdapter().listSharedYieldRows();

    expect(rows).toEqual([PUBLIC_PROFILE_ROW]);
    const sql = query.mock.calls.at(-1)[0];
    expect(sql).toMatch(/WHERE ud\.is_shared = true/);
    expect(sql).not.toMatch(/username|email|firebase_uid/i);
    expect(sql).not.toMatch(/JOIN users/i);
    // user_id appears only in the join condition, never in the SELECT list.
    const selectList = sql.slice(sql.indexOf('SELECT'), sql.indexOf('FROM'));
    expect(selectList).not.toMatch(/user_id/);
  });
});
