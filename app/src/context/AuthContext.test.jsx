import React from 'react';
import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AuthProvider, useAuth } from './AuthContext.jsx';

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function legacyJwt(payload) {
  return `${base64urlJson({ alg: 'HS256', typ: 'JWT' })}.${base64urlJson(payload)}.signature`;
}

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key) => values.get(key) ?? null),
    setItem: vi.fn((key, value) => values.set(key, value)),
    removeItem: vi.fn((key) => values.delete(key)),
  };
}

function renderAuthState(providerProps = {}) {
  let authState;

  function Probe() {
    // eslint-disable-next-line react-hooks/globals -- test probe captures context for assertions after server render.
    authState = useAuth();
    return null;
  }

  renderToStaticMarkup(
    <AuthProvider {...providerProps}>
      <Probe />
    </AuthProvider>
  );

  return authState;
}

describe('AuthProvider session rehydration', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rehydrates a valid legacy JWT session during Firebase migration', () => {
    const token = legacyJwt({
      id: 42,
      username: 'fishbuyer@example.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    vi.stubGlobal('localStorage', createStorage({ token }));

    const authState = renderAuthState();

    expect(authState.token).toBe(token);
    expect(authState.user).toMatchObject({
      id: 42,
      username: 'fishbuyer@example.com',
      authProvider: 'password',
    });
  });

  it('rehydrates Firebase sessions and exposes the user in context', () => {
    // onAuthFailure is now wired post-mount via user.setOnAuthFailure() in useLayoutEffect
    // (not passed through loadFirebaseSession options at init time). This SSR-only test
    // verifies the session loads correctly; the setOnAuthFailure wiring is covered by
    // DOM-environment integration tests.
    const setOnAuthFailure = vi.fn();
    const fakeUser = { uid: 'u1', username: 'fishbuyer', authProvider: 'firebase', setOnAuthFailure };

    const authState = renderAuthState({
      authApi: {
        clearFirebaseSession: vi.fn(),
        loadFirebaseSession: vi.fn(() => fakeUser),
        signInWithEmailPassword: vi.fn(),
        signUpWithEmailPassword: vi.fn(),
        sendEmailVerification: vi.fn(),
        createGoogleAuthUri: vi.fn(),
        signInWithGoogleCallback: vi.fn(),
      },
    });

    expect(authState.user).toBe(fakeUser);
  });

  it('rejects email login when firebaseUser.emailVerified is false', async () => {
    const clearFirebaseSession = vi.fn();
    const unverifiedUser = { uid: 'u1', email: 'buyer@example.com', emailVerified: false };

    const authState = renderAuthState({
      authApi: {
        clearFirebaseSession,
        loadFirebaseSession: vi.fn(() => null),
        signInWithEmailPassword: vi.fn(async () => unverifiedUser),
        signUpWithEmailPassword: vi.fn(),
        sendEmailVerification: vi.fn(),
        createGoogleAuthUri: vi.fn(),
        signInWithGoogleCallback: vi.fn(),
      },
    });

    await expect(
      authState.login('buyer@example.com', 'password123')
    ).rejects.toThrow('Please verify your email before signing in.');

    expect(clearFirebaseSession).toHaveBeenCalledOnce();
  });

  it('propagates Firebase register errors to the caller', async () => {
    const authState = renderAuthState({
      authApi: {
        clearFirebaseSession: vi.fn(),
        loadFirebaseSession: vi.fn(() => null),
        signInWithEmailPassword: vi.fn(),
        signUpWithEmailPassword: vi.fn(async () => {
          throw new Error('WEAK_PASSWORD');
        }),
      },
    });

    await expect(authState.register('fishbuyer@example.com', 'short')).rejects.toThrow('WEAK_PASSWORD');
  });
});
