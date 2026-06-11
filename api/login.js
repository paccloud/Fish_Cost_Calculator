/**
 * Vercel serverless adapter for the login endpoint.
 *
 * Delegates all business logic to the transport-agnostic handler core
 * (shared/handlers/login.js) and the Neon data-layer adapter.
 * This file is responsible only for:
 *   - CORS wrapping
 *   - Method guard
 *   - Mapping the Vercel req/res shape into and out of the handler envelope
 *   - Providing JWT config from environment variables
 *
 * @module api/login
 */

import { handleCors } from './_lib/cors.js';
import { handleLogin } from '../shared/handlers/index.js';
import { makeNeonAdapter } from './_lib/neonDb.js';

const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_EXPIRY_SECONDS =
  Number.parseInt(process.env.JWT_EXPIRES_IN_SECONDS || '86400', 10) || 86400;

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = makeNeonAdapter();
  const { status, body } = await handleLogin(
    req.body ?? {},
    db,
    { jwtSecret: JWT_SECRET, tokenExpirySeconds: TOKEN_EXPIRY_SECONDS }
  );
  return res.status(status).json(body);
}

export default handleCors(handler);
