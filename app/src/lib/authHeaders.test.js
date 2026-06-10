import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stackClientApp } from '../config/neonAuth';
import { getAuthHeaders, hasAuthCredential } from './authHeaders';

vi.mock('../config/neonAuth', () => ({
  stackClientApp: {
    getUser: vi.fn(),
  },
}));

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

  it('adds a Stack Auth access token for OAuth sessions', async () => {
    stackClientApp.getUser.mockResolvedValue({
      getAuthJson: vi.fn(async () => ({ accessToken: 'stack-token' })),
    });

    const headers = await getAuthHeaders({ username: 'processor', authProvider: 'oauth' });

    expect(headers).toEqual({
      'x-stack-access-token': 'stack-token',
    });
    expect(headers).not.toHaveProperty('Content-Type');
  });

  it('preserves base headers and adds a Stack Auth access token for OAuth sessions', async () => {
    stackClientApp.getUser.mockResolvedValue({
      getAuthJson: vi.fn(async () => ({ accessToken: 'stack-token' })),
    });

    const headers = await getAuthHeaders(
      { username: 'processor', authProvider: 'oauth' },
      { 'Content-Type': 'application/json' }
    );

    expect(headers).toEqual({
      'Content-Type': 'application/json',
      'x-stack-access-token': 'stack-token',
    });
  });

  it('does not fall back to a password token for OAuth sessions', async () => {
    localStorage.setItem('token', 'stale-jwt-token');
    stackClientApp.getUser.mockResolvedValue({
      getAuthJson: vi.fn(async () => ({})),
    });

    const headers = await getAuthHeaders({ username: 'processor', authProvider: 'oauth' });

    expect(headers).toEqual({});
  });

  it('knows whether any auth credential is available', () => {
    expect(hasAuthCredential({ username: 'oauth-user', authProvider: 'oauth' })).toBe(true);

    expect(hasAuthCredential({ username: 'password-user', authProvider: 'password' })).toBe(false);
    localStorage.setItem('token', 'jwt-token');
    expect(hasAuthCredential({ username: 'password-user', authProvider: 'password' })).toBe(true);
    expect(hasAuthCredential(null)).toBe(false);
  });
});
