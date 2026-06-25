/**
 * GET  /api/user-data  — list user-data entries
 * POST /api/user-data  — create a user-data entry
 *
 * Delegates to the shared handler core (shared/handlers/userData.js).
 * Auth is enforced by requireAuth HOF; the handler receives userId from req.user.
 *
 * @module api/user-data/index
 */

import { makeNeonAdapter } from '../_lib/neonDb.js';
import { requireAuth } from '../_lib/auth.js';
import { handleCors } from '../_lib/cors.js';
import {
  handleListUserData,
  handleCreateUserData,
} from '../../shared/handlers/index.js';

async function handler(req, res) {
  const userId = req.user.id;
  const db = makeNeonAdapter();

  if (req.method === 'GET') {
    const { status, body } = await handleListUserData({ userId }, db);
    return res.status(status).json(body);
  }

  if (req.method === 'POST') {
    const { status, body } = await handleCreateUserData(
      { userId, ...req.body },
      db
    );
    return res.status(status).json(body);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default handleCors(requireAuth(handler));
