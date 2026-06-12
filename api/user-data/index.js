import { requireAuth } from '../_lib/auth.js';
import { handleCors } from '../_lib/cors.js';
import { makeNeonAdapter } from '../_lib/neonDb.js';
import {
  handleCreateUserData,
  handleListUserData,
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
