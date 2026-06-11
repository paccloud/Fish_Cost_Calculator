/**
 * Vercel serverless adapter for the saved-calcs list endpoint.
 *
 * Delegates all business logic to the transport-agnostic handler core
 * (shared/handlers/savedCalcs.js) and the Neon data-layer adapter.
 * This file is responsible only for:
 *   - CORS wrapping
 *   - Auth enforcement (via requireAuth HOF)
 *   - Method guard
 *   - Mapping the Vercel req/res shape into and out of the handler envelope
 *
 * @module api/saved-calcs
 */

import { requireAuth } from './_lib/auth.js';
import { handleCors } from './_lib/cors.js';
import { handleListSavedCalcs } from '../shared/handlers/index.js';
import { makeNeonAdapter } from './_lib/neonDb.js';

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = makeNeonAdapter();
  const { status, body } = await handleListSavedCalcs({ userId: req.user.id }, db);
  return res.status(status).json(body);
}

export default handleCors(requireAuth(handler));
