import { requireAuth } from '../_lib/auth.js';
import { handleCors } from '../_lib/cors.js';
import { makeNeonAdapter } from '../_lib/neonDb.js';
import {
  handleDeleteUserData,
  handleUpdateUserData,
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
    const { status, body } = await handleDeleteUserData({ userId, id }, db);
    return res.status(status).json(body);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default handleCors(requireAuth(handler));
