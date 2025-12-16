import { query } from '../_lib/db.js';
import { requireAuth } from '../_lib/auth.js';
import { handleCors } from '../_lib/cors.js';

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const userId = req.user.id;

  try {
    const result = await query(
      'SELECT * FROM contributors WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    return res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error('Fetch contributor profile error:', err);
    return res.status(500).json({ error: 'Failed to fetch profile' });
  }
}

export default handleCors(requireAuth(handler));
