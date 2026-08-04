import { describe, expect, it, vi } from 'vitest';
import { Buffer } from 'node:buffer';
import { createSign, generateKeyPairSync } from 'node:crypto';
import {
  verifyFirebaseAuthSession,
  verifyFirebaseIdToken,
} from '../../../../api/_lib/firebase-auth.js';

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function createRs256Token({ kid, payload, privateKey }) {
  const header = base64urlJson({ alg: 'RS256', typ: 'JWT', kid });
  const body = base64urlJson(payload);
  const signingInput = `${header}.${body}`;
  const signature = createSign('RSA-SHA256')
    .update(signingInput)
    .end()
    .sign(privateKey)
    .toString('base64url');

  return `${signingInput}.${signature}`;
}

describe('Firebase ID token verification', () => {
  it('verifies a Firebase ID token with the project issuer, audience, and public cert', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const now = Math.floor(Date.now() / 1000);
    const token = createRs256Token({
      kid: 'firebase-test-key',
      privateKey,
      payload: {
        iss: 'https://securetoken.google.com/fish-calc-test',
        aud: 'fish-calc-test',
        sub: 'firebase-user-123',
        iat: now,
        exp: now + 3600,
        email: 'fishbuyer@example.com',
        email_verified: true,
        name: 'Fish Buyer',
        picture: 'https://example.com/avatar.png',
      },
    });

    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        'firebase-test-key': publicKey.export({ type: 'spki', format: 'pem' }),
      }),
      headers: {
        get: () => 'public, max-age=3600',
      },
    }));

    const user = await verifyFirebaseIdToken(token, {
      projectId: 'fish-calc-test',
      fetch,
    });

    expect(user).toEqual({
      uid: 'firebase-user-123',
      email: 'fishbuyer@example.com',
      emailVerified: true,
      name: 'Fish Buyer',
      picture: 'https://example.com/avatar.png',
    });
  });

  it('falls back to the last cached Firebase certs when refresh fails', async () => {
    vi.resetModules();
    const { verifyFirebaseIdToken: verifyWithFreshCache } = await import('../../../../api/_lib/firebase-auth.js');
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const now = Math.floor(Date.now() / 1000);
    const token = createRs256Token({
      kid: 'firebase-fallback-key',
      privateKey,
      payload: {
        iss: 'https://securetoken.google.com/fish-calc-test',
        aud: 'fish-calc-test',
        sub: 'firebase-user-123',
        iat: now,
        exp: now + 3600,
        email: 'fishbuyer@example.com',
        email_verified: true,
      },
    });
    const fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          'firebase-fallback-key': publicKey.export({ type: 'spki', format: 'pem' }),
        }),
        headers: {
          get: () => 'public, max-age=0',
        },
      })
      .mockRejectedValueOnce(new Error('cert refresh unavailable'));

    await expect(verifyWithFreshCache(token, {
      projectId: 'fish-calc-test',
      fetch,
    })).resolves.toMatchObject({
      uid: 'firebase-user-123',
      email: 'fishbuyer@example.com',
    });
    await expect(verifyWithFreshCache(token, {
      projectId: 'fish-calc-test',
      fetch,
    })).resolves.toMatchObject({
      uid: 'firebase-user-123',
      email: 'fishbuyer@example.com',
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('returns null for a token with a tampered signature', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const { privateKey: otherKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const now = Math.floor(Date.now() / 1000);
    const validToken = createRs256Token({
      kid: 'firebase-test-key',
      privateKey,
      payload: {
        iss: 'https://securetoken.google.com/fish-calc-test',
        aud: 'fish-calc-test',
        sub: 'firebase-user-123',
        iat: now,
        exp: now + 3600,
      },
    });
    // Retain validToken's header+payload; replace only the signature with one from otherKey
    const otherSignedToken = createRs256Token({
      kid: 'firebase-test-key',
      privateKey: otherKey,
      payload: {
        iss: 'https://securetoken.google.com/fish-calc-test',
        aud: 'fish-calc-test',
        sub: 'firebase-user-123',
        iat: now,
        exp: now + 3600,
      },
    });
    const tamperedToken = validToken.split('.').slice(0, 2).join('.') + '.' + otherSignedToken.split('.')[2];

    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        'firebase-test-key': publicKey.export({ type: 'spki', format: 'pem' }),
      }),
      headers: { get: () => 'public, max-age=3600' },
    }));

    await expect(verifyFirebaseIdToken(tamperedToken, { projectId: 'fish-calc-test', fetch })).resolves.toBeNull();
  });

  it('returns null for a token with a wrong issuer', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const now = Math.floor(Date.now() / 1000);
    const token = createRs256Token({
      kid: 'firebase-test-key',
      privateKey,
      payload: {
        iss: 'https://securetoken.google.com/wrong-project',
        aud: 'fish-calc-test',
        sub: 'firebase-user-123',
        iat: now,
        exp: now + 3600,
      },
    });

    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        'firebase-test-key': publicKey.export({ type: 'spki', format: 'pem' }),
      }),
      headers: { get: () => 'public, max-age=3600' },
    }));

    await expect(verifyFirebaseIdToken(token, { projectId: 'fish-calc-test', fetch })).resolves.toBeNull();
  });

  it('returns null for a token with a wrong audience', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const now = Math.floor(Date.now() / 1000);
    const token = createRs256Token({
      kid: 'firebase-test-key',
      privateKey,
      payload: {
        iss: 'https://securetoken.google.com/fish-calc-test',
        aud: 'wrong-project',
        sub: 'firebase-user-123',
        iat: now,
        exp: now + 3600,
      },
    });

    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        'firebase-test-key': publicKey.export({ type: 'spki', format: 'pem' }),
      }),
      headers: { get: () => 'public, max-age=3600' },
    }));

    await expect(verifyFirebaseIdToken(token, { projectId: 'fish-calc-test', fetch })).resolves.toBeNull();
  });

  it('returns null for an expired token (beyond clock-skew tolerance)', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const now = Math.floor(Date.now() / 1000);
    const token = createRs256Token({
      kid: 'firebase-test-key',
      privateKey,
      payload: {
        iss: 'https://securetoken.google.com/fish-calc-test',
        aud: 'fish-calc-test',
        sub: 'firebase-user-123',
        iat: now - 7200,
        exp: now - 3600,
      },
    });

    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        'firebase-test-key': publicKey.export({ type: 'spki', format: 'pem' }),
      }),
      headers: { get: () => 'public, max-age=3600' },
    }));

    await expect(verifyFirebaseIdToken(token, { projectId: 'fish-calc-test', fetch })).resolves.toBeNull();
  });
});

describe('Firebase API auth', () => {
  it('returns the local app user linked to a Firebase UID bearer token', async () => {
    const query = vi.fn().mockResolvedValueOnce({
      rows: [{ id: 42, username: 'fishbuyer@example.com', email: 'fishbuyer@example.com' }],
    });

    const req = {
      headers: {
        authorization: 'Bearer firebase-id-token',
      },
    };

    const user = await verifyFirebaseAuthSession(req, {
      query,
      verifyIdToken: vi.fn(async () => ({
        uid: 'firebase-user-123',
        email: 'fishbuyer@example.com',
        emailVerified: true,
        name: 'Fish Buyer',
        picture: 'https://example.com/avatar.png',
      })),
    });

    expect(user).toEqual({
      id: 42,
      username: 'fishbuyer@example.com',
      email: 'fishbuyer@example.com',
      authProvider: 'firebase',
    });
    expect(query).toHaveBeenCalledWith(
      'SELECT id, username, email FROM users WHERE firebase_uid = $1',
      ['firebase-user-123']
    );
  });

  it('links an existing local user by verified Firebase email', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          id: 42,
          username: 'fishbuyer',
          email: 'fishbuyer@example.com',
          firebase_uid: null,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 42 }] }); // UPDATE … RETURNING id succeeds

    const user = await verifyFirebaseAuthSession({
      headers: {
        authorization: 'Bearer firebase-id-token',
      },
    }, {
      query,
      verifyIdToken: vi.fn(async () => ({
        uid: 'firebase-user-123',
        email: 'fishbuyer@example.com',
        emailVerified: true,
        name: 'Fish Buyer',
        picture: 'https://example.com/avatar.png',
      })),
    });

    expect(user).toEqual({
      id: 42,
      username: 'fishbuyer',
      email: 'fishbuyer@example.com',
      authProvider: 'firebase',
    });
    expect(query).toHaveBeenCalledWith(
      'SELECT id, username, email, firebase_uid FROM users WHERE email = $1',
      ['fishbuyer@example.com']
    );
    expect(query).toHaveBeenCalledWith(
      'UPDATE users SET firebase_uid = $1, avatar_url = $2, auth_provider = $3 WHERE id = $4 AND firebase_uid IS NULL RETURNING id',
      ['firebase-user-123', 'https://example.com/avatar.png', 'firebase', 42]
    );
  });

  it('creates a new account when a verified Firebase email matches only a legacy username (not the email column)', async () => {
    // Previously, this path linked the Firebase account to the legacy row. That is
    // unsafe: a legacy user may have chosen an email-shaped username they don't own,
    // so auto-linking would expose their data to whoever verifies that address in
    // Firebase. The safe behaviour is to create a fresh Firebase account instead.
    const newRow = { id: 99, username: 'fishbuyer@example.com', email: 'fishbuyer@example.com' };
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })   // firebase_uid lookup: not found
      .mockResolvedValueOnce({ rows: [] })   // email column lookup: not found
      .mockResolvedValueOnce({ rows: [newRow] }); // INSERT new user

    const user = await verifyFirebaseAuthSession({
      headers: {
        authorization: 'Bearer firebase-id-token',
      },
    }, {
      query,
      verifyIdToken: vi.fn(async () => ({
        uid: 'firebase-user-123',
        email: 'fishbuyer@example.com',
        emailVerified: true,
        name: 'Fish Buyer',
        picture: 'https://example.com/avatar.png',
      })),
    });

    expect(user).toEqual({
      id: 99,
      username: 'fishbuyer@example.com',
      email: 'fishbuyer@example.com',
      authProvider: 'firebase',
    });
    // The username-match query must NOT be issued to prevent the account takeover vector
    expect(query).not.toHaveBeenCalledWith(
      'SELECT id, username, email, firebase_uid FROM users WHERE username = $1',
      ['fishbuyer@example.com']
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO users'),
      expect.arrayContaining(['firebase-user-123'])
    );
  });

  it('rejects unverified Firebase email sessions before creating a local user', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] });

    const user = await verifyFirebaseAuthSession({
      headers: {
        authorization: 'Bearer firebase-id-token',
      },
    }, {
      query,
      verifyIdToken: vi.fn(async () => ({
        uid: 'unverified-user-123',
        email: 'fishbuyer@example.com',
        emailVerified: false,
        name: 'Fish Buyer',
        picture: 'https://example.com/avatar.png',
      })),
    });

    expect(user).toBeNull();
    expect(query).not.toHaveBeenCalledWith(
      'SELECT id, username, email, firebase_uid FROM users WHERE email = $1',
      ['fishbuyer@example.com']
    );
    expect(query).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO users'),
      expect.anything()
    );
  });

  it('recovers from a concurrent sign-in race (23505 on firebase_uid) by re-selecting the winner row', async () => {
    const existingUser = { id: 77, username: 'fishbuyer@example.com', email: 'fishbuyer@example.com' };
    const uidConflict = Object.assign(new Error('duplicate key'), { code: '23505' });
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })        // firebase_uid lookup: not found
      .mockResolvedValueOnce({ rows: [] })        // email lookup: not found
      .mockRejectedValueOnce(uidConflict)          // INSERT: concurrent race → 23505
      .mockResolvedValueOnce({ rows: [existingUser] }); // re-select by firebase_uid: winner found

    const user = await verifyFirebaseAuthSession({
      headers: { authorization: 'Bearer firebase-id-token' },
    }, {
      query,
      verifyIdToken: vi.fn(async () => ({
        uid: 'firebase-user-123',
        email: 'fishbuyer@example.com',
        emailVerified: true,
        name: 'Fish Buyer',
        picture: 'https://example.com/avatar.png',
      })),
    });

    expect(user).toEqual({
      id: 77,
      username: 'fishbuyer@example.com',
      email: 'fishbuyer@example.com',
      authProvider: 'firebase',
    });
    // Verify the re-select query was issued after the 23505 error
    expect(query).toHaveBeenCalledWith(
      'SELECT id, username, email FROM users WHERE firebase_uid = $1',
      ['firebase-user-123']
    );
  });

  it('retries with a UID-based username when INSERT fails 23505 due to an email-username collision', async () => {
    const fallbackUser = { id: 88, username: 'firebase_firebase-us', email: 'fishbuyer@example.com' };
    const usernameConflict = Object.assign(new Error('duplicate key'), { code: '23505' });
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })         // firebase_uid lookup: not found
      .mockResolvedValueOnce({ rows: [] })         // email lookup: not found
      .mockRejectedValueOnce(usernameConflict)      // INSERT with email username: 23505
      .mockResolvedValueOnce({ rows: [] })         // re-select by firebase_uid: not a race
      .mockResolvedValueOnce({ rows: [fallbackUser] }); // INSERT with UID-based username: success

    const user = await verifyFirebaseAuthSession({
      headers: { authorization: 'Bearer firebase-id-token' },
    }, {
      query,
      verifyIdToken: vi.fn(async () => ({
        uid: 'firebase-user-123',
        email: 'fishbuyer@example.com',
        emailVerified: true,
        name: 'Fish Buyer',
        picture: 'https://example.com/avatar.png',
      })),
    });

    expect(user).toEqual({
      id: 88,
      username: 'firebase_firebase-us',
      email: 'fishbuyer@example.com',
      authProvider: 'firebase',
    });
    // Both INSERT calls should have been made
    expect(query).toHaveBeenCalledTimes(5);
  });
});

describe('API auth middleware integration', () => {
  it('accepts a Firebase-authenticated request as the protected route user', async () => {
    vi.resetModules();
    vi.stubEnv('JWT_SECRET', 'test-jwt-secret-32chars-minimum!!');

    vi.doMock('../../../../api/_lib/db.js', () => ({
      query: vi.fn(),
    }));
    vi.doMock('../../../../api/_lib/firebase-auth.js', () => ({
      verifyFirebaseAuthSession: vi.fn(async () => ({
        id: 42,
        username: 'fishbuyer@example.com',
        email: 'fishbuyer@example.com',
        authProvider: 'firebase',
      })),
    }));

    const { verifyUser } = await import('../../../../api/_lib/auth.js');

    const user = await verifyUser({
      headers: {
        authorization: 'Bearer firebase-id-token',
      },
    });

    expect(user).toEqual({
      id: 42,
      username: 'fishbuyer@example.com',
      email: 'fishbuyer@example.com',
      authProvider: 'firebase',
    });
  });
});
