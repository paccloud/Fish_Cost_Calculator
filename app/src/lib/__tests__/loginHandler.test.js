/**
 * Backend handler core tests — login endpoint.
 *
 * Exercises the transport-agnostic handler (shared/handlers/login.js) through
 * a faked data layer and config object.  No Express, Vercel, SQLite, or Neon
 * types appear here.
 *
 * Test runner: Vitest (run via `cd app && npm test`)
 */

import { describe, it, expect, vi } from 'vitest';
import { handleLogin } from '../../../../shared/handlers/login.js';
import bcrypt from 'bcrypt';

const VALID_SECRET = 'test-jwt-secret-32chars-minimum!!';
const VALID_CONFIG = { jwtSecret: VALID_SECRET, tokenExpirySeconds: 86400 };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeHashedPassword(plain = 'correct-horse') {
  return bcrypt.hash(plain, 1); // low rounds for test speed
}

/**
 * @param {Partial<import('../../../../../shared/db/interface.js').DbAdapter>} overrides
 */
function makeFakeDb(overrides = {}) {
  return {
    findUserByUsername: vi.fn().mockResolvedValue(null),
    createUser: vi.fn(),
    listSavedCalcs: vi.fn().mockResolvedValue([]),
    saveCalc: vi.fn(),
    findCalcById: vi.fn().mockResolvedValue(null),
    deleteCalc: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Validation — missing credentials
// ---------------------------------------------------------------------------

describe('handleLogin — validation', () => {
  it('returns 400 when username is missing', async () => {
    const db = makeFakeDb();
    const result = await handleLogin({ password: 'pw' }, db, VALID_CONFIG);
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/required/i);
  });

  it('returns 400 when password is missing', async () => {
    const db = makeFakeDb();
    const result = await handleLogin({ username: 'alice' }, db, VALID_CONFIG);
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/required/i);
  });

  it('returns 400 when username is empty string', async () => {
    const db = makeFakeDb();
    const result = await handleLogin({ username: '  ', password: 'pw' }, db, VALID_CONFIG);
    expect(result.status).toBe(400);
  });

  it('returns 400 when password is empty string', async () => {
    const db = makeFakeDb();
    const result = await handleLogin({ username: 'alice', password: '' }, db, VALID_CONFIG);
    expect(result.status).toBe(400);
  });

  it('returns 400 when both are missing', async () => {
    const db = makeFakeDb();
    const result = await handleLogin({}, db, VALID_CONFIG);
    expect(result.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Server misconfiguration
// ---------------------------------------------------------------------------

describe('handleLogin — misconfiguration', () => {
  it('returns 500 when jwtSecret is absent', async () => {
    const db = makeFakeDb();
    const result = await handleLogin(
      { username: 'alice', password: 'pw' },
      db,
      { jwtSecret: undefined }
    );
    expect(result.status).toBe(500);
    expect(result.body.error).toMatch(/misconfigured/i);
  });

  it('returns 500 when config is null', async () => {
    const db = makeFakeDb();
    const result = await handleLogin({ username: 'alice', password: 'pw' }, db, null);
    expect(result.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Auth — user not found / wrong password
// ---------------------------------------------------------------------------

describe('handleLogin — invalid credentials', () => {
  it('returns 401 when user is not found', async () => {
    const db = makeFakeDb({ findUserByUsername: vi.fn().mockResolvedValue(null) });
    const result = await handleLogin({ username: 'nobody', password: 'pw' }, db, VALID_CONFIG);
    expect(result.status).toBe(401);
    expect(result.body.error).toBe('Invalid credentials');
  });

  it('returns 401 when password does not match', async () => {
    const hash = await makeHashedPassword('correct');
    const db = makeFakeDb({
      findUserByUsername: vi.fn().mockResolvedValue({ id: 1, username: 'alice', password: hash }),
    });
    const result = await handleLogin({ username: 'alice', password: 'wrong' }, db, VALID_CONFIG);
    expect(result.status).toBe(401);
    expect(result.body.error).toBe('Invalid credentials');
  });

  it('returns 401 for wrong password (same message as user-not-found — no enumeration)', async () => {
    const hash = await makeHashedPassword('correct');
    const dbNotFound = makeFakeDb({ findUserByUsername: vi.fn().mockResolvedValue(null) });
    const dbWrongPw = makeFakeDb({
      findUserByUsername: vi.fn().mockResolvedValue({ id: 1, username: 'alice', password: hash }),
    });
    const [notFoundResult, wrongPwResult] = await Promise.all([
      handleLogin({ username: 'alice', password: 'bad' }, dbNotFound, VALID_CONFIG),
      handleLogin({ username: 'alice', password: 'bad' }, dbWrongPw, VALID_CONFIG),
    ]);
    expect(notFoundResult.body.error).toBe(wrongPwResult.body.error);
  });
});

// ---------------------------------------------------------------------------
// Success shape
// ---------------------------------------------------------------------------

describe('handleLogin — success', () => {
  it('returns 200 with token, username, expiresIn on success', async () => {
    const plain = 'correct-horse';
    const hash = await makeHashedPassword(plain);
    const db = makeFakeDb({
      findUserByUsername: vi.fn().mockResolvedValue({ id: 7, username: 'alice', password: hash }),
    });
    const result = await handleLogin({ username: 'alice', password: plain }, db, VALID_CONFIG);
    expect(result.status).toBe(200);
    expect(typeof result.body.token).toBe('string');
    expect(result.body.username).toBe('alice');
    expect(result.body.expiresIn).toBe(86400);
  });

  it('JWT payload contains id and username', async () => {
    const plain = 'secret';
    const hash = await makeHashedPassword(plain);
    const db = makeFakeDb({
      findUserByUsername: vi.fn().mockResolvedValue({ id: 42, username: 'bob', password: hash }),
    });
    const result = await handleLogin({ username: 'bob', password: plain }, db, VALID_CONFIG);

    // Decode without verifying signature to check payload
    const { default: jwt } = await import('jsonwebtoken');
    const payload = jwt.decode(result.body.token);
    expect(payload.id).toBe(42);
    expect(payload.username).toBe('bob');
  });

  it('does not include password in the response body', async () => {
    const plain = 'pw';
    const hash = await makeHashedPassword(plain);
    const db = makeFakeDb({
      findUserByUsername: vi.fn().mockResolvedValue({ id: 1, username: 'alice', password: hash }),
    });
    const result = await handleLogin({ username: 'alice', password: plain }, db, VALID_CONFIG);
    expect(result.body.password).toBeUndefined();
  });

  it('uses the tokenExpirySeconds from config', async () => {
    const plain = 'pw';
    const hash = await makeHashedPassword(plain);
    const db = makeFakeDb({
      findUserByUsername: vi.fn().mockResolvedValue({ id: 1, username: 'alice', password: hash }),
    });
    const result = await handleLogin(
      { username: 'alice', password: plain },
      db,
      { jwtSecret: VALID_SECRET, tokenExpirySeconds: 3600 }
    );
    expect(result.body.expiresIn).toBe(3600);
  });

  it('trims username before looking up the user', async () => {
    const plain = 'pw';
    const hash = await makeHashedPassword(plain);
    const db = makeFakeDb({
      findUserByUsername: vi.fn().mockResolvedValue({ id: 1, username: 'alice', password: hash }),
    });
    await handleLogin({ username: '  alice  ', password: plain }, db, VALID_CONFIG);
    expect(db.findUserByUsername).toHaveBeenCalledWith('alice');
  });
});

// ---------------------------------------------------------------------------
// Sanitized error on db failure
// ---------------------------------------------------------------------------

describe('handleLogin — unexpected errors', () => {
  it('returns 500 with a generic message when db throws', async () => {
    const db = makeFakeDb({
      findUserByUsername: vi.fn().mockRejectedValue(new Error('connection pool exhausted: details')),
    });
    const result = await handleLogin({ username: 'alice', password: 'pw' }, db, VALID_CONFIG);
    expect(result.status).toBe(500);
    expect(result.body.error).not.toMatch(/pool/i);
    expect(result.body.error).not.toMatch(/details/i);
    expect(typeof result.body.error).toBe('string');
  });
});
