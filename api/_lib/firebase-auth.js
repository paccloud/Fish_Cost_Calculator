import { createVerify } from 'node:crypto';

const FIREBASE_PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.VITE_FIREBASE_PROJECT_ID;

const FIREBASE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const FIREBASE_CERTS_FETCH_TIMEOUT_MS = 5000;

let cachedCerts = null;
let cachedCertsExpiresAt = 0;

function getBearerToken(req) {
  const authHeader = req?.headers?.authorization || req?.headers?.Authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }

  return authHeader.slice('Bearer '.length).trim() || null;
}

function maxAgeMs(cacheControl) {
  const match = /max-age=(\d+)/i.exec(cacheControl || '');
  return match ? Number.parseInt(match[1], 10) * 1000 : 60 * 60 * 1000;
}

async function fetchWithTimeout(fetchFn, url, timeoutMs) {
  if (typeof AbortController !== 'function') {
    return fetchFn(url);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchFn(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchFirebaseCerts(fetchFn = globalThis.fetch) {
  if (cachedCerts && cachedCertsExpiresAt > Date.now()) {
    return cachedCerts;
  }

  if (typeof fetchFn !== 'function') {
    throw new Error('fetch is required to verify Firebase ID tokens');
  }

  try {
    const response = await fetchWithTimeout(
      fetchFn,
      FIREBASE_CERTS_URL,
      FIREBASE_CERTS_FETCH_TIMEOUT_MS
    );
    if (!response.ok) {
      throw new Error('Unable to fetch Firebase public keys');
    }

    const certs = await response.json();
    cachedCerts = certs;
    cachedCertsExpiresAt = Date.now() + maxAgeMs(response.headers?.get?.('cache-control'));
    return certs;
  } catch (err) {
    if (cachedCerts) {
      return cachedCerts;
    }
    throw err;
  }
}

function decodeBase64UrlJson(value) {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function verifyRs256({ signingInput, signature, cert }) {
  const verifier = createVerify('RSA-SHA256');
  verifier.update(signingInput);
  verifier.end();
  return verifier.verify(cert, Buffer.from(signature, 'base64url'));
}

function tokenPayloadIsValid(payload, projectId, nowSeconds) {
  return (
    payload?.iss === `https://securetoken.google.com/${projectId}` &&
    payload?.aud === projectId &&
    typeof payload?.sub === 'string' &&
    payload.sub.length > 0 &&
    (!payload.exp || payload.exp > nowSeconds) &&
    (!payload.nbf || payload.nbf <= nowSeconds) &&
    (!payload.iat || payload.iat <= nowSeconds)
  );
}

export async function verifyFirebaseIdToken(token, options = {}) {
  const projectId = options.projectId || FIREBASE_PROJECT_ID;
  if (!projectId) {
    throw new Error('FIREBASE_PROJECT_ID is required for Firebase authentication');
  }

  const [encodedHeader, encodedPayload, signature] = String(token || '').split('.');
  if (!encodedHeader || !encodedPayload || !signature) {
    return null;
  }

  const header = decodeBase64UrlJson(encodedHeader);
  if (header?.alg !== 'RS256' || !header.kid) {
    return null;
  }

  const certs = await fetchFirebaseCerts(options.fetch);
  const cert = certs[header.kid];
  if (!cert) {
    return null;
  }

  const signingInput = `${encodedHeader}.${encodedPayload}`;
  if (!verifyRs256({ signingInput, signature, cert })) {
    return null;
  }

  const payload = decodeBase64UrlJson(encodedPayload);
  if (!tokenPayloadIsValid(
    payload,
    projectId,
    options.nowSeconds || Math.floor(Date.now() / 1000)
  )) {
    return null;
  }

  return {
    uid: payload.sub,
    email: payload.email,
    emailVerified: payload.email_verified === true,
    name: payload.name || payload.email,
    picture: payload.picture,
  };
}

function uidFallbackUsername(firebaseUser) {
  return `firebase_${String(firebaseUser.uid).slice(0, 12)}`;
}

function usernameFromFirebaseUser(firebaseUser) {
  if (firebaseUser.emailVerified && firebaseUser.email) {
    return firebaseUser.email;
  }

  return uidFallbackUsername(firebaseUser);
}

async function linkExistingUser(existingUser, firebaseUser, query) {
  if (existingUser.firebase_uid && existingUser.firebase_uid !== firebaseUser.uid) {
    return null;
  }

  if (!existingUser.firebase_uid) {
    const updated = await query(
      'UPDATE users SET firebase_uid = $1, avatar_url = $2, auth_provider = $3 WHERE id = $4 AND firebase_uid IS NULL RETURNING id',
      [firebaseUser.uid, firebaseUser.picture || null, 'firebase', existingUser.id]
    );
    if (updated.rows.length === 0) {
      // Another request raced and linked this user first — re-fetch and verify the winner was us
      const refetch = await query('SELECT id, username, email, firebase_uid FROM users WHERE id = $1', [existingUser.id]);
      const refetched = refetch.rows[0];
      if (!refetched || refetched.firebase_uid !== firebaseUser.uid) return null;
      return refetched;
    }
  }

  return existingUser;
}

export async function getOrCreateFirebaseUser(firebaseUser, query) {
  if (!firebaseUser?.uid || typeof query !== 'function') {
    return null;
  }

  try {
    let result = await query(
      'SELECT id, username, email FROM users WHERE firebase_uid = $1',
      [firebaseUser.uid]
    );

    if (result.rows.length > 0) {
      return result.rows[0];
    }

    if (firebaseUser.email && !firebaseUser.emailVerified) {
      return null;
    }

    if (firebaseUser.email && firebaseUser.emailVerified) {
      result = await query(
        'SELECT id, username, email, firebase_uid FROM users WHERE email = $1',
        [firebaseUser.email]
      );

      if (result.rows.length > 0) {
        return linkExistingUser(result.rows[0], firebaseUser, query);
      }

      // Intentionally skip matching by username here: legacy accounts could have
      // arbitrary email-shaped usernames they don't own, and auto-linking would
      // expose another user's data to whoever verifies that address in Firebase.
    }

    const insertUsername = usernameFromFirebaseUser(firebaseUser);
    try {
      result = await query(
        `INSERT INTO users (username, email, firebase_uid, avatar_url, auth_provider)
         VALUES ($1, $2, $3, $4, 'firebase')
         RETURNING id, username, email`,
        [
          insertUsername,
          firebaseUser.emailVerified ? firebaseUser.email : null,
          firebaseUser.uid,
          firebaseUser.picture || null,
        ]
      );
    } catch (insertErr) {
      // Username collision (email already taken as username) — retry with UID-based fallback
      if (insertErr.code === '23505' && insertUsername !== uidFallbackUsername(firebaseUser)) {
        result = await query(
          `INSERT INTO users (username, email, firebase_uid, avatar_url, auth_provider)
           VALUES ($1, $2, $3, $4, 'firebase')
           RETURNING id, username, email`,
          [
            uidFallbackUsername(firebaseUser),
            firebaseUser.emailVerified ? firebaseUser.email : null,
            firebaseUser.uid,
            firebaseUser.picture || null,
          ]
        );
      } else {
        throw insertErr;
      }
    }

    return result.rows[0];
  } catch (err) {
    console.error('Error getting/creating Firebase user:', err);
    return null;
  }
}

export async function verifyFirebaseAuthSession(req, options = {}) {
  const token = getBearerToken(req);
  if (!token) {
    return null;
  }

  try {
    const verifyIdToken = options.verifyIdToken || verifyFirebaseIdToken;
    if (!options.verifyIdToken && !(options.projectId || FIREBASE_PROJECT_ID)) {
      return null;
    }

    const firebaseUser = await verifyIdToken(token, options);
    const localUser = await getOrCreateFirebaseUser(firebaseUser, options.query);

    if (!localUser) {
      return null;
    }

    return {
      id: localUser.id,
      username: localUser.username,
      email: localUser.email,
      authProvider: 'firebase',
    };
  } catch (err) {
    console.error('Firebase authentication error:', err);
    return null;
  }
}
