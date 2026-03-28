import { toNodeHandler } from 'better-auth/node';
import { auth } from '../_lib/better-auth.js';
import { setCorsHeaders } from '../_lib/cors.js';

/**
 * Vercel serverless catch-all route for Better Auth.
 *
 * Delegates all /api/auth/* requests to Better Auth's built-in handler
 * (sign-up, sign-in, sign-out, OAuth callbacks, session, etc.).
 *
 * CORS headers are applied manually since Better Auth's handler
 * doesn't know about our origin allowlist.
 */
const betterAuthHandler = toNodeHandler(auth);

export default async function handler(req, res) {
  // Apply CORS headers from our allowlist
  const allowedOrigin = setCorsHeaders(req, res);

  // Block requests from disallowed origins
  if (req.headers.origin && !allowedOrigin) {
    return res.status(403).json({ error: 'CORS origin denied' });
  }

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // Delegate to Better Auth
  return betterAuthHandler(req, res);
}
