/**
 * Vercel serverless adapter for the save-calc endpoint.
 *
 * Delegates all business logic to the transport-agnostic handler core
 * (shared/handlers/savedCalcs.js) and the Neon data-layer adapter.
 * This file is responsible only for:
 *   - CORS wrapping
 *   - Auth enforcement (via requireAuth HOF)
 *   - Method guard
 *   - Mapping the Vercel req/res shape into and out of the handler envelope
 *
 * @module api/save-calc
 */

import { requireAuth } from './_lib/auth.js';
import { handleCors } from './_lib/cors.js';
import { handleSaveCalc } from '../shared/handlers/index.js';
import { makeNeonAdapter } from './_lib/neonDb.js';

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = makeNeonAdapter();
  const { status, body } = await handleSaveCalc(
    { userId: req.user.id, ...req.body },
    db
  );
  return res.status(status).json(body);
}

export default handleCors(requireAuth(handler));
