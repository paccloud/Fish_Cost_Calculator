const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://localhost:3000')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

if (process.env.VERCEL_URL) {
  const vercelUrl = `https://${process.env.VERCEL_URL}`;
  if (!allowedOrigins.includes(vercelUrl)) {
    allowedOrigins.push(vercelUrl);
  }
}
const allowCredentials = process.env.CORS_ALLOW_CREDENTIALS === 'true';

/**
 * Resolve allowed origin for a request
 * @param {Object} req
 * @returns {string|null}
 */
function resolveOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return null;
  if (allowedOrigins.includes(origin)) return origin;
  return null;
}

/**
 * Set CORS headers on response
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @returns {string|null} - The allowed origin applied (if any)
 */
export function setCorsHeaders(req, res) {
  const allowedOrigin = resolveOrigin(req);

  if (allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    if (allowCredentials) {
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
  }

  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  return allowedOrigin;
}

/**
 * Higher-order function to handle CORS for a handler
 * @param {Function} handler - The route handler function
 * @returns {Function} Wrapped handler with CORS support
 */
export function handleCors(handler) {
  return async (req, res) => {
    const allowedOrigin = setCorsHeaders(req, res);

    if (req.headers.origin && !allowedOrigin) {
      return res.status(403).json({ error: 'CORS origin denied' });
    }

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }

    return handler(req, res);
  };
}
