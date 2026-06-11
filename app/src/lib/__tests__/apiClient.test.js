/**
 * apiClient test suite — table-driven, interface-only.
 *
 * Tests assert request construction (path, method, auth header) and
 * error-shape normalization against an injected fake transport.
 * No live network — no imports of browser APIs.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../apiClient.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a fake Response-like object. */
function fakeResponse({ ok, status, body, headers = {} }) {
  return {
    ok,
    status,
    headers: {
      get: (name) => headers[name.toLowerCase()] ?? null,
    },
    blob: async () => body,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

/** Create a fetch stub that returns the given response. */
function stubFetch(response) {
  return vi.fn(async () => response);
}

// ---------------------------------------------------------------------------
// exportCalcs — request construction
// ---------------------------------------------------------------------------

describe('apiClient.exportCalcs — request construction', () => {
  const BASE = 'http://localhost:3000';
  const TOKEN = 'test-jwt-token';

  const cases = [
    {
      label: 'sends GET to /api/export?type=calcs',
      token: TOKEN,
      expectedUrl: `${BASE}/api/export?type=calcs`,
      expectedMethod: 'GET',
    },
  ];

  cases.forEach(({ label, token, expectedUrl, expectedMethod }) => {
    it(label, async () => {
      const blob = new Blob(['csv-data'], { type: 'text/csv' });
      const fetchStub = stubFetch(fakeResponse({ ok: true, status: 200, body: blob }));
      const client = createApiClient({ baseUrl: BASE, getToken: () => token, fetch: fetchStub });

      await client.exportCalcs();

      expect(fetchStub).toHaveBeenCalledTimes(1);
      const [url, options] = fetchStub.mock.calls[0];
      expect(url).toBe(expectedUrl);
      expect((options?.method ?? 'GET').toUpperCase()).toBe(expectedMethod);
    });
  });
});

// ---------------------------------------------------------------------------
// exportCalcs — Authorization header
// ---------------------------------------------------------------------------

describe('apiClient.exportCalcs — Authorization header', () => {
  const BASE = '';
  const TOKEN = 'my.jwt.token';

  const cases = [
    {
      label: 'sends Bearer token when token is present',
      token: TOKEN,
      expectHeader: `Bearer ${TOKEN}`,
    },
    {
      label: 'omits Authorization header when no token',
      token: null,
      expectHeader: null,
    },
  ];

  cases.forEach(({ label, token, expectHeader }) => {
    it(label, async () => {
      const blob = new Blob([''], { type: 'text/csv' });
      const fetchStub = stubFetch(fakeResponse({ ok: true, status: 200, body: blob }));
      const client = createApiClient({ baseUrl: BASE, getToken: () => token, fetch: fetchStub });

      await client.exportCalcs();

      const [, options] = fetchStub.mock.calls[0];
      const authHeader = options?.headers?.Authorization ?? null;
      expect(authHeader).toBe(expectHeader);
    });
  });
});

// ---------------------------------------------------------------------------
// exportCalcs — error normalization
// ---------------------------------------------------------------------------

describe('apiClient.exportCalcs — error normalization', () => {
  const BASE = '';

  const cases = [
    {
      label: 'throws ApiError with status on non-ok JSON error response',
      response: fakeResponse({
        ok: false,
        status: 401,
        body: { error: 'Unauthorized' },
        headers: { 'content-type': 'application/json' },
      }),
      expectMessage: 'Unauthorized',
      expectStatus: 401,
    },
    {
      label: 'throws ApiError with status on non-ok text response',
      response: fakeResponse({
        ok: false,
        status: 500,
        body: 'Internal Server Error',
        headers: { 'content-type': 'text/plain' },
      }),
      expectMessage: 'Internal Server Error',
      expectStatus: 500,
    },
    {
      label: 'throws ApiError with fallback message when body is empty',
      response: fakeResponse({
        ok: false,
        status: 404,
        body: '',
        headers: {},
      }),
      expectMessage: 'Request failed with status 404',
      expectStatus: 404,
    },
  ];

  cases.forEach(({ label, response, expectMessage, expectStatus }) => {
    it(label, async () => {
      const fetchStub = stubFetch(response);
      const client = createApiClient({ baseUrl: BASE, getToken: () => null, fetch: fetchStub });

      await expect(client.exportCalcs()).rejects.toMatchObject({
        name: 'ApiError',
        message: expectMessage,
        status: expectStatus,
      });
    });
  });
});

// ---------------------------------------------------------------------------
// exportCalcs — success shape
// ---------------------------------------------------------------------------

describe('apiClient.exportCalcs — success shape', () => {
  it('returns a Blob on success', async () => {
    const csvBlob = new Blob(['Date,Species\n'], { type: 'text/csv' });
    const fetchStub = stubFetch(fakeResponse({ ok: true, status: 200, body: csvBlob }));
    const client = createApiClient({ baseUrl: '', getToken: () => 'tok', fetch: fetchStub });

    const result = await client.exportCalcs();

    expect(result).toBeInstanceOf(Blob);
  });
});
