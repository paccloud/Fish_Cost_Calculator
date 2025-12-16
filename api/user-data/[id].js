import { query } from '../_lib/db.js';
import { requireAuth } from '../_lib/auth.js';
import { handleCors } from '../_lib/cors.js';

async function handler(req, res) {
  const { id } = req.query;
  const userId = req.user.id;

  if (req.method === 'PUT') {
    const { species, product, yield: yieldVal, source } = req.body;

    try {
      // Verify ownership
      const existing = await query(
        'SELECT * FROM user_data WHERE id = $1 AND user_id = $2',
        [id, userId]
      );

      if (existing.rows.length === 0) {
        return res.status(404).json({ error: 'Entry not found or not owned by user' });
      }

      // Update with COALESCE to allow partial updates
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
      console.error('Update user data error:', err);
      return res.status(500).json({ error: 'Failed to update data' });
    }
  }

  if (req.method === 'DELETE') {
    try {
      // Verify ownership
      const existing = await query(
        'SELECT * FROM user_data WHERE id = $1 AND user_id = $2',
        [id, userId]
      );

      if (existing.rows.length === 0) {
        return res.status(404).json({ error: 'Entry not found or not owned by user' });
      }

      // Delete entry
      await query(
        'DELETE FROM user_data WHERE id = $1 AND user_id = $2',
        [id, userId]
      );

      return res.status(200).json({ message: 'Deleted successfully' });
    } catch (err) {
      console.error('Delete user data error:', err);
      return res.status(500).json({ error: 'Failed to delete data' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default handleCors(requireAuth(handler));
