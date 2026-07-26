import { query } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import { handleCors } from './_lib/cors.js';

async function handler(req, res) {
  const userId = req.user.id;
  const { id, action } = req.query;

  // POST /api/user-data?id=:id&action=share|unshare — toggle community sharing
  if (req.method === 'POST' && id && action) {
    const is_shared = action === 'share';
    try {
      const existing = await query(
        'SELECT id FROM user_data WHERE id = $1 AND user_id = $2',
        [id, userId]
      );
      if (existing.rows.length === 0) {
        return res.status(404).json({ error: 'Entry not found or not owned by user' });
      }
      await query(
        'UPDATE user_data SET is_shared = $1 WHERE id = $2 AND user_id = $3',
        [is_shared, id, userId]
      );
      return res.status(200).json({ message: is_shared ? 'Shared with community' : 'Removed from community' });
    } catch (err) {
      console.error('[user-data share] error:', err);
      return res.status(500).json({ error: 'Failed to update sharing status' });
    }
  }

  // GET /api/user-data — list all entries for this user
  if (req.method === 'GET' && !id) {
    try {
      const result = await query(
        'SELECT id, species, product, yield, source, is_shared FROM user_data WHERE user_id = $1',
        [userId]
      );
      return res.status(200).json(result.rows);
    } catch (err) {
      console.error('[user-data GET] error:', err);
      return res.status(500).json({ error: 'Failed to fetch user data' });
    }
  }

  // POST /api/user-data — create new entry
  if (req.method === 'POST' && !id) {
    const { species, product, yield: yieldVal, source = 'User Input' } = req.body;
    if (!species || !product || yieldVal === undefined) {
      return res.status(400).json({ error: 'Species, product, and yield are required' });
    }
    try {
      const result = await query(
        'INSERT INTO user_data (user_id, species, product, yield, source) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [userId, species, product, yieldVal, source]
      );
      return res.status(201).json({ id: result.rows[0].id, message: 'Data added successfully' });
    } catch (err) {
      console.error('[user-data POST] error:', err);
      return res.status(500).json({ error: 'Failed to add data' });
    }
  }

  // PUT /api/user-data?id=:id — update entry
  if (req.method === 'PUT' && id) {
    const { species, product, yield: yieldVal, source } = req.body;
    try {
      const existing = await query(
        'SELECT id FROM user_data WHERE id = $1 AND user_id = $2',
        [id, userId]
      );
      if (existing.rows.length === 0) {
        return res.status(404).json({ error: 'Entry not found or not owned by user' });
      }
      await query(
        `UPDATE user_data
         SET species = COALESCE($1, species),
             product = COALESCE($2, product),
             yield = COALESCE($3, yield),
             source = COALESCE($4, source)
         WHERE id = $5 AND user_id = $6`,
        [species, product, yieldVal, source, id, userId]
      );
      return res.status(200).json({ message: 'Updated successfully' });
    } catch (err) {
      console.error('[user-data PUT] error:', err);
      return res.status(500).json({ error: 'Failed to update data' });
    }
  }

  // DELETE /api/user-data?id=:id — delete entry
  if (req.method === 'DELETE' && id) {
    try {
      const existing = await query(
        'SELECT id FROM user_data WHERE id = $1 AND user_id = $2',
        [id, userId]
      );
      if (existing.rows.length === 0) {
        return res.status(404).json({ error: 'Entry not found or not owned by user' });
      }
      await query('DELETE FROM user_data WHERE id = $1 AND user_id = $2', [id, userId]);
      return res.status(200).json({ message: 'Deleted successfully' });
    } catch (err) {
      console.error('[user-data DELETE] error:', err);
      return res.status(500).json({ error: 'Failed to delete data' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default handleCors(requireAuth(handler));
