/**
 * Transport-agnostic login handler.
 *
 * Accepts a plain request envelope, a DbAdapter, and a config object (for
 * JWT_SECRET and TOKEN_EXPIRY_SECONDS), returns a plain response envelope.
 * No Express, Vercel, or driver types appear in this module.
 *
 * Drift resolved from the dual-backend state:
 *   - Explicit presence validation for username AND password (was missing in
 *     the local Express server — server conflated db-error and missing-user).
 *   - Separate handling of db error vs. user-not-found (both map to 401 for
 *     the client, but internally distinguished so db errors are logged).
 *   - Sanitized error responses — raw driver messages never reach the caller.
 *   - 500 returned when JWT_SECRET is absent (production already did this;
 *     server relied on startup-time throw instead).
 *
 * @module shared/handlers/login
 */

import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

/**
 * @typedef {Object} LoginRequest
 * @property {unknown} [username]
 * @property {unknown} [password]
 */

/**
 * @typedef {Object} LoginConfig
 * @property {string}  jwtSecret          - JWT signing secret (JWT_SECRET env var)
 * @property {number}  [tokenExpirySeconds=86400] - Token TTL in seconds
 */

/**
 * @typedef {Object} LoginResponse
 * @property {number}  status
 * @property {Object}  body
 * @property {string}  [body.error]         Present on failure
 * @property {string}  [body.token]         Present on success
 * @property {string}  [body.username]      Present on success
 * @property {number}  [body.expiresIn]     Present on success (seconds)
 */

/**
 * Handle a login request.
 *
 * @param {LoginRequest} input
 * @param {import('../db/interface.js').DbAdapter} db
 * @param {LoginConfig} config
 * @returns {Promise<LoginResponse>}
 */
export async function handleLogin(input, db, config) {
  const { username, password } = input;
  const { jwtSecret, tokenExpirySeconds = 86400 } = config ?? {};

  // Guard: server must be properly configured
  if (!jwtSecret) {
    console.error('[login] JWT_SECRET is not configured');
    return { status: 500, body: { error: 'Server misconfigured' } };
  }

  // Presence validation — production shape: 400 with explicit message
  if (!username || typeof username !== 'string' || username.trim() === '') {
    return { status: 400, body: { error: 'Username and password are required' } };
  }
  if (!password || typeof password !== 'string' || password.trim() === '') {
    return { status: 400, body: { error: 'Username and password are required' } };
  }

  try {
    const user = await db.findUserByUsername(username.trim());

    if (!user) {
      // User not found — same response as wrong password to avoid enumeration
      return { status: 401, body: { error: 'Invalid credentials' } };
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return { status: 401, body: { error: 'Invalid credentials' } };
    }

    const token = jwt.sign(
      { id: user.id, username: user.username },
      jwtSecret,
      { expiresIn: `${tokenExpirySeconds}s` }
    );

    return {
      status: 200,
      body: { token, username: user.username, expiresIn: tokenExpirySeconds },
    };
  } catch (err) {
    console.error('[login] unexpected error:', err.message ?? err);
    return { status: 500, body: { error: 'Login failed' } };
  }
}
