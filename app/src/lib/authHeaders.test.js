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

  it('preserves base headers when no token is available', async () => {
    const headers = await getAuthHeaders(
      { username: 'processor', authProvider: 'password' },
      { 'Content-Type': 'application/json' }
    );

    expect(headers).toEqual({
      'Content-Type': 'application/json',
    });
  });

  it('requires a stored token before treating a user as authenticated for sync', () => {
    expect(hasAuthCredential({ username: 'password-user', authProvider: 'password' })).toBe(false);
    localStorage.setItem('token', 'jwt-token');
    expect(hasAuthCredential({ username: 'password-user', authProvider: 'password' })).toBe(true);
    expect(hasAuthCredential(null)).toBe(false);
  });
});
