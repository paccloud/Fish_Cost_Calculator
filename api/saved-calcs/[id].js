/**
 * Vercel serverless adapter for the saved-calcs delete endpoint.
 *
 * Handles DELETE /api/saved-calcs/:id by delegating to the transport-agnostic
 * handler core (shared/handlers/savedCalcs.js) and the Neon data-layer adapter.
 * This file is responsible only for:
 *   - CORS wrapping
 *   - Auth enforcement (via requireAuth HOF)
 *   - Method guard
 *   - Extracting the id from req.query (Vercel dynamic route parameter)
 *   - Mapping the Vercel req/res shape into and out of the handler envelope
 *
 * @module api/saved-calcs/[id]
 */

import { requireAuth } from '../_lib/auth.js';
import { handleCors } from '../_lib/cors.js';
import { handleDeleteCalc } from '../../shared/handlers/index.js';
import { makeNeonAdapter } from '../_lib/neonDb.js';

async function handler(req, res) {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = makeNeonAdapter();
  const { status, body } = await handleDeleteCalc(
    { userId: req.user.id, id: req.query.id },
    db
  );
  return res.status(status).json(body);
}

export default handleCors(requireAuth(handler));
