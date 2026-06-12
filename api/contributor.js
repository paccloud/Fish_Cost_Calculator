import { requireAuth } from './_lib/auth.js';
import { handleCors } from './_lib/cors.js';
import { makeNeonAdapter } from './_lib/neonDb.js';
import {
  handleGetContributorProfile,
  handleSaveContributorProfile,
} from '../shared/handlers/index.js';

/**
 * Consolidated contributor endpoint
 * GET /api/contributor - Get current user's contributor profile
 * POST /api/contributor - Create/update contributor profile
 */
async function handler(req, res) {
  const userId = req.user.id;
  const db = makeNeonAdapter();

  if (req.method === 'GET') {
    const { status, body } = await handleGetContributorProfile({ userId }, db);
    return res.status(status).json(body);
  }

  if (req.method === 'POST') {
    const { status, body } = await handleSaveContributorProfile(
      { userId, ...req.body },
      db
    );
    return res.status(status).json(body);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default handleCors(requireAuth(handler));
