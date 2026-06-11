/**
 * Transport-agnostic register handler.
 *
 * Accepts a plain request envelope and a DbAdapter, returns a plain response
 * envelope.  No Express, Vercel, or driver types appear in this module —
 * a Cloudflare Workers adapter (issue #15) can satisfy the same seam.
 *
 * Drift resolved from the dual-backend state:
 *   - Explicit presence validation for username AND password (was missing in
 *     the local Express server).
 *   - Duplicate-user detection via ERR_DUPLICATE_USER sentinel (distinct from
 *     generic failure).
 *   - Sanitized error responses — raw driver messages never reach the caller.
 *
 * @module shared/handlers/register
 */

import bcrypt from 'bcrypt';
import { ERR_DUPLICATE_USER } from '../db/interface.js';

const BCRYPT_ROUNDS = 10;

/**
 * @typedef {Object} RegisterRequest
 * @property {unknown} [username]
 * @property {unknown} [password]
 */

/**
 * @typedef {Object} RegisterResponse
 * @property {number}  status                 HTTP status code
 * @property {Object}  body                   JSON-serialisable body
 * @property {string}  [body.error]           Present on failure
 * @property {string|number} [body.id]        Present on success
 * @property {string}  [body.username]        Present on success
 */

/**
 * Handle a registration request.
 *
 * @param {RegisterRequest} input
 * @param {import('../db/interface.js').DbAdapter} db
 * @returns {Promise<RegisterResponse>}
 */
export async function handleRegister(input, db) {
  const { username, password } = input;

  // Presence validation — production shape: 400 with explicit message
  if (!username || typeof username !== 'string' || username.trim() === '') {
    return { status: 400, body: { error: 'Username is required' } };
  }
  if (!password || typeof password !== 'string' || password.trim() === '') {
    return { status: 400, body: { error: 'Password is required' } };
  }

  try {
    const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = await db.createUser(username.trim(), hashedPassword);
    return { status: 201, body: { id: user.id, username: user.username } };
  } catch (err) {
    if (err.code === ERR_DUPLICATE_USER) {
      return { status: 409, body: { error: 'Username already exists' } };
    }
    // Sanitize: log the real error server-side, return a generic message
    console.error('[register] unexpected error:', err.message ?? err);
    return { status: 500, body: { error: 'Registration failed' } };
  }
}
