import { handleCors } from './_lib/cors.js';
import { makeNeonAdapter } from './_lib/neonDb.js';
import { handleListCommunityData } from '../shared/handlers/index.js';

/**
 * Public community yield-data feed.
 * GET /api/community-data            — JSON
 * GET /api/community-data?format=csv — downloadable CSV
 *
 * Query + row shaping (attribution consent, no account identifiers) live in
 * shared/handlers/communityData.js so Express and Vercel stay identical.
 */
async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { status, body, headers } = await handleListCommunityData(
    { format: req.query?.format },
    makeNeonAdapter()
  );

  if (headers && status === 200) {
    for (const [name, value] of Object.entries(headers)) {
      res.setHeader(name, value);
    }
    return res.status(status).send(body);
  }
  return res.status(status).json(body);
}

export default handleCors(handler);
