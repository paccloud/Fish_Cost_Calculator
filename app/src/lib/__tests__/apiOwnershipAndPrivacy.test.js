import { beforeEach, describe, expect, it, vi } from 'vitest';

// Pass-through auth/CORS so the tests exercise only the endpoint bodies.
vi.mock('../../../../api/_lib/auth.js', () => ({
  requireAuth: (handler) => (req, res) => {
    req.user = { id: 7 };
    return handler(req, res);
  },
}));
vi.mock('../../../../api/_lib/cors.js', () => ({ handleCors: (handler) => handler }));

const query = vi.fn();
vi.mock('../../../../api/_lib/db.js', () => ({ query: (...args) => query(...args) }));

const { default: savedCalcs } = await import('../../../../api/saved-calcs.js');
const { default: contributor } = await import('../../../../api/contributor.js');
const { default: communityData } = await import('../../../../api/community-data.js');
const { default: contributors } = await import('../../../../api/contributors.js');

function makeRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.send = (body) => { res.body = body; return res; };
  res.setHeader = () => res;
  return res;
}

beforeEach(() => {
  query.mockReset();
});

describe('owner id comes from the verified token, never the body', () => {
  it('saves a calculation under the signed-in user even if the body names another', async () => {
    query.mockResolvedValue({ rows: [{ id: 1 }] });
    const req = { method: 'POST', body: { userId: 999, name: 'x', species: 'Pink Salmon' }, query: {} };

    await savedCalcs(req, makeRes());

    const insert = query.mock.calls.find(([sql]) => /INSERT INTO calculations/i.test(sql));
    expect(insert[1]).toContain(7);
    expect(insert[1]).not.toContain(999);
  });

  it('saves a contributor profile under the signed-in user even if the body names another', async () => {
    query.mockResolvedValue({ rows: [{ id: 1 }] });
    const req = { method: 'POST', body: { userId: 999, display_name: 'Deckhand' }, query: {} };

    await contributor(req, makeRes());

    for (const [, params] of query.mock.calls) {
      expect(params).not.toContain(999);
    }
    expect(query.mock.calls.some(([, params]) => params?.includes(7))).toBe(true);
  });
});

describe('public endpoints never fall back to the account username/email', () => {
  it('community data attributes rows by display name only', async () => {
    query.mockResolvedValue({ rows: [] });

    await communityData({ method: 'GET', query: {} }, makeRes());

    const [sql] = query.mock.calls[0];
    expect(sql).not.toMatch(/username/i);
  });

  it('community CSV labels rows without a display name as Anonymous', async () => {
    query.mockResolvedValue({ rows: [] });

    await communityData({ method: 'GET', query: { format: 'csv' } }, makeRes());

    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/'Anonymous'\) AS contributor/);
  });

  it('contributors list selects no username or user id', async () => {
    query.mockResolvedValue({ rows: [] });

    await contributors({ method: 'GET', query: {} }, makeRes());

    const [sql] = query.mock.calls[0];
    expect(sql).not.toMatch(/username|c\.\*|user_id\s*,|\bu\./i);
  });
});
