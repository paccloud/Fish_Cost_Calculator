import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.fn();
vi.mock('../../../../api/_lib/db.js', () => ({ query: (...args) => query(...args) }));

const {
  isApiReadOnly,
  isBlockedWrite,
  READ_ONLY_BODY,
  READ_ONLY_STATUS,
} = await import('../../../../shared/readOnly.js');
const { getOrCreateFirebaseUser } = await import('../../../../api/_lib/firebase-auth.js');

const require = createRequire(import.meta.url);
const { createReadOnlyMiddleware } = require('../../../../server/readOnlyMiddleware.js');

function makeRes() {
  const res = { statusCode: 200, body: undefined, ended: false };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.send = (body) => { res.body = body; return res; };
  res.end = () => { res.ended = true; return res; };
  res.setHeader = () => res;
  return res;
}

beforeEach(() => {
  query.mockReset();
  query.mockResolvedValue({ rows: [], rowCount: 0 });
});

afterEach(() => {
  delete process.env.API_READ_ONLY;
});

describe('isApiReadOnly', () => {
  it('is off unless API_READ_ONLY is set to a true value', () => {
    expect(isApiReadOnly({})).toBe(false);
    expect(isApiReadOnly({ API_READ_ONLY: 'false' })).toBe(false);
    expect(isApiReadOnly({ API_READ_ONLY: '0' })).toBe(false);
    expect(isApiReadOnly({ API_READ_ONLY: 'true' })).toBe(true);
    expect(isApiReadOnly({ API_READ_ONLY: ' TRUE ' })).toBe(true);
    expect(isApiReadOnly({ API_READ_ONLY: '1' })).toBe(true);
  });

  it('blocks only unsafe methods, and only when read-only', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(isBlockedWrite(method, { readOnly: true })).toBe(true);
      expect(isBlockedWrite(method, { readOnly: false })).toBe(false);
      expect(isBlockedWrite(method, { readOnly: true, allowWrite: true })).toBe(false);
    }
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      expect(isBlockedWrite(method, { readOnly: true })).toBe(false);
    }
  });
});

const ENDPOINTS = {
  'register.js': () => import('../../../../api/register.js'),
  'saved-calcs.js': () => import('../../../../api/saved-calcs.js'),
  'contributor.js': () => import('../../../../api/contributor.js'),
  'upload-data.js': () => import('../../../../api/upload-data.js'),
  'user-data.js': () => import('../../../../api/user-data.js'),
};

// Every write the Vercel functions accept. Kept in step with the method checks
// in api/*.js; the read-only check runs in handleCors before any of them.
const VERCEL_WRITES = [
  ['register.js', 'POST'],
  ['saved-calcs.js', 'POST'],
  ['saved-calcs.js', 'DELETE'],
  ['saved-calcs.js', 'PATCH'],
  ['contributor.js', 'POST'],
  ['upload-data.js', 'POST'],
  ['user-data.js', 'POST'],
  ['user-data.js', 'PUT'],
  ['user-data.js', 'PATCH'],
  ['user-data.js', 'DELETE'],
];

describe('Vercel functions in read-only mode', () => {
  it.each(VERCEL_WRITES)('%s refuses %s with the read-only error', async (file, method) => {
    process.env.API_READ_ONLY = 'true';
    const { default: handler } = await ENDPOINTS[file]();
    const res = makeRes();

    await handler({ method, headers: {}, body: {}, query: { id: '1' } }, res);

    expect(res.statusCode).toBe(READ_ONLY_STATUS);
    expect(res.body).toEqual(READ_ONLY_BODY);
    expect(query).not.toHaveBeenCalled();
  });

  it('keeps reads working', async () => {
    process.env.API_READ_ONLY = 'true';
    const { default: handler } = await import('../../../../api/community-data.js');
    const res = makeRes();

    await handler({ method: 'GET', headers: {}, query: {} }, res);

    expect(res.statusCode).not.toBe(READ_ONLY_STATUS);
  });

  it('keeps sign-in open', async () => {
    process.env.API_READ_ONLY = 'true';
    const { default: handler } = await import('../../../../api/login.js');
    const res = makeRes();

    await handler({ method: 'POST', headers: {}, body: { username: 'a', password: 'b' } }, res);

    expect(res.statusCode).not.toBe(READ_ONLY_STATUS);
  });

  it('accepts writes when read-only mode is off', async () => {
    const { default: handler } = await import('../../../../api/register.js');
    const res = makeRes();

    await handler({ method: 'POST', headers: {}, body: {} }, res);

    expect(res.statusCode).not.toBe(READ_ONLY_STATUS);
  });
});

describe('Express server in read-only mode', () => {
  const serverSource = readFileSync(new URL('../../../../server/server.js', import.meta.url), 'utf8');
  const writeRoutes = [...serverSource.matchAll(/app\.(post|put|patch|delete)\('(\/api\/[^']+)'/g)]
    .map(([, method, path]) => [method.toUpperCase(), path]);

  async function run(method, path, readOnly) {
    const middleware = createReadOnlyMiddleware(Promise.resolve({
      READ_ONLY_BODY,
      READ_ONLY_STATUS,
      isBlockedWrite: (m, opts) => isBlockedWrite(m, { ...opts, readOnly }),
    }));
    const res = makeRes();
    const next = vi.fn();
    await middleware({ method, originalUrl: path.replace(/:\w+/g, '1') }, res, next);
    return { res, next };
  }

  it('registers the middleware before every route', () => {
    const middlewareAt = serverSource.indexOf("app.use('/api', createReadOnlyMiddleware())");
    const firstRouteAt = serverSource.search(/app\.(get|post|put|patch|delete)\('\/api\//);
    expect(middlewareAt).toBeGreaterThan(-1);
    expect(middlewareAt).toBeLessThan(firstRouteAt);
  });

  it('finds the server write routes', () => {
    expect(writeRoutes.length).toBeGreaterThanOrEqual(10);
  });

  it('refuses every write route except sign-in', async () => {
    for (const [method, path] of writeRoutes) {
      const { res, next } = await run(method, path, true);
      if (path === '/api/login') {
        expect(next, `${method} ${path}`).toHaveBeenCalled();
      } else {
        expect(res.statusCode, `${method} ${path}`).toBe(READ_ONLY_STATUS);
        expect(res.body).toEqual(READ_ONLY_BODY);
        expect(next).not.toHaveBeenCalled();
      }
    }
  });

  it('lets reads through, and everything through when off', async () => {
    expect((await run('GET', '/api/user-data', true)).next).toHaveBeenCalled();
    expect((await run('POST', '/api/user-data', false)).next).toHaveBeenCalled();
  });
});

describe('Firebase sign-in in read-only mode', () => {
  const firebaseUser = { uid: 'uid-1', email: 'new@example.com', emailVerified: true };

  it('returns an already-linked user without writing', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 3, username: 'u', email: 'old@example.com' }] });

    const user = await getOrCreateFirebaseUser(firebaseUser, query, { readOnly: true });

    expect(user).toEqual({ id: 3, username: 'u', email: 'old@example.com' });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toMatch(/^SELECT/);
  });

  it('does not link or create an account for an unknown user', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    const user = await getOrCreateFirebaseUser(firebaseUser, query, { readOnly: true });

    expect(user).toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });
});
