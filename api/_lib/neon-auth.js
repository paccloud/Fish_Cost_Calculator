/**
 * Neon Auth session verification for backend API
 * Verifies OAuth sessions from Neon Auth
 */

const NEON_AUTH_URL = process.env.NEON_AUTH_URL;

/**
 * Verify Neon Auth session from request cookies/headers
 * @param {Object} req - Request object
 * @returns {Object|null} User info or null if not authenticated
 */
export async function verifyNeonAuthSession(req) {
  if (!NEON_AUTH_URL) {
    return null;
  }

  try {
    // Get session cookie from request
    const cookies = req.headers.cookie || '';

    // Forward cookies to Neon Auth to verify session
    const response = await fetch(`${NEON_AUTH_URL}/api/auth/get-session`, {
      method: 'GET',
      headers: {
        'Cookie': cookies,
      },
      credentials: 'include',
    });

    if (!response.ok) {
      return null;
    }

    const session = await response.json();

    if (session?.user) {
      return {
        id: session.user.id,
        email: session.user.email,
        username: session.user.name || session.user.email,
        avatar: session.user.image,
        authProvider: 'oauth',
        neonAuthId: session.user.id,
      };
    }

    return null;
  } catch (err) {
    console.error('Neon Auth session verification error:', err);
    return null;
  }
}

/**
 * Get or create local user from Neon Auth session
 * Links OAuth users to local user records for database operations
 * @param {Object} neonUser - User from Neon Auth session
 * @param {Function} query - Database query function
 * @returns {Object} Local user record
 */
export async function getOrCreateLocalUser(neonUser, query) {
  if (!neonUser?.neonAuthId) {
    return null;
  }

  try {
    // Check if user already exists by neon_auth_id
    let result = await query(
      'SELECT id, username, email FROM users WHERE neon_auth_id = $1',
      [neonUser.neonAuthId]
    );

    if (result.rows.length > 0) {
      return result.rows[0];
    }

    // Check if user exists by email (might have registered before OAuth)
    if (neonUser.email) {
      result = await query(
        'SELECT id, username, email, neon_auth_id FROM users WHERE email = $1',
        [neonUser.email]
      );

      if (result.rows.length > 0) {
        // Link existing user to Neon Auth
        if (!result.rows[0].neon_auth_id) {
          await query(
            'UPDATE users SET neon_auth_id = $1, avatar_url = $2, auth_provider = $3 WHERE id = $4',
            [neonUser.neonAuthId, neonUser.avatar, 'oauth', result.rows[0].id]
          );
        }
        return result.rows[0];
      }
    }

    // Create new user for OAuth login
    const username = neonUser.username || neonUser.email?.split('@')[0] || `user_${Date.now()}`;

    result = await query(
      `INSERT INTO users (username, email, neon_auth_id, avatar_url, auth_provider)
       VALUES ($1, $2, $3, $4, 'oauth')
       RETURNING id, username, email`,
      [username, neonUser.email, neonUser.neonAuthId, neonUser.avatar]
    );

    return result.rows[0];
  } catch (err) {
    console.error('Error getting/creating local user:', err);
    return null;
  }
}
