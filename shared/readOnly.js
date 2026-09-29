/**
 * API read-only mode for the move to Firebase (ADR 0001, issue #130).
 *
 * With API_READ_ONLY=true, both backends answer every write with 503 and keep
 * serving reads, so nothing in the database changes while it is copied.
 * Sign-in stays open so people can still read their data.
 *
 * 503 (not 4xx) is deliberate: the old client's sync treats it as temporary
 * and keeps the change queued, so it can still be saved to a file.
 */

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const READ_ONLY_STATUS = 503;

export const READ_ONLY_BODY = Object.freeze({
  error: 'read_only',
  message: 'Local Catch is moving to a new address and no longer accepts changes here. Your data is safe.',
});

export function isApiReadOnly(env = process.env) {
  return TRUE_VALUES.has(String(env.API_READ_ONLY ?? '').trim().toLowerCase());
}

/** True when a request must be refused because the API is read-only. */
export function isBlockedWrite(method, { readOnly = isApiReadOnly(), allowWrite = false } = {}) {
  if (!readOnly || allowWrite) return false;
  return !SAFE_METHODS.has(String(method || '').toUpperCase());
}
