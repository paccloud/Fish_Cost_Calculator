/**
 * Neon (Postgres) data-layer adapter.
 *
 * Exposes the DbAdapter interface (shared/db/interface.js) over the Neon
 * serverless pool used by Vercel functions.
 *
 * Module system: ESM — compatible with api/*.js (Vercel serverless, ESM).
 *
 * @module api/_lib/neonDb
 */

import { query } from './db.js';
import { ERR_DUPLICATE_USER } from '../../shared/db/interface.js';

/**
 * Build the Neon DbAdapter (stateless — delegates to the shared Neon pool).
 *
 * @returns {import('../../shared/db/interface.js').DbAdapter}
 */
export function makeNeonAdapter() {
  return {
    /**
     * Find a user by username.
     * @param {string} username
     * @returns {Promise<{id: string|number, username: string, password: string}|null>}
     */
    async findUserByUsername(username) {
      const result = await query(
        'SELECT id, username, password FROM users WHERE username = $1',
        [username]
      );
      return result.rows[0] ?? null;
    },

    /**
     * Create a user.  Translates Postgres unique-constraint violation (23505)
     * to ERR_DUPLICATE_USER so the handler core stays driver-agnostic.
     *
     * @param {string} username
     * @param {string} hashedPassword
     * @returns {Promise<{id: string|number, username: string}>}
     */
    async createUser(username, hashedPassword) {
      try {
        const result = await query(
          'INSERT INTO users (username, password) VALUES ($1, $2) RETURNING id, username',
          [username, hashedPassword]
        );
        return result.rows[0];
      } catch (err) {
        if (err.code === '23505') {
          const dupErr = new Error('Username already exists');
          dupErr.code = ERR_DUPLICATE_USER;
          throw dupErr;
        }
        throw err;
      }
    },
  };
}
