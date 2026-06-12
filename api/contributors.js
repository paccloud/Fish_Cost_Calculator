import { handleCors } from './_lib/cors.js';
import { makeNeonAdapter } from './_lib/neonDb.js';
import { handleListContributors } from '../shared/handlers/index.js';

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { status, body } = await handleListContributors({}, makeNeonAdapter());
  return res.status(status).json(body);
}

export default handleCors(handler);
