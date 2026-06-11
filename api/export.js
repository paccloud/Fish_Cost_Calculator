/**
 * GET /api/export?type=calcs  — export saved calculations as CSV
 * GET /api/export?type=data   — export custom yield data as CSV
 *
 * Delegates to the shared handler core (shared/handlers/export.js).
 * Auth is enforced by requireAuth HOF.
 *
 * @module api/export
 */

import { makeNeonAdapter } from './_lib/neonDb.js';
import { requireAuth } from './_lib/auth.js';
import { handleCors } from './_lib/cors.js';
import { handleExport } from '../shared/handlers/index.js';

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const userId = req.user.id;
  const db = makeNeonAdapter();
  const result = await handleExport(
    { userId, exportType: req.query?.type },
    db
  );

  if (result.contentType) {
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `attachment; filename=${result.filename}`);
    return res.status(result.status).send(result.body);
  }

  return res.status(result.status).json(result.body);
}

export default handleCors(requireAuth(handler));
