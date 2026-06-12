import { requireAuth } from './_lib/auth.js';
import { handleCors } from './_lib/cors.js';
import { makeNeonAdapter } from './_lib/neonDb.js';
import { handleExport } from '../shared/handlers/index.js';

/**
 * Consolidated export endpoint
 * GET /api/export?type=calcs - Export calculations
 * GET /api/export?type=data - Export user data
 */
async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const userId = req.user.id;
  const exportType = req.query?.type || 'calcs';
  const db = makeNeonAdapter();

  const { status, body } = await handleExport({ userId, type: exportType }, db);
  if (status !== 200) {
    return res.status(status).json(body);
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=${body.filename}`);
  return res.status(200).send(body.csv);
}

export default handleCors(requireAuth(handler));
