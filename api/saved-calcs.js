/**
 * Vercel serverless adapter for the saved-calcs endpoints.
 *
 * One function serves list/save/delete by method dispatch to stay under
 * Vercel's 12-serverless-function plan limit:
 *   - GET    /api/saved-calcs        → handleListSavedCalcs
 *   - POST   /api/saved-calcs        → handleSaveCalc
 *            (legacy path /api/save-calc is rewritten here via vercel.json)
 *   - DELETE /api/saved-calcs/:id    → handleDeleteCalc
 *            (path id is rewritten to ?id= via vercel.json)
 *
 * Delegates all business logic to the transport-agnostic handler core
 * (shared/handlers/savedCalcs.js) and the Neon data-layer adapter.
 * This file is responsible only for:
 *   - CORS wrapping
 *   - Auth enforcement (via requireAuth HOF)
 *   - Method dispatch
 *   - Mapping the Vercel req/res shape into and out of the handler envelope
 *
 * @module api/saved-calcs
 */

import { requireAuth } from './_lib/auth.js';
import { handleCors } from './_lib/cors.js';
import {
  handleListSavedCalcs,
  handleSaveCalc,
  handleDeleteCalc,
} from '../shared/handlers/index.js';
import { makeNeonAdapter } from './_lib/neonDb.js';

async function handler(req, res) {
  const db = makeNeonAdapter();

  if (req.method === 'GET') {
    const { status, body } = await handleListSavedCalcs({ userId: req.user.id }, db);
    return res.status(status).json(body);
  }

  if (req.method === 'POST') {
    const { status, body } = await handleSaveCalc(
      { userId: req.user.id, ...req.body },
      db
    );
    return res.status(status).json(body);
  }

  if (req.method === 'DELETE') {
    const { status, body } = await handleDeleteCalc(
      { userId: req.user.id, id: req.query.id },
      db
    );
    return res.status(status).json(body);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default handleCors(requireAuth(handler));
