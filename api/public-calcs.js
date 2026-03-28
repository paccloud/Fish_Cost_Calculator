import { query } from './_lib/db.js';
import { handleCors } from './_lib/cors.js';

/**
 * Public endpoint to get all saved calculations
 * No authentication required - for guest access
 * GET /api/public-calcs
 */
async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get all calculations, excluding user_id for privacy
    // Order by date descending, limit to 100 for performance
    const result = await query(
      `SELECT id, species, product, cost, yield, result, date
       FROM calculations
       ORDER BY date DESC
       LIMIT 100`
    );

    return res.status(200).json(result.rows);
  } catch (err) {
    console.error('Fetch public calculations error:', err);
    return res.status(500).json({ error: 'Failed to fetch calculations' });
  }
}

export default handleCors(handler);
