/**
 * Public contributors listing tests (issue #115).
 *
 * Fake DbAdapter for the handler allowlist, Neon SQL text with the query
 * function mocked, and the real SQLite adapter against an in-memory database
 * (self-skips when server/ dependencies are absent).
 */

import { createRequire } from 'node:module';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleListContributors } from '../../../../shared/handlers/publicEndpoints.js';
import { shapeContributor } from '../../../../shared/handlers/contributorsList.js';

vi.mock('../../../../api/_lib/db.js', () => ({ query: vi.fn() }));

const require = createRequire(import.meta.url);
let sqlite3 = null;
try {
  sqlite3 = require('../../../../server/node_modules/sqlite3');
} catch {
  sqlite3 = null;
}

const KEYS = ['bio', 'contribution_count', 'display_name', 'id', 'organization'];
const FORBIDDEN_KEYS = ['username', 'email', 'user_id', 'firebase_uid', 'created_at', 'updated_at', 'show_on_page'];
const FORBIDDEN_VALUES = ['fisher@example.com', 'uid-secret-123'];

const LEAKY_ROW = {
  id: 3, display_name: 'Deckhand Dana', organization: 'Sitka Fishers', bio: 'Hi', contribution_count: '4',
  username: 'fisher@example.com', email: 'fisher@example.com', user_id: 7, firebase_uid: 'uid-secret-123',
  created_at: '2026-01-01', updated_at: '2026-02-02', show_on_page: true,
};

function assertClean(body) {
  const json = JSON.stringify(body);
  for (const v of FORBIDDEN_VALUES) expect(json).not.toContain(v);
  for (const row of body) for (const k of FORBIDDEN_KEYS) expect(row).not.toHaveProperty(k);
}

describe('handleListContributors allowlist', () => {
  it('drops planted identifiers and emits the exact key set', async () => {
    const db = { listContributors: vi.fn().mockResolvedValue([LEAKY_ROW]) };
    const result = await handleListContributors({}, db);
    expect(result.status).toBe(200);
    assertClean(result.body);
    expect(Object.keys(result.body[0]).sort()).toEqual(KEYS);
    expect(result.body[0]).toEqual({
      id: 3, display_name: 'Deckhand Dana', organization: 'Sitka Fishers', bio: 'Hi', contribution_count: 4,
    });
  });

  it('normalises contribution_count to a number', () => {
    expect(shapeContributor({ id: 1, display_name: 'A', contribution_count: '12' }).contribution_count).toBe(12);
    expect(shapeContributor({ id: 1, display_name: 'A', contribution_count: 5n }).contribution_count).toBe(5);
    expect(shapeContributor({ id: 1, display_name: 'A' }).contribution_count).toBe(0);
  });

  it('does not list blank or missing display names', async () => {
    const db = {
      listContributors: vi.fn().mockResolvedValue([
        { id: 1, display_name: '   ', contribution_count: 1 },
        { id: 2, display_name: null, contribution_count: 1 },
        { id: 3, display_name: ' Ok ', organization: '', bio: null, contribution_count: 1 },
      ]),
    };
    const result = await handleListContributors({}, db);
    expect(result.body).toEqual([
      { id: 3, display_name: 'Ok', organization: null, bio: null, contribution_count: 1 },
    ]);
  });

  it('rejects rows that explicitly are not opted in', () => {
    expect(shapeContributor({ ...LEAKY_ROW, show_on_page: 0 })).toBeNull();
    expect(shapeContributor({ ...LEAKY_ROW, show_on_page: false })).toBeNull();
    expect(shapeContributor({ ...LEAKY_ROW, show_on_page: 'true' })).toBeNull();
  });

  it('returns 500 with a generic message on adapter failure', async () => {
    const db = { listContributors: vi.fn().mockRejectedValue(new Error('boom')) };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await handleListContributors({}, db);
    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: 'Failed to fetch contributors' });
  });
});

describe('Neon adapter listContributors', () => {
  it('does not reference users, user_id in SELECT, or c.*', async () => {
    const { query } = await import('../../../../api/_lib/db.js');
    const { makeNeonAdapter } = await import('../../../../api/_lib/neonDb.js');
    query.mockResolvedValueOnce({ rows: [] });
    await makeNeonAdapter().listContributors();
    const sql = query.mock.calls.at(-1)[0];
    expect(sql).toMatch(/WHERE c\.show_on_page = true/);
    expect(sql).not.toMatch(/\busers\b/i);
    expect(sql).not.toMatch(/c\.\*/);
    expect(sql).not.toMatch(/username|email|firebase_uid/i);
    const selectList = sql.slice(sql.indexOf('SELECT'), sql.indexOf('FROM'));
    expect(selectList).not.toMatch(/user_id|created_at|updated_at/);
  });
});

describe.skipIf(!sqlite3)('SQLite adapter listContributors + handler', () => {
  let db;
  const run = (sql) => new Promise((resolve, reject) => {
    db.run(sql, [], (err) => (err ? reject(err) : resolve()));
  });

  beforeEach(async () => {
    const { makeSqliteAdapter } = require('../../../../server/adapters/sqliteDb.js');
    db = new sqlite3.Database(':memory:');
    db.adapter = makeSqliteAdapter(db);
    await run('CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, firebase_uid TEXT, email TEXT)');
    await run('CREATE TABLE user_data (id INTEGER PRIMARY KEY, user_id INTEGER, species TEXT)');
    await run(`CREATE TABLE contributors (id INTEGER PRIMARY KEY, user_id INTEGER UNIQUE, display_name TEXT,
               organization TEXT, bio TEXT, show_on_page INTEGER DEFAULT 1, created_at TEXT, updated_at TEXT)`);
    await run("INSERT INTO users VALUES (1, 'fisher@example.com', 'uid-secret-123', 'fisher@example.com')");
    await run("INSERT INTO users VALUES (2, 'hidden@example.com', 'uid-2', 'hidden@example.com')");
    await run("INSERT INTO users VALUES (3, 'blank@example.com', 'uid-3', 'blank@example.com')");
    await run("INSERT INTO users VALUES (4, 'zero@example.com', 'uid-4', 'zero@example.com')");
    await run("INSERT INTO contributors VALUES (10, 1, 'Deckhand Dana', 'Sitka Fishers', 'Hi', 1, 'x', 'y')");
    await run("INSERT INTO contributors VALUES (11, 2, 'Quiet Skipper', NULL, NULL, 0, 'x', 'y')");
    await run("INSERT INTO contributors VALUES (12, 3, '   ', NULL, NULL, 1, 'x', 'y')");
    await run("INSERT INTO contributors VALUES (13, 4, 'Newcomer', NULL, NULL, 1, 'x', 'y')");
    await run("INSERT INTO user_data VALUES (1, 1, 'Cod')");
    await run("INSERT INTO user_data VALUES (2, 1, 'Halibut')");
    await run("INSERT INTO user_data VALUES (3, 2, 'Sole')");
  });

  afterEach(() => new Promise((resolve) => db.close(resolve)));

  it('lists only opted-in, named profiles with the exact key set and counts', async () => {
    const result = await handleListContributors({}, db.adapter);
    expect(result.status).toBe(200);
    expect(result.body).toEqual([
      { id: 10, display_name: 'Deckhand Dana', organization: 'Sitka Fishers', bio: 'Hi', contribution_count: 2 },
      { id: 13, display_name: 'Newcomer', organization: null, bio: null, contribution_count: 0 },
    ]);
    for (const row of result.body) expect(Object.keys(row).sort()).toEqual(KEYS);
    assertClean(result.body);
  });

  it('adapter rows carry no account identifiers', async () => {
    const rows = await db.adapter.listContributors();
    expect(rows.map((r) => r.id)).toEqual([10, 12, 13]);
    for (const row of rows) for (const k of FORBIDDEN_KEYS) expect(row).not.toHaveProperty(k);
  });
});
