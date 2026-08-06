import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAuthHeaders, hasAuthCredential } from './authHeaders';

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

describe('auth headers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installLocalStorage();
  });

  it('adds a bearer token for password sessions', async () => {
    localStorage.setItem('token', 'jwt-token');

    const headers = await getAuthHeaders(
      { username: 'processor', authProvider: 'password' },
      { 'Content-Type': 'application/json' }
    );

    expect(headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer jwt-token',
    });
  });

  it('adds a Firebase ID token as a bearer token for Firebase sessions', async () => {
    const getIdToken = vi.fn(async () => 'firebase-id-token');

    const headers = await getAuthHeaders(
      { username: 'processor', authProvider: 'firebase', getIdToken },
      { 'Content-Type': 'application/json' }
    );

    expect(headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer firebase-id-token',
    });
    expect(getIdToken).toHaveBeenCalledTimes(1);
  });

  it('does not fall back to a password token for Firebase sessions when ID token lookup fails', async () => {
    localStorage.setItem('token', 'stale-jwt-token');

    const headers = await getAuthHeaders({
      username: 'processor',
      authProvider: 'firebase',
      getIdToken: vi.fn(async () => null),
    });

    expect(headers).toEqual({});
  });

  it('propagates the error when getIdToken throws so callers can abort', async () => {
    const err = new Error('refresh token expired');
    const getIdToken = vi.fn(async () => { throw err; });

    await expect(getAuthHeaders({
      username: 'processor',
      authProvider: 'firebase',
      getIdToken,
    })).rejects.toThrow('refresh token expired');
  });

  it('knows whether any auth credential is available', () => {
    expect(hasAuthCredential({
      username: 'firebase-user',
      authProvider: 'firebase',
      getIdToken: vi.fn(),
    })).toBe(true);

    expect(hasAuthCredential({ username: 'password-user', authProvider: 'password' })).toBe(false);
    localStorage.setItem('token', 'jwt-token');
    expect(hasAuthCredential({ username: 'password-user', authProvider: 'password' })).toBe(true);
    expect(hasAuthCredential(null)).toBe(false);
  });
});
