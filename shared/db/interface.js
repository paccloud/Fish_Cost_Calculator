/**
 * Data-layer interface for the handler core.
 *
 * Both the SQLite adapter (server/) and the Neon adapter (api/) expose this
 * same shape so handler logic never depends on a specific driver.
 *
 * @module shared/db/interface
 */

/**
 * @typedef {Object} DbUser
 * @property {number|string} id
 * @property {string} username
 */

/**
 * @typedef {Object} DbAdapter
 *
 * @property {function(string): Promise<DbUser|null>} findUserByUsername
 *   Return the user row matching username, or null if not found.
 *
 * @property {function(string, string): Promise<DbUser>} createUser
 *   Insert a new user (username, hashedPassword) and return {id, username}.
 *   Throws an error with code 'DUPLICATE_USER' when the username is already
 *   taken (adapters normalise driver-specific constraint codes to this value).
 */

/**
 * Sentinel error code thrown by createUser when username is already taken.
 * Adapters translate driver-specific constraint codes (e.g. SQLite SQLITE_CONSTRAINT,
 * Postgres 23505) to this value so the handler core stays transport-agnostic.
 *
 * @constant {string}
 */
export const ERR_DUPLICATE_USER = 'DUPLICATE_USER';
