/**
 * Vercel serverless adapter for the public-calcs endpoint.
 *
 * Delegates all business logic to the transport-agnostic handler core
 * (shared/handlers/publicCalcs.js) and the Neon data-layer adapter.
 * This file is responsible only for:
 *   - CORS wrapping
 *   - Method guard
 *   - Mapping the Vercel req/res shape into and out of the handler envelope
 *
 * @module api/public-calcs
 */

import { handleCors } from './_lib/cors.js';
import { handlePublicCalcs } from '../shared/handlers/index.js';
import { makeNeonAdapter } from './_lib/neonDb.js';

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = makeNeonAdapter();
  const { status, body } = await handlePublicCalcs({}, db);
  return res.status(status).json(body);
}

export default handleCors(handler);
