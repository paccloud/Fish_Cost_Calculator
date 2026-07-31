export const FIREBASE_AUTH_SESSION_KEY = 'firebaseAuthSession';

const ID_TOKEN_REFRESH_MARGIN_MS = 60_000;
const IDENTITY_TOOLKIT_BASE_URL = 'https://identitytoolkit.googleapis.com/v1';
const SECURE_TOKEN_BASE_URL = 'https://securetoken.googleapis.com/v1';

function defaultNow() {
  return Date.now();
}

function getConfiguredApiKey(apiKey) {
  const configuredApiKey = apiKey || import.meta.env.VITE_FIREBASE_API_KEY;
  if (!configuredApiKey) {
    throw new Error('VITE_FIREBASE_API_KEY is required for Firebase authentication');
  }
  return configuredApiKey;
}

const FIREBASE_ERROR_MESSAGES = {
  EMAIL_EXISTS: 'An account with this email already exists.',
  INVALID_LOGIN_CREDENTIALS: 'Invalid email or password.',
  INVALID_EMAIL: 'Invalid email address.',
  WEAK_PASSWORD: 'Password must be at least 6 characters.',
  USER_DISABLED: 'This account has been disabled.',
  TOO_MANY_ATTEMPTS_TRY_LATER: 'Too many attempts. Please try again later.',
};

async function parseFirebaseResponse(response, fallbackMessage) {
  const body = await response.json().catch(() => ({}));
  if (response.ok) {
    return body;
  }

  const rawCode = body?.error?.message || '';
  const message = FIREBASE_ERROR_MESSAGES[rawCode] || rawCode || fallbackMessage;
  throw new Error(message);
}

async function postFirebaseJson(url, body, fetchFn) {
  if (typeof fetchFn !== 'function') {
    throw new Error('fetch is required for Firebase authentication');
  }

  const response = await fetchFn(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  return parseFirebaseResponse(response, 'Firebase authentication failed');
}

async function postFirebaseForm(url, params, fetchFn) {
  if (typeof fetchFn !== 'function') {
    throw new Error('fetch is required for Firebase authentication');
  }

  const response = await fetchFn(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });

  return parseFirebaseResponse(response, 'Firebase token refresh failed');
}

function normalizeAuthResponse(response, now) {
  const expiresAt = response.expiresAt !== undefined
    ? Number(response.expiresAt)
    : now() + Number.parseInt(response.expiresIn || response.expires_in || '3600', 10) * 1000;

  return {
    idToken: response.idToken || response.id_token,
    refreshToken: response.refreshToken || response.refresh_token,
    localId: response.localId || response.local_id || response.user_id,
    email: response.email || null,
    displayName: response.displayName || response.display_name || response.email || null,
    emailVerified: response.emailVerified ?? response.email_verified ?? false,
    expiresAt,
  };
}

function shouldRefresh(session, now) {
  return Number(session.expiresAt || 0) <= now + ID_TOKEN_REFRESH_MARGIN_MS;
}

function persistSession(session, storage = globalThis.localStorage) {
  if (!storage) return;
  const { refreshToken: _refreshToken, ...persistableSession } = session;
  storage.setItem(FIREBASE_AUTH_SESSION_KEY, JSON.stringify(persistableSession));
}

function clearPersistedSession(storage = globalThis.localStorage) {
  if (!storage) return;
  storage.removeItem(FIREBASE_AUTH_SESSION_KEY);
}

async function refreshFirebaseSession(session, options) {
  const apiKey = getConfiguredApiKey(options.apiKey);
  const fetchFn = options.fetch || globalThis.fetch;
  const refreshed = await postFirebaseForm(
    `${SECURE_TOKEN_BASE_URL}/token?key=${encodeURIComponent(apiKey)}`,
    {
      grant_type: 'refresh_token',
      refresh_token: session.refreshToken,
    },
    fetchFn
  );

  return normalizeAuthResponse({
    idToken: refreshed.id_token || refreshed.idToken || session.idToken,
    refreshToken: refreshed.refresh_token || refreshed.refreshToken || session.refreshToken,
    localId: refreshed.user_id || refreshed.localId || session.localId,
    email: refreshed.email || session.email,
    displayName: refreshed.displayName || session.displayName,
    expiresIn: refreshed.expires_in || refreshed.expiresIn,
  }, options.now || defaultNow);
}

export function createFirebaseSession(response, options = {}) {
  let session = normalizeAuthResponse(response, options.now || defaultNow);
  persistSession(session, options.storage);

  let pendingRefresh = null;
  let onAuthFailureHandler = options.onAuthFailure || null;

  return {
    uid: session.localId,
    username: session.displayName || session.email,
    email: session.email,
    emailVerified: session.emailVerified,
    authProvider: 'firebase',
    setOnAuthFailure: (fn) => { onAuthFailureHandler = fn; },
    getIdToken: async () => {
      const now = (options.now || defaultNow)();
      if (shouldRefresh(session, now)) {
        if (!session.refreshToken) {
          clearPersistedSession(options.storage);
          const err = new Error('Session expired. Please sign in again.');
          onAuthFailureHandler?.(err);
          throw err;
        }
        if (!pendingRefresh) {
          pendingRefresh = refreshFirebaseSession(session, options)
            .then((refreshed) => {
              session = refreshed;
              persistSession(session, options.storage);
            })
            .catch((err) => {
              clearPersistedSession(options.storage);
              onAuthFailureHandler?.(err);
              throw err;
            })
            .finally(() => {
              pendingRefresh = null;
            });
        }
        await pendingRefresh;
      }
      return session.idToken;
    },
  };
}

export function loadFirebaseSession(options = {}) {
  const storage = options.storage || globalThis.localStorage;
  if (!storage) return null;

  try {
    const raw = storage.getItem(FIREBASE_AUTH_SESSION_KEY);
    if (!raw) return null;

    const session = JSON.parse(raw);
    if (!session?.idToken || !session?.localId) {
      clearPersistedSession(storage);
      return null;
    }

    const now = (options.now || defaultNow)();
    if (!session.refreshToken && shouldRefresh(session, now)) {
      clearPersistedSession(storage);
      return null;
    }

    return createFirebaseSession(session, { ...options, storage });
  } catch {
    clearPersistedSession(storage);
    return null;
  }
}

export function clearFirebaseSession(options = {}) {
  clearPersistedSession(options.storage);
}

export async function signInWithEmailPassword(email, password, options = {}) {
  const apiKey = getConfiguredApiKey(options.apiKey);
  const fetchFn = options.fetch || globalThis.fetch;
  const response = await postFirebaseJson(
    `${IDENTITY_TOOLKIT_BASE_URL}/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
    {
      email,
      password,
      returnSecureToken: true,
    },
    fetchFn
  );

  return createFirebaseSession(response, options);
}

export async function signUpWithEmailPassword(email, password, options = {}) {
  const apiKey = getConfiguredApiKey(options.apiKey);
  const fetchFn = options.fetch || globalThis.fetch;
  const response = await postFirebaseJson(
    `${IDENTITY_TOOLKIT_BASE_URL}/accounts:signUp?key=${encodeURIComponent(apiKey)}`,
    {
      email,
      password,
      returnSecureToken: true,
    },
    fetchFn
  );

  return createFirebaseSession(response, options);
}

export async function sendEmailVerification(idToken, options = {}) {
  const apiKey = getConfiguredApiKey(options.apiKey);
  const fetchFn = options.fetch || globalThis.fetch;
  await postFirebaseJson(
    `${IDENTITY_TOOLKIT_BASE_URL}/accounts:sendOobCode?key=${encodeURIComponent(apiKey)}`,
    { requestType: 'VERIFY_EMAIL', idToken },
    fetchFn
  );
}

export async function createGoogleAuthUri(continueUri, options = {}) {
  const apiKey = getConfiguredApiKey(options.apiKey);
  const fetchFn = options.fetch || globalThis.fetch;
  const response = await postFirebaseJson(
    `${IDENTITY_TOOLKIT_BASE_URL}/accounts:createAuthUri?key=${encodeURIComponent(apiKey)}`,
    { providerId: 'google.com', continueUri },
    fetchFn
  );
  return { authUri: response.authUri, sessionId: response.sessionId };
}

export async function signInWithGoogleCallback(requestUri, sessionId, options = {}) {
  const apiKey = getConfiguredApiKey(options.apiKey);
  const fetchFn = options.fetch || globalThis.fetch;
  const response = await postFirebaseJson(
    `${IDENTITY_TOOLKIT_BASE_URL}/accounts:signInWithIdp?key=${encodeURIComponent(apiKey)}`,
    {
      requestUri,
      sessionId,
      returnIdpCredential: true,
      returnSecureToken: true,
    },
    fetchFn
  );
  return createFirebaseSession(response, options);
}
