/**
 * Vercel serverless adapter for the contributor profile endpoint.
 *
 * Delegates all business logic to the transport-agnostic handler core
 * (shared/handlers/contributors.js) and the Neon data-layer adapter.
 * This file is responsible only for:
 *   - CORS wrapping
 *   - Auth enforcement (via requireAuth HOF)
 *   - Method guard
 *   - Mapping the Vercel req/res shape into and out of the handler envelope
 *
 * @module api/contributor
 */

import { requireAuth } from './_lib/auth.js';
import { handleCors } from './_lib/cors.js';
import { handleGetContributor, handleSaveContributor } from '../shared/handlers/index.js';
import { makeNeonAdapter } from './_lib/neonDb.js';

async function handler(req, res) {
  const userId = req.user.id;
  const db = makeNeonAdapter();

  if (req.method === 'GET') {
    const { status, body } = await handleGetContributor({ userId }, db);
    return res.status(status).json(body);
  }

  if (req.method === 'POST') {
    const { status, body } = await handleSaveContributor({ userId, ...req.body }, db);
    return res.status(status).json(body);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default handleCors(requireAuth(handler));
