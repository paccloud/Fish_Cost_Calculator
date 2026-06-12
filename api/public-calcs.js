import { handleCors } from './_lib/cors.js';
import { makeNeonAdapter } from './_lib/neonDb.js';
import { handleListPublicCalcs } from '../shared/handlers/index.js';

/**
 * Public endpoint to get all saved calculations
 * No authentication required - for guest access
 * GET /api/public-calcs
 */
async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { status, body } = await handleListPublicCalcs({}, makeNeonAdapter());
  return res.status(status).json(body);
}

export default handleCors(handler);
