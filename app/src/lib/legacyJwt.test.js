import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { decodeJwtPayload, legacyUserFromToken } from './legacyJwt';

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = (payload) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.signature`;

describe('decodeJwtPayload', () => {
  it('reads the payload of a JWT', () => {
    expect(decodeJwtPayload(jwt({ id: 7, username: 'skipper' }))).toEqual({ id: 7, username: 'skipper' });
  });

  it('returns null for anything that is not a JWT', () => {
    expect(decodeJwtPayload('not-a-jwt')).toBeNull();
    expect(decodeJwtPayload('a.%%%.c')).toBeNull();
    expect(decodeJwtPayload(null)).toBeNull();
  });
});

describe('legacyUserFromToken', () => {
  it('includes the account id, so the account gets its own storage scope', () => {
    expect(legacyUserFromToken(jwt({ id: 7, username: 'skipper', exp: 9999999999 }))).toEqual({
      id: 7,
      username: 'skipper',
      email: null,
      authProvider: 'password',
    });
  });

  it('returns null when the token names no user', () => {
    expect(legacyUserFromToken(jwt({ id: 7 }))).toBeNull();
    expect(legacyUserFromToken('garbage')).toBeNull();
  });
});
