import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FIREBASE_AUTH_SESSION_KEY,
  createFirebaseSession,
  loadFirebaseSession,
  signInWithEmailPassword,
  signUpWithEmailPassword,
} from './firebaseRestAuth';

const installLocalStorage = () => {
  const store = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: vi.fn((key) => store.get(key) || null),
      setItem: vi.fn((key, value) => store.set(key, String(value))),
      removeItem: vi.fn((key) => store.delete(key)),
      clear: vi.fn(() => store.clear()),
    },
    configurable: true,
  });
  return store;
};

function fakeResponse({ ok = true, status = 200, body = {} }) {
  return {
    ok,
    status,
    json: async () => body,
  };
}

describe('Firebase REST auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installLocalStorage();
  });

  it('signs in with email and password and exposes the Firebase ID token', async () => {
    const fetch = vi.fn(async () => fakeResponse({
      body: {
        idToken: 'firebase-id-token',
        refreshToken: 'firebase-refresh-token',
        localId: 'firebase-user-123',
        email: 'fishbuyer@example.com',
        displayName: 'Fish Buyer',
        expiresIn: '3600',
      },
    }));

    const user = await signInWithEmailPassword('fishbuyer@example.com', 'secret', {
      apiKey: 'firebase-api-key',
      fetch,
      now: () => 1_700_000_000_000,
    });

    expect(fetch).toHaveBeenCalledWith(
      'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=firebase-api-key',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    );
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      email: 'fishbuyer@example.com',
      password: 'secret',
      returnSecureToken: true,
    });
    expect(user).toMatchObject({
      uid: 'firebase-user-123',
      username: 'Fish Buyer',
      email: 'fishbuyer@example.com',
      authProvider: 'firebase',
    });
    expect(JSON.parse(localStorage.getItem(FIREBASE_AUTH_SESSION_KEY))).not.toHaveProperty('refreshToken');
    await expect(user.getIdToken()).resolves.toBe('firebase-id-token');
  });

  it('registers with Firebase email and password using the sign-up endpoint', async () => {
    const fetch = vi.fn(async () => fakeResponse({
      body: {
        idToken: 'new-firebase-id-token',
        refreshToken: 'new-firebase-refresh-token',
        localId: 'new-firebase-user',
        email: 'new@example.com',
        expiresIn: '3600',
      },
    }));

    const user = await signUpWithEmailPassword('new@example.com', 'secret', {
      apiKey: 'firebase-api-key',
      fetch,
      now: () => 1_700_000_000_000,
    });

    expect(fetch.mock.calls[0][0]).toBe(
      'https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=firebase-api-key'
    );
    expect(user).toMatchObject({
      uid: 'new-firebase-user',
      username: 'new@example.com',
      email: 'new@example.com',
      authProvider: 'firebase',
    });
  });

  it('refreshes an expired Firebase ID token before returning it', async () => {
    const store = installLocalStorage();

    const fetch = vi.fn(async () => fakeResponse({
      body: {
        id_token: 'fresh-id-token',
        refresh_token: 'fresh-refresh-token',
        user_id: 'firebase-user-123',
        expires_in: '3600',
      },
    }));

    const user = createFirebaseSession({
      idToken: 'expired-id-token',
      refreshToken: 'old-refresh-token',
      localId: 'firebase-user-123',
      email: 'fishbuyer@example.com',
      expiresIn: '1',
    }, {
      apiKey: 'firebase-api-key',
      fetch,
      now: () => 1_700_000_000_000,
    });

    expect(JSON.parse(store.get(FIREBASE_AUTH_SESSION_KEY)).expiresAt).toBe(1_700_000_001_000);
    await expect(user.getIdToken()).resolves.toBe('fresh-id-token');
    expect(fetch.mock.calls[0][0]).toBe(
      'https://securetoken.googleapis.com/v1/token?key=firebase-api-key'
    );
    // Token refresh must use form-encoded body (Firebase securetoken endpoint requirement)
    expect(fetch.mock.calls[0][1].headers).toMatchObject({
      'Content-Type': 'application/x-www-form-urlencoded',
    });
    const refreshParams = Object.fromEntries(new URLSearchParams(fetch.mock.calls[0][1].body));
    expect(refreshParams).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'old-refresh-token',
    });
  });

  it('clears persisted auth and reports auth failure when refresh fails', async () => {
    const fetch = vi.fn(async () => fakeResponse({
      ok: false,
      status: 400,
      body: { error: { message: 'TOKEN_EXPIRED' } },
    }));
    const onAuthFailure = vi.fn();

    const user = createFirebaseSession({
      idToken: 'expired-id-token',
      refreshToken: 'old-refresh-token',
      localId: 'firebase-user-123',
      email: 'fishbuyer@example.com',
      expiresIn: '1',
    }, {
      apiKey: 'firebase-api-key',
      fetch,
      now: () => 1_700_000_000_000,
      onAuthFailure,
    });

    expect(localStorage.getItem(FIREBASE_AUTH_SESSION_KEY)).not.toBeNull();
    await expect(user.getIdToken()).rejects.toThrow('TOKEN_EXPIRED');
    expect(localStorage.removeItem).toHaveBeenCalledWith(FIREBASE_AUTH_SESSION_KEY);
    expect(onAuthFailure).toHaveBeenCalledWith(expect.any(Error));
  });

  it('loads a persisted Firebase session from localStorage', async () => {
    localStorage.setItem(FIREBASE_AUTH_SESSION_KEY, JSON.stringify({
      idToken: 'stored-id-token',
      localId: 'stored-user',
      email: 'stored@example.com',
      displayName: 'Stored User',
      expiresAt: 1_700_003_600_000,
    }));

    const user = loadFirebaseSession({
      apiKey: 'firebase-api-key',
      now: () => 1_700_000_000_000,
    });

    expect(user).toMatchObject({
      uid: 'stored-user',
      username: 'Stored User',
      email: 'stored@example.com',
      authProvider: 'firebase',
    });
    await expect(user.getIdToken()).resolves.toBe('stored-id-token');
  });

  it('clears persisted session and throws locally when a reloaded session needs refresh but has no refresh token', async () => {
    const store = installLocalStorage();

    let currentTime = 1_700_000_000_000;
    const now = () => currentTime;
    const fetch = vi.fn();
    const onAuthFailure = vi.fn();

    store.set(FIREBASE_AUTH_SESSION_KEY, JSON.stringify({
      idToken: 'stored-id-token',
      localId: 'stored-user',
      email: 'stored@example.com',
      displayName: 'Stored User',
      expiresAt: 1_700_003_600_000,
    }));

    const user = loadFirebaseSession({ apiKey: 'firebase-api-key', fetch, now, onAuthFailure });
    expect(user).not.toBeNull();
    await expect(user.getIdToken()).resolves.toBe('stored-id-token');
    expect(localStorage.getItem(FIREBASE_AUTH_SESSION_KEY)).not.toBeNull();

    // Fast-forward into the 60-second refresh margin so getIdToken triggers a refresh check
    currentTime = 1_700_003_570_000;

    await expect(user.getIdToken()).rejects.toThrow('Session expired');
    expect(fetch).not.toHaveBeenCalled();
    expect(onAuthFailure).toHaveBeenCalledWith(expect.any(Error));
    expect(localStorage.removeItem).toHaveBeenCalledWith(FIREBASE_AUTH_SESSION_KEY);
  });
});
