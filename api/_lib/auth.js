import jwt from 'jsonwebtoken';

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
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return null;
  }
}

/**
 * Higher-order function to require authentication for a handler
 * @param {Function} handler - The route handler function
 * @returns {Function} Wrapped handler that requires auth
 */
export function requireAuth(handler) {
  return async (req, res) => {
    const user = verifyToken(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    req.user = user;
    return handler(req, res);
  };
}
