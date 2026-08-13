import { requireAuth } from './_lib/auth.js';
import { handleCors } from './_lib/cors.js';
import { makeNeonAdapter } from './_lib/neonDb.js';
import {
  handleListUserData,
  handleCreateUserData,
  handleUpdateUserData,
  handleDeleteUserData,
  handleSetUserDataSharing,
} from '../shared/handlers/index.js';

async function handler(req, res) {
  const db = makeNeonAdapter();
  const userId = req.user.id;
  const { id, action } = req.query;

  // POST /api/user-data?id=:id&action=share|unshare — toggle community sharing
  if (req.method === 'POST' && id && action) {
    if (action !== 'share' && action !== 'unshare') {
      return res.status(400).json({ error: 'action must be "share" or "unshare"' });
    }
    const { status, body } = await handleSetUserDataSharing(
      { userId, id, isShared: action === 'share' },
      db
    );
    return res.status(status).json(body);
  }

  // PATCH /api/user-data?id=:id — toggle sharing via { is_shared: boolean }
  if (req.method === 'PATCH' && id) {
    const { is_shared } = req.body ?? {};
    const { status, body } = await handleSetUserDataSharing(
      { userId, id, isShared: is_shared },
      db
    );
    return res.status(status).json(body);
  }

  // GET /api/user-data — list all entries for this user
  if (req.method === 'GET' && !id) {
    const { status, body } = await handleListUserData({ userId }, db);
    return res.status(status).json(body);
  }

  // POST /api/user-data — create new entry
  if (req.method === 'POST' && !id) {
    const { species, product, yield: yieldVal, source, client_id: clientId } = req.body ?? {};
    const { status, body } = await handleCreateUserData(
      { userId, species, product, yield: yieldVal, source, clientId },
      db
    );
    return res.status(status).json(body);
  }

  // PUT /api/user-data?id=:id — update entry
  if (req.method === 'PUT' && id) {
    const { species, product, yield: yieldVal, source, expected_revision: expectedRevision } = req.body ?? {};
    const { status, body } = await handleUpdateUserData(
      { userId, id, species, product, yield: yieldVal, source, expectedRevision },
      db
    );
    return res.status(status).json(body);
  }

  // DELETE /api/user-data?id=:id — delete entry
  if (req.method === 'DELETE' && id) {
    const { expected_revision: expectedRevision } = req.body ?? {};
    const { status, body } = await handleDeleteUserData({ userId, id, expectedRevision }, db);
    return res.status(status).json(body);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default handleCors(requireAuth(handler));
