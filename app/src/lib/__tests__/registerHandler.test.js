/**
 * Backend handler core tests — register endpoint.
 *
 * These tests exercise the transport-agnostic handler (shared/handlers/register.js)
 * through a faked data layer.  No Express, Vercel, SQLite, or Neon types appear
 * here — the same test suite implicitly covers both adapters because both consume
 * the same core.
 *
 * Test runner: Vitest (run via `cd app && npm test`)
 * Location rationale: app/src/lib/__tests__/ — Vitest's default include glob
 * (`**\/*.{test,spec}.{js,jsx}`) picks this up automatically without config changes.
 * Backend-only tests must not import any browser/React globals; they don't.
 */

import { describe, it, expect, vi } from 'vitest';
import { handleRegister } from '../../../../shared/handlers/register.js';
import { ERR_DUPLICATE_USER } from '../../../../shared/db/interface.js';

// ---------------------------------------------------------------------------
// Fake DbAdapter factory — lets each test control exact behavior
// ---------------------------------------------------------------------------

/**
 * @param {Partial<import('../../../../../shared/db/interface.js').DbAdapter>} overrides
 */
function makeFakeDb(overrides = {}) {
  return {
    findUserByUsername: vi.fn().mockResolvedValue(null),
    createUser: vi.fn().mockResolvedValue({ id: 42, username: 'alice' }),
    ...overrides,
  };
}

function makeDuplicateError() {
  const err = new Error('Username already exists');
  err.code = ERR_DUPLICATE_USER;
  return err;
}

// ---------------------------------------------------------------------------
// Validation tests
// ---------------------------------------------------------------------------

describe('handleRegister — validation', () => {
  it('rejects when username is missing', async () => {
    const db = makeFakeDb();
    const result = await handleRegister({ password: 'secret' }, db);
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/username/i);
    expect(db.createUser).not.toHaveBeenCalled();
  });

  it('rejects when username is empty string', async () => {
    const db = makeFakeDb();
    const result = await handleRegister({ username: '   ', password: 'secret' }, db);
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/username/i);
  });

  it('rejects when password is missing', async () => {
    const db = makeFakeDb();
    const result = await handleRegister({ username: 'alice' }, db);
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/password/i);
    expect(db.createUser).not.toHaveBeenCalled();
  });

  it('rejects when password is empty string', async () => {
    const db = makeFakeDb();
    const result = await handleRegister({ username: 'alice', password: '' }, db);
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/password/i);
  });

  it('rejects when both fields are missing', async () => {
    const db = makeFakeDb();
    const result = await handleRegister({}, db);
    expect(result.status).toBe(400);
    expect(db.createUser).not.toHaveBeenCalled();
  });

  it('rejects non-string username', async () => {
    const db = makeFakeDb();
    const result = await handleRegister({ username: 123, password: 'secret' }, db);
    expect(result.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Duplicate-user detection
// ---------------------------------------------------------------------------

describe('handleRegister — duplicate user', () => {
  it('returns 409 with a sanitized message when username is taken', async () => {
    const db = makeFakeDb({
      createUser: vi.fn().mockRejectedValue(makeDuplicateError()),
    });
    const result = await handleRegister({ username: 'alice', password: 'secret' }, db);
    expect(result.status).toBe(409);
    expect(result.body.error).toMatch(/already exists/i);
  });

  it('does not leak raw driver error text on duplicate', async () => {
    const db = makeFakeDb({
      createUser: vi.fn().mockRejectedValue(makeDuplicateError()),
    });
    const result = await handleRegister({ username: 'alice', password: 'secret' }, db);
    // Should not expose internal constraint details
    expect(result.body.error).not.toMatch(/constraint/i);
    expect(result.body.error).not.toMatch(/23505/);
    expect(result.body.error).not.toMatch(/SQLITE/i);
  });
});

// ---------------------------------------------------------------------------
// Success shape
// ---------------------------------------------------------------------------

describe('handleRegister — success', () => {
  it('returns 201 with id and username on success', async () => {
    const db = makeFakeDb({
      createUser: vi.fn().mockResolvedValue({ id: 7, username: 'alice' }),
    });
    const result = await handleRegister({ username: 'alice', password: 'correct-horse' }, db);
    expect(result.status).toBe(201);
    expect(result.body.id).toBe(7);
    expect(result.body.username).toBe('alice');
  });

  it('calls createUser with trimmed username', async () => {
    const db = makeFakeDb();
    await handleRegister({ username: '  alice  ', password: 'pw' }, db);
    const [calledUsername] = db.createUser.mock.calls[0];
    expect(calledUsername).toBe('alice');
  });

  it('does not return the hashed password in the response', async () => {
    const db = makeFakeDb({
      createUser: vi.fn().mockResolvedValue({ id: 1, username: 'bob' }),
    });
    const result = await handleRegister({ username: 'bob', password: 'pw' }, db);
    expect(result.body.password).toBeUndefined();
    expect(result.body.hashedPassword).toBeUndefined();
  });

  it('passes a bcrypt-hashed password to createUser, not the plaintext', async () => {
    const db = makeFakeDb();
    await handleRegister({ username: 'carol', password: 'plaintext' }, db);
    const [, hashedArg] = db.createUser.mock.calls[0];
    expect(hashedArg).not.toBe('plaintext');
    // bcrypt hashes start with $2b$
    expect(hashedArg).toMatch(/^\$2[ab]\$/);
  });
});

// ---------------------------------------------------------------------------
// Generic server error (sanitization)
// ---------------------------------------------------------------------------

describe('handleRegister — unexpected errors', () => {
  it('returns 500 with a generic message on unexpected db failure', async () => {
    const db = makeFakeDb({
      createUser: vi.fn().mockRejectedValue(new Error('connection pool exhausted: pg details')),
    });
    const result = await handleRegister({ username: 'alice', password: 'pw' }, db);
    expect(result.status).toBe(500);
    // Must not leak internal error text
    expect(result.body.error).not.toMatch(/pool/i);
    expect(result.body.error).not.toMatch(/pg details/i);
    expect(typeof result.body.error).toBe('string');
  });
});
