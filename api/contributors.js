import { query } from './_lib/db.js';
import { handleCors } from './_lib/cors.js';

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Public endpoint - get all visible contributors with contribution count
    const result = await query(
      `SELECT c.*, u.username, COUNT(ud.id) as contribution_count
       FROM contributors c
       JOIN users u ON c.user_id = u.id
       LEFT JOIN user_data ud ON c.user_id = ud.user_id
       WHERE c.show_on_page = true
       GROUP BY c.id, u.username
       ORDER BY contribution_count DESC`
    );

    return res.status(200).json(result.rows);
  } catch (err) {
    console.error('Fetch contributors error:', err);
    return res.status(500).json({ error: 'Failed to fetch contributors' });
  }
}

export default handleCors(handler);
