/**
 * SQLite data-layer adapter.
 *
 * Exposes the DbAdapter interface (shared/db/interface.js) over the
 * callback-based sqlite3 driver used by the local Express server.
 *
 * Module system: this file uses CommonJS (require/module.exports) so it can
 * be required directly by server.js without any module-system bridging.
 * It does NOT import from the ESM shared/ tree — the ERR_DUPLICATE_USER
 * sentinel is re-declared here to avoid a CJS→ESM require() call, which
 * would need a dynamic import() and complicate the adapter.
 *
 * @module server/adapters/sqliteDb
 */

'use strict';

// Mirror of shared/db/interface.js ERR_DUPLICATE_USER — kept in sync by value.
const ERR_DUPLICATE_USER = 'DUPLICATE_USER';

/**
 * Wrap sqlite3's callback API in promises so the DbAdapter interface is async.
 *
 * @param {import('sqlite3').Database} db - Open sqlite3 database instance
 * @returns {import('../../shared/db/interface.js').DbAdapter}
 */
function makeSqliteAdapter(db) {
  return {
    /**
     * Find a user by username.
     * @param {string} username
     * @returns {Promise<{id: number, username: string, password: string}|null>}
     */
    findUserByUsername(username) {
      return new Promise((resolve, reject) => {
        db.get('SELECT * FROM users WHERE username = ?', [username], (err, row) => {
          if (err) return reject(err);
          resolve(row ?? null);
        });
      });
    },

    /**
     * Create a user.  Translates SQLite's SQLITE_CONSTRAINT_UNIQUE code to
     * ERR_DUPLICATE_USER so the handler core stays driver-agnostic.
     *
     * @param {string} username
     * @param {string} hashedPassword
     * @returns {Promise<{id: number|string, username: string}>}
     */
    createUser(username, hashedPassword) {
      return new Promise((resolve, reject) => {
        db.run(
          'INSERT INTO users (username, password) VALUES (?, ?)',
          [username, hashedPassword],
          function callback(err) {
            if (err) {
              // SQLite unique-constraint error code
              if (err.code === 'SQLITE_CONSTRAINT' || (err.message && err.message.includes('UNIQUE'))) {
                const dupErr = new Error('Username already exists');
                dupErr.code = ERR_DUPLICATE_USER;
                return reject(dupErr);
              }
              return reject(err);
            }
            resolve({ id: this.lastID, username });
          }
        );
      });
    },
  };
}

module.exports = { makeSqliteAdapter, ERR_DUPLICATE_USER };
