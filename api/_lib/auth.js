import jwt from 'jsonwebtoken';
import { verifyNeonAuthSession, getOrCreateLocalUser } from './neon-auth.js';
import { query } from './db.js';

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is required for JWT authentication');
}

/**
 * Verify JWT token from Authorization header
 * @param {Object} req - Request object
 * @returns {Object|null} Decoded token payload or null if invalid
 */
export function verifyToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.split(' ')[1];
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

/**
 * Verify user from either JWT token or Neon Auth session
 * Tries JWT first (faster), then falls back to Neon Auth
 * @param {Object} req - Request object
 * @returns {Object|null} User object or null if not authenticated
 */
export async function verifyUser(req) {
  // First try JWT token (existing password auth)
  const jwtUser = verifyToken(req);
  if (jwtUser) {
    return { ...jwtUser, authProvider: 'password' };
  }

  // Fall back to Neon Auth session (OAuth)
  const neonUser = await verifyNeonAuthSession(req);
  if (neonUser) {
    // Get or create local user record for database operations
    const localUser = await getOrCreateLocalUser(neonUser, query);
    if (localUser) {
      return {
        id: localUser.id,
        username: localUser.username,
        email: localUser.email,
        authProvider: 'oauth',
      };
    }
  }

  return null;
}

/**
 * Higher-order function to require authentication for a handler
 * Supports both JWT tokens (password auth) and Neon Auth sessions (OAuth)
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
