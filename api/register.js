import bcrypt from 'bcrypt';
import { query } from './_lib/db.js';
import { handleCors } from './_lib/cors.js';

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    // Hash password with 10 rounds
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert new user
    const result = await query(
      'INSERT INTO users (username, password) VALUES ($1, $2) RETURNING id, username',
      [username, hashedPassword]
    );

    const user = result.rows[0];
    return res.status(201).json({ id: user.id, username: user.username });
  } catch (err) {
    // Check for unique constraint violation
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Username already exists' });
    }
    console.error('Registration error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

export default handleCors(handler);
