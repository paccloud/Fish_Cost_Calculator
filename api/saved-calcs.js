import { query } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import { handleCors } from './_lib/cors.js';

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const userId = req.user.id;

  try {
    const result = await query(
      'SELECT * FROM calculations WHERE user_id = $1 ORDER BY date DESC',
      [userId]
    );

    return res.status(200).json(result.rows);
  } catch (err) {
    console.error('Fetch calculations error:', err);
    return res.status(500).json({ error: 'Failed to fetch calculations' });
  }
}

export default handleCors(requireAuth(handler));
