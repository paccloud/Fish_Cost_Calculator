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

  it('falls back to legacy login when Firebase does not recognize an @-shaped username', async () => {
    const clearFirebaseSession = vi.fn();
    const notFoundErr = Object.assign(new Error('Invalid email or password.'), { firebaseCode: 'USER_NOT_FOUND' });
    const mockFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ token: 'legacy-jwt', username: 'fish@legacy.com' }),
    }));
    const storage = createStorage();
    vi.stubGlobal('fetch', mockFetch);
    vi.stubGlobal('localStorage', storage);

    const authState = renderAuthState({
      authApi: {
        clearFirebaseSession,
        loadFirebaseSession: vi.fn(() => null),
        signInWithEmailPassword: vi.fn(async () => { throw notFoundErr; }),
        signUpWithEmailPassword: vi.fn(),
        sendEmailVerification: vi.fn(),
        createGoogleAuthUri: vi.fn(),
        signInWithGoogleCallback: vi.fn(),
      },
    });

    const result = await authState.login('fish@legacy.com', 'pass');

    expect(result).toBe(true);
    expect(clearFirebaseSession).toHaveBeenCalled();
    // Verify the legacy JWT was stored — state updates don't propagate in SSR context
    expect(storage.setItem).toHaveBeenCalledWith('token', 'legacy-jwt');
  });

  it('does not fall back to legacy login when Firebase returns USER_DISABLED', async () => {
    const disabledErr = Object.assign(new Error('This account has been disabled.'), { firebaseCode: 'USER_DISABLED' });

    const authState = renderAuthState({
      authApi: {
        clearFirebaseSession: vi.fn(),
        loadFirebaseSession: vi.fn(() => null),
        signInWithEmailPassword: vi.fn(async () => { throw disabledErr; }),
        signUpWithEmailPassword: vi.fn(),
        sendEmailVerification: vi.fn(),
        createGoogleAuthUri: vi.fn(),
        signInWithGoogleCallback: vi.fn(),
      },
    });

    await expect(authState.login('disabled@example.com', 'pass')).rejects.toThrow('This account has been disabled.');
  });

  it('re-throws the Firebase error when both Firebase and legacy login fail', async () => {
    const notFoundErr = Object.assign(new Error('Invalid email or password.'), { firebaseCode: 'INVALID_LOGIN_CREDENTIALS' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    vi.stubGlobal('localStorage', createStorage());

    const authState = renderAuthState({
      authApi: {
        clearFirebaseSession: vi.fn(),
        loadFirebaseSession: vi.fn(() => null),
        signInWithEmailPassword: vi.fn(async () => { throw notFoundErr; }),
        signUpWithEmailPassword: vi.fn(),
        sendEmailVerification: vi.fn(),
        createGoogleAuthUri: vi.fn(),
        signInWithGoogleCallback: vi.fn(),
      },
    });

    await expect(authState.login('buyer@example.com', 'wrongpass')).rejects.toThrow('Invalid email or password.');
  });

  it('rejects Google sign-in when emailVerified is false and clears the session', async () => {
    const clearFirebaseSession = vi.fn();
    const unverifiedUser = {
      uid: 'google-uid',
      username: 'unverified@gmail.com',
      email: 'unverified@gmail.com',
      emailVerified: false,
      authProvider: 'firebase',
      setOnAuthFailure: vi.fn(),
      getIdToken: vi.fn(async () => 'google-id-token'),
    };
    const storage = createStorage({
      firebase_google_session_id: 'session-abc',
    });
    vi.stubGlobal('sessionStorage', storage);

    const authState = renderAuthState({
      authApi: {
        clearFirebaseSession,
        loadFirebaseSession: vi.fn(() => null),
        signInWithEmailPassword: vi.fn(),
        signUpWithEmailPassword: vi.fn(),
        sendEmailVerification: vi.fn(),
        createGoogleAuthUri: vi.fn(),
        signInWithGoogleCallback: vi.fn(async () => unverifiedUser),
      },
    });

    await expect(authState.completeGoogleSignIn()).rejects.toThrow('Please verify your email before signing in.');
    expect(clearFirebaseSession).toHaveBeenCalled();
  });

  it('completes Google sign-in when emailVerified is true', async () => {
    const clearFirebaseSession = vi.fn();
    const verifiedUser = {
      uid: 'google-uid',
      username: 'verified@gmail.com',
      email: 'verified@gmail.com',
      emailVerified: true,
      authProvider: 'firebase',
      setOnAuthFailure: vi.fn(),
      getIdToken: vi.fn(async () => 'google-id-token'),
    };
    const storage = createStorage({
      firebase_google_session_id: 'session-abc',
    });
    vi.stubGlobal('sessionStorage', storage);
    vi.stubGlobal('localStorage', createStorage());

    const authState = renderAuthState({
      authApi: {
        clearFirebaseSession,
        loadFirebaseSession: vi.fn(() => null),
        signInWithEmailPassword: vi.fn(),
        signUpWithEmailPassword: vi.fn(),
        sendEmailVerification: vi.fn(),
        createGoogleAuthUri: vi.fn(),
        signInWithGoogleCallback: vi.fn(async () => verifiedUser),
      },
    });

    const result = await authState.completeGoogleSignIn();
    expect(result).toBe(verifiedUser);
    expect(clearFirebaseSession).not.toHaveBeenCalled();
  });

  it('completeGoogleSignIn removes sessionId before the API call (StrictMode guard)', async () => {
    // A second concurrent call must see no sessionId and return null immediately.
    const verifiedUser = {
      uid: 'google-uid',
      email: 'user@gmail.com',
      emailVerified: true,
      authProvider: 'firebase',
      setOnAuthFailure: vi.fn(),
      getIdToken: vi.fn(async () => 'tok'),
    };
    let resolveFirst;
    const firstCallPromise = new Promise((res) => { resolveFirst = res; });
    const storage = createStorage({ firebase_google_session_id: 'session-xyz' });
    vi.stubGlobal('sessionStorage', storage);
    vi.stubGlobal('localStorage', createStorage());

    const authState = renderAuthState({
      authApi: {
        clearFirebaseSession: vi.fn(),
        loadFirebaseSession: vi.fn(() => null),
        signInWithEmailPassword: vi.fn(),
        signUpWithEmailPassword: vi.fn(),
        sendEmailVerification: vi.fn(),
        createGoogleAuthUri: vi.fn(),
        signInWithGoogleCallback: vi.fn(async () => {
          await firstCallPromise;
          return verifiedUser;
        }),
      },
    });

    const firstCall = authState.completeGoogleSignIn();
    // Before first call resolves, sessionId must already be gone.
    expect(storage.getItem('firebase_google_session_id')).toBeNull();
    // Second call sees no sessionId and bails out immediately.
    const secondResult = await authState.completeGoogleSignIn();
    expect(secondResult).toBeNull();
    // Let the first call finish.
    resolveFirst();
    const firstResult = await firstCall;
    expect(firstResult).toBe(verifiedUser);
  });

  it('register returns verificationFailed when sendEmailVerification throws', async () => {
    const fakeUser = {
      uid: 'u1',
      email: 'buyer@example.com',
      emailVerified: false,
      authProvider: 'firebase',
      setOnAuthFailure: vi.fn(),
      getIdToken: vi.fn(async () => 'id-token'),
    };
    const authState = renderAuthState({
      authApi: {
        clearFirebaseSession: vi.fn(),
        loadFirebaseSession: vi.fn(() => null),
        signInWithEmailPassword: vi.fn(),
        signUpWithEmailPassword: vi.fn(async () => fakeUser),
        sendEmailVerification: vi.fn(async () => { throw new Error('quota exceeded'); }),
        createGoogleAuthUri: vi.fn(),
        signInWithGoogleCallback: vi.fn(),
      },
    });

    const result = await authState.register('buyer@example.com', 'strongP@ss1');
    expect(result).toEqual({ verificationSent: false, verificationFailed: true });
  });

  it('resendVerificationEmail re-authenticates, sends verification, and clears session', async () => {
    const clearFirebaseSession = vi.fn();
    const fakeUser = {
      uid: 'u1',
      email: 'buyer@example.com',
      emailVerified: false,
      authProvider: 'firebase',
      setOnAuthFailure: vi.fn(),
      getIdToken: vi.fn(async () => 'fresh-id-token'),
    };
    const sendEmailVerification = vi.fn(async () => {});
    const authState = renderAuthState({
      authApi: {
        clearFirebaseSession,
        loadFirebaseSession: vi.fn(() => null),
        signInWithEmailPassword: vi.fn(async () => fakeUser),
        signUpWithEmailPassword: vi.fn(),
        sendEmailVerification,
        createGoogleAuthUri: vi.fn(),
        signInWithGoogleCallback: vi.fn(),
      },
    });

    const result = await authState.resendVerificationEmail('buyer@example.com', 'strongP@ss1');
    expect(result).toEqual({ verificationSent: true });
    expect(sendEmailVerification).toHaveBeenCalledWith('fresh-id-token');
    expect(clearFirebaseSession).toHaveBeenCalled();
  });
});
