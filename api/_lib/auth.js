import { verifyFirebaseAuthSession } from './firebase-auth.js';
import { query } from './db.js';

const JWT_SECRET = process.env.JWT_SECRET;

/**
 * Verify JWT token from Authorization header
 * @param {Object} req - Request object
 * @returns {Object|null} Decoded token payload or null if invalid
 */
export async function verifyToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  if (!JWT_SECRET) {
    return null;
  }

  const token = authHeader.split(' ')[1];
  try {
    const { default: jwt } = await import('jsonwebtoken');
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

/**
 * Verify user from Firebase or a legacy JWT token.
 * Firebase is checked first because Firebase ID tokens and legacy JWTs both
 * use the Authorization bearer-token slot during the migration window.
 * @param {Object} req - Request object
 * @returns {Object|null} User object or null if not authenticated
 */
export async function verifyUser(req) {
  const firebaseUser = await verifyFirebaseAuthSession(req, { query });
  if (firebaseUser) {
    return firebaseUser;
  }

  // First try JWT token (existing password auth)
  const jwtUser = await verifyToken(req);
  if (jwtUser) {
    return { ...jwtUser, authProvider: 'password' };
  }

  return null;
}

/**
 * Higher-order function to require authentication for a handler
 * Supports Firebase ID tokens and legacy JWT tokens during migration.
 * @param {Function} handler - The route handler function
 * @returns {Function} Wrapped handler that requires auth
 */
export function requireAuth(handler) {
  return async (req, res) => {
    const user = await verifyUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    req.user = user;
    return handler(req, res);
  };
}
