/**
 * PUT    /api/user-data/:id  — update a user-data entry
 * DELETE /api/user-data/:id  — delete a user-data entry
 *
 * Delegates to the shared handler core (shared/handlers/userData.js).
 * Auth is enforced by requireAuth HOF; the handler receives userId from req.user.
 * The entry id comes from req.query.id (Vercel route param) — this is the live
 * production contract that the apiClient *Raw methods rely on.
 *
 * @module api/user-data/[id]
 */

import { makeNeonAdapter } from '../_lib/neonDb.js';
import { requireAuth } from '../_lib/auth.js';
import { handleCors } from '../_lib/cors.js';
import {
  handleUpdateUserData,
  handleDeleteUserData,
} from '../../shared/handlers/index.js';

async function handler(req, res) {
  const { id } = req.query;
  const userId = req.user.id;
  const db = makeNeonAdapter();

  if (req.method === 'PUT') {
    const { status, body } = await handleUpdateUserData(
      { userId, id, ...req.body },
      db
    );
    return res.status(status).json(body);
  }

  if (req.method === 'DELETE') {
    const { status, body } = await handleDeleteUserData(
      { userId, id },
      db
    );
    return res.status(status).json(body);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default handleCors(requireAuth(handler));
