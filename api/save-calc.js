import { query } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import { handleCors } from './_lib/cors.js';

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { name, species, product, cost, yield: yieldVal, result } = req.body;
  const userId = req.user.id;

  try {
    const dbResult = await query(
      `INSERT INTO calculations (user_id, name, species, product, cost, yield, result, date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       RETURNING id`,
      [userId, name, species, product, cost, yieldVal, result]
    );

    return res.status(201).json({
      id: dbResult.rows[0].id,
      message: 'Calculation saved successfully'
    });
  } catch (err) {
    console.error('Save calculation error:', err);
    return res.status(500).json({ error: 'Failed to save calculation' });
  }
}

export default handleCors(requireAuth(handler));
