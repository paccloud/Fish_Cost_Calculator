import { query } from '../_lib/db.js';
import { requireAuth } from '../_lib/auth.js';
import { handleCors } from '../_lib/cors.js';

async function handler(req, res) {
  const userId = req.user.id;

  if (req.method === 'GET') {
    try {
      const result = await query(
        'SELECT id, species, product, yield, source FROM user_data WHERE user_id = $1',
        [userId]
      );

      return res.status(200).json(result.rows);
    } catch (err) {
      console.error('Fetch user data error:', err);
      return res.status(500).json({ error: 'Failed to fetch user data' });
    }
  }

  if (req.method === 'POST') {
    const { species, product, yield: yieldVal, source = 'User Input' } = req.body;

    if (!species || !product || yieldVal === undefined) {
      return res.status(400).json({ error: 'Species, product, and yield are required' });
    }

    try {
      const result = await query(
        'INSERT INTO user_data (user_id, species, product, yield, source) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [userId, species, product, yieldVal, source]
      );

      return res.status(201).json({
        id: result.rows[0].id,
        message: 'Data added successfully'
      });
    } catch (err) {
      console.error('Add user data error:', err);
      return res.status(500).json({ error: 'Failed to add data' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default handleCors(requireAuth(handler));
