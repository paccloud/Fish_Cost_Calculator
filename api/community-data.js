import { query } from './_lib/db.js';
import { handleCors } from './_lib/cors.js';

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const result = await query(
      `SELECT ud.id, ud.species, ud.product, ud.yield, ud.source,
              COALESCE(c.display_name, u.username) AS contributor,
              c.organization
       FROM user_data ud
       JOIN users u ON ud.user_id = u.id
       LEFT JOIN contributors c ON ud.user_id = c.user_id
       WHERE ud.is_shared = true
       ORDER BY ud.species ASC, ud.product ASC`,
      []
    );
    return res.status(200).json(result.rows);
  } catch (err) {
    console.error('[community-data] error:', err);
    return res.status(500).json({ error: 'Failed to load community data' });
  }
}

export default handleCors(handler);
