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
      name: 'Fish Buyer',
      picture: 'https://example.com/avatar.png',
    });
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
