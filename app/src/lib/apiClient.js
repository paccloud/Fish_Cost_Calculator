/**
 * API client module — the single seam between the frontend and HTTP.
 *
 * Owns:
 *  - Base-URL construction (env-configured in dev via VITE_API_URL, same-origin in prod)
 *  - Endpoint paths
 *  - Authorization-header construction from the stored JWT
 *  - JSON / error-shape normalization
 *
 * All methods accept an injected `fetch` implementation so they are fully
 * testable without a live network (pass `options.fetch` to `createApiClient`).
 *
 * Named methods exposed so far (slice #39):
 *   exportCalcs() → Promise<Blob>
 *
 * Future slices (#42) will add: login, register, saveCalc, listSavedCalcs,
 * deleteCalc, userData CRUD, uploadData, publicCalcs, contributors,
 * contributorProfile.
 */

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  /** @param {string} message @param {number} status */
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Read the error message from a non-ok response.
 * Tries JSON first; falls back to plain text; falls back to a generic string.
 *
 * @param {Response} res
 * @returns {Promise<string>}
 */
async function extractErrorMessage(res) {
  const contentType = res.headers.get('content-type') ?? '';
  try {
    if (contentType.includes('application/json')) {
      const body = await res.json();
      return body?.error || body?.message || JSON.stringify(body);
    }
    const text = await res.text();
    if (text && text.trim()) return text.trim();
  } catch {
    // ignore parse errors — fall through to default
  }
  return `Request failed with status ${res.status}`;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an API client instance.
 *
 * @param {{
 *   baseUrl?: string,
 *   getToken?: () => string | null,
 *   fetch?: typeof globalThis.fetch,
 * }} [options]
 */
export function createApiClient(options = {}) {
  const {
    baseUrl = (typeof import.meta !== 'undefined' ? (import.meta.env?.VITE_API_URL ?? '') : ''),
    getToken = () => (typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null),
    fetch: _fetch = globalThis.fetch,
  } = options;

  /**
   * Build the Authorization header value from the stored JWT, or null.
   * @returns {string|null}
   */
  function authHeader() {
    const token = getToken();
    return token ? `Bearer ${token}` : null;
  }

  /**
   * Core request helper — constructs URL, attaches auth header, normalizes
   * error responses into ApiError instances.
   *
   * @param {string} path  - e.g. '/api/export?type=calcs'
   * @param {RequestInit} [init]
   * @returns {Promise<Response>}  resolved response (ok=true guaranteed)
   */
  async function request(path, init = {}) {
    const url = `${baseUrl}${path}`;
    const headers = { ...(init.headers ?? {}) };
    const auth = authHeader();
    if (auth) {
      headers.Authorization = auth;
    }

    const res = await _fetch(url, { ...init, headers });

    if (!res.ok) {
      const message = await extractErrorMessage(res);
      throw new ApiError(message, res.status);
    }

    return res;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Export the authenticated user's saved calculations as a CSV Blob.
   *
   * GET /api/export?type=calcs
   *
   * @returns {Promise<Blob>}
   */
  async function exportCalcs() {
    const res = await request('/api/export?type=calcs', { method: 'GET' });
    return res.blob();
  }

  return { exportCalcs };
}

// ---------------------------------------------------------------------------
// Default singleton — uses Vite env for base URL, localStorage for token
// ---------------------------------------------------------------------------

export const apiClient = createApiClient();
