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
 * Named methods (slice #39 + #42):
 *   exportCalcs()                              → Promise<Blob>
 *   login(username, password)                  → Promise<{token, username}>
 *   register(username, password)               → Promise<void>
 *   publicCalcs()                              → Promise<Array>
 *   contributors()                             → Promise<Array>
 *   getContributorProfile(extraHeaders?)       → Promise<Object|null>  (null = 404)
 *   saveContributorProfile(body, extraHeaders) → Promise<Object>
 *   uploadData(formData, extraHeaders)         → Promise<Object>
 *   saveCalcRaw(body, extraHeaders)            → Promise<Response>
 *   deleteCalcRaw(serverId, extraHeaders)      → Promise<Response>
 *   createUserDataRaw(body, extraHeaders)      → Promise<Response>
 *   deleteUserDataRaw(serverId, extraHeaders)  → Promise<Response>
 *   listSavedCalcsRaw(extraHeaders)            → Promise<Response>
 *   listUserDataRaw(extraHeaders)              → Promise<Response>
 *
 * Methods suffixed *Raw return the raw Response so callers can inspect
 * status codes (e.g. syncEngine needs to detect 401 and 404 without throwing).
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
   * Caller-supplied headers in `init.headers` are merged first; the JWT auth
   * header is added only if not already present.
   *
   * @param {string} path  - e.g. '/api/export?type=calcs'
   * @param {RequestInit} [init]
   * @returns {Promise<Response>}  resolved response (ok=true guaranteed)
   */
  async function request(path, init = {}) {
    const url = `${baseUrl}${path}`;
    const headers = { ...(init.headers ?? {}) };
    // Only inject the JWT auth header when caller hasn't already set one.
    if (!headers.Authorization) {
      const auth = authHeader();
      if (auth) {
        headers.Authorization = auth;
      }
    }

    const res = await _fetch(url, { ...init, headers });

    if (!res.ok) {
      const message = await extractErrorMessage(res);
      throw new ApiError(message, res.status);
    }

    return res;
  }

  /**
   * Like request() but returns the raw Response regardless of ok status.
   * Use when the caller must inspect the status code (e.g. treat 404 as ok,
   * or detect 401 to break out of a retry loop).
   *
   * @param {string} path
   * @param {RequestInit} [init]
   * @returns {Promise<Response>}
   */
  async function rawRequest(path, init = {}) {
    const url = `${baseUrl}${path}`;
    const headers = { ...(init.headers ?? {}) };
    if (!headers.Authorization) {
      const auth = authHeader();
      if (auth) {
        headers.Authorization = auth;
      }
    }
    return _fetch(url, { ...init, headers });
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

  /**
   * Authenticate with username + password.
   *
   * POST /api/login
   * Body: { username, password }
   *
   * @param {string} username
   * @param {string} password
   * @returns {Promise<{token: string, username: string}>}
   * @throws {ApiError} on non-ok response
   */
  async function login(username, password) {
    const res = await request('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    return res.json();
  }

  /**
   * Register a new user with username + password.
   *
   * POST /api/register
   * Body: { username, password }
   *
   * @param {string} username
   * @param {string} password
   * @returns {Promise<void>}
   * @throws {ApiError} on non-ok response
   */
  async function register(username, password) {
    await request('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
  }

  /**
   * Fetch public calculations (no auth required).
   *
   * GET /api/public-calcs
   *
   * @returns {Promise<Array>}
   * @throws {ApiError} on non-ok response
   */
  async function publicCalcs() {
    const res = await request('/api/public-calcs', { method: 'GET' });
    return res.json();
  }

  /**
   * Fetch the list of community contributors (no auth required).
   *
   * GET /api/contributors
   *
   * @returns {Promise<Array>}
   * @throws {ApiError} on non-ok response
   */
  async function contributors() {
    const res = await request('/api/contributors', { method: 'GET' });
    return res.json();
  }

  /**
   * Fetch the authenticated user's contributor profile.
   * Returns null when the server responds with 404 (no profile yet).
   *
   * GET /api/contributor
   *
   * @param {Record<string,string>} [extraHeaders] - Pre-built request headers.
   * @returns {Promise<Object|null>}
   * @throws {ApiError} on non-ok response other than 404
   */
  async function getContributorProfile(extraHeaders = {}) {
    const url = `${baseUrl}/api/contributor`;
    const headers = { ...extraHeaders };
    if (!headers.Authorization) {
      const auth = authHeader();
      if (auth) headers.Authorization = auth;
    }

    const res = await _fetch(url, { method: 'GET', headers });
    if (res.status === 404) return null;
    if (!res.ok) {
      const message = await extractErrorMessage(res);
      throw new ApiError(message, res.status);
    }
    return res.json();
  }

  /**
   * Create or update the authenticated user's contributor profile.
   *
   * POST /api/contributor
   * Body: { display_name, organization, bio, show_on_page }
   *
   * @param {Object} body
   * @param {Record<string,string>} [extraHeaders]
   * @returns {Promise<Object>}
   * @throws {ApiError} on non-ok response
   */
  async function saveContributorProfile(body, extraHeaders = {}) {
    const res = await request('/api/contributor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...extraHeaders },
      body: JSON.stringify(body),
    });
    return res.json();
  }

  /**
   * Upload a yield-data file (Excel/CSV) via multipart form.
   * Note: no Content-Type header — browser sets it with boundary.
   *
   * POST /api/upload-data
   * Body: FormData with `file` field
   *
   * @param {FormData} formData
   * @param {Record<string,string>} [extraHeaders]
   * @returns {Promise<Object>}
   * @throws {ApiError} on non-ok response
   */
  async function uploadData(formData, extraHeaders = {}) {
    const res = await request('/api/upload-data', {
      method: 'POST',
      headers: { ...extraHeaders },
      body: formData,
    });
    return res.json();
  }

  // ---------------------
  // Sync-engine raw API
  // ---------------------
  // These return the raw Response so syncEngine can inspect status codes
  // (401 to break the loop, 404 as an acceptable delete outcome).

  /**
   * POST /api/save-calc — push one local calculation to the server.
   * @param {{ name, species, product, cost, yield, result }} body
   * @param {Record<string,string>} extraHeaders
   * @returns {Promise<Response>}
   */
  async function saveCalcRaw(body, extraHeaders = {}) {
    return rawRequest('/api/save-calc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...extraHeaders },
      body: JSON.stringify(body),
    });
  }

  /**
   * DELETE /api/saved-calcs/:id — remove a synced calculation.
   * @param {number|string} serverId
   * @param {Record<string,string>} extraHeaders
   * @returns {Promise<Response>}
   */
  async function deleteCalcRaw(serverId, extraHeaders = {}) {
    return rawRequest(`/api/saved-calcs/${serverId}`, {
      method: 'DELETE',
      headers: { ...extraHeaders },
    });
  }

  /**
   * POST /api/user-data — push one local yield entry to the server.
   * @param {{ species, product, yield, source }} body
   * @param {Record<string,string>} extraHeaders
   * @returns {Promise<Response>}
   */
  async function createUserDataRaw(body, extraHeaders = {}) {
    return rawRequest('/api/user-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...extraHeaders },
      body: JSON.stringify(body),
    });
  }

  /**
   * DELETE /api/user-data/:id — remove a synced yield entry.
   * @param {number|string} serverId
   * @param {Record<string,string>} extraHeaders
   * @returns {Promise<Response>}
   */
  async function deleteUserDataRaw(serverId, extraHeaders = {}) {
    return rawRequest(`/api/user-data/${serverId}`, {
      method: 'DELETE',
      headers: { ...extraHeaders },
    });
  }

  /**
   * GET /api/saved-calcs — pull the server's saved-calcs list.
   * @param {Record<string,string>} extraHeaders
   * @returns {Promise<Response>}
   */
  async function listSavedCalcsRaw(extraHeaders = {}) {
    return rawRequest('/api/saved-calcs', {
      method: 'GET',
      headers: { ...extraHeaders },
    });
  }

  /**
   * GET /api/user-data — pull the server's user-data list.
   * @param {Record<string,string>} extraHeaders
   * @returns {Promise<Response>}
   */
  async function listUserDataRaw(extraHeaders = {}) {
    return rawRequest('/api/user-data', {
      method: 'GET',
      headers: { ...extraHeaders },
    });
  }

  return {
    exportCalcs,
    login,
    register,
    publicCalcs,
    contributors,
    getContributorProfile,
    saveContributorProfile,
    uploadData,
    saveCalcRaw,
    deleteCalcRaw,
    createUserDataRaw,
    deleteUserDataRaw,
    listSavedCalcsRaw,
    listUserDataRaw,
  };
}

// ---------------------------------------------------------------------------
// Default singleton — uses Vite env for base URL, localStorage for token
// ---------------------------------------------------------------------------

export const apiClient = createApiClient();
