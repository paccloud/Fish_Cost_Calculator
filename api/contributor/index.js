import { query } from '../_lib/db.js';
import { requireAuth } from '../_lib/auth.js';
import { handleCors } from '../_lib/cors.js';

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const userId = req.user.id;
  const { display_name, organization, bio, show_on_page } = req.body;

  // Convert boolean to match PostgreSQL BOOLEAN type
  const showOnPageBool = show_on_page === true || show_on_page === 'true' || show_on_page === 1;

  try {
    // Check if contributor profile exists
    const existing = await query(
      'SELECT * FROM contributors WHERE user_id = $1',
      [userId]
    );

    if (existing.rows.length > 0) {
      // Update existing profile
      await query(
        `UPDATE contributors
         SET display_name = $1,
             organization = $2,
             bio = $3,
             show_on_page = $4,
             updated_at = NOW()
         WHERE user_id = $5`,
        [display_name, organization, bio, showOnPageBool, userId]
      );

      return res.status(200).json({ message: 'Profile updated successfully' });
    } else {
      // Create new profile
      const result = await query(
        `INSERT INTO contributors (user_id, display_name, organization, bio, show_on_page, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
         RETURNING id`,
        [userId, display_name, organization, bio, showOnPageBool]
      );

      return res.status(201).json({
        id: result.rows[0].id,
        message: 'Profile created successfully'
      });
    }
  } catch (err) {
    console.error('Save contributor profile error:', err);
    return res.status(500).json({ error: 'Failed to save profile' });
  }
}

export default handleCors(requireAuth(handler));
