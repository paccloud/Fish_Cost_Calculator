/**
 * Stack Auth (Neon Auth) session verification for backend API
 * Verifies OAuth sessions using Stack Auth REST API
 */

const STACK_PROJECT_ID = process.env.VITE_STACK_PROJECT_ID || process.env.STACK_PROJECT_ID;
const STACK_SECRET_SERVER_KEY = process.env.STACK_SECRET_SERVER_KEY;

/**
 * Verify Stack Auth session from request headers
 * Uses the x-stack-access-token header or Authorization Bearer token
 * @param {Object} req - Request object
 * @returns {Object|null} User info or null if not authenticated
 */
export async function verifyNeonAuthSession(req) {
  if (!STACK_PROJECT_ID || !STACK_SECRET_SERVER_KEY) {
    console.log('Stack Auth not configured: missing project ID or secret key');
    return null;
  }

  try {
    // Get access token from headers
    // Stack Auth sends token in x-stack-access-token or Authorization header
    let accessToken = req.headers['x-stack-access-token'];
    
    if (!accessToken) {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        accessToken = authHeader.split(' ')[1];
      }
    }

    if (!accessToken) {
      return null;
    }

    // Verify token with Stack Auth API
    const response = await fetch('https://api.stack-auth.com/api/v1/users/me', {
      method: 'GET',
      headers: {
        'x-stack-access-type': 'server',
        'x-stack-project-id': STACK_PROJECT_ID,
        'x-stack-secret-server-key': STACK_SECRET_SERVER_KEY,
        'x-stack-access-token': accessToken,
      },
    });

    if (!response.ok) {
      return null;
    }

    const user = await response.json();

    if (user?.id) {
      return {
        id: user.id,
        email: user.primary_email || user.primaryEmail,
        username: user.display_name || user.displayName || user.primary_email,
        avatar: user.profile_image_url || user.profileImageUrl,
        authProvider: 'oauth',
        stackAuthId: user.id,
      };
    }

    return null;
  } catch (err) {
    console.error('Stack Auth session verification error:', err);
    return null;
  }
}

/**
 * Get or create local user from Stack Auth session
 * Links OAuth users to local user records for database operations
 * @param {Object} stackUser - User from Stack Auth session
 * @param {Function} query - Database query function
 * @returns {Object} Local user record
 */
export async function getOrCreateLocalUser(stackUser, query) {
  if (!stackUser?.stackAuthId) {
    return null;
  }

  try {
    // Check if user already exists by stack_auth_id (stored in neon_auth_id column for compatibility)
    let result = await query(
      'SELECT id, username, email FROM users WHERE neon_auth_id = $1',
      [stackUser.stackAuthId]
    );

    if (result.rows.length > 0) {
      return result.rows[0];
    }

    // Check if user exists by email (might have registered before OAuth)
    if (stackUser.email) {
      result = await query(
        'SELECT id, username, email, neon_auth_id FROM users WHERE email = $1',
        [stackUser.email]
      );

      if (result.rows.length > 0) {
        // Link existing user to Stack Auth
        if (!result.rows[0].neon_auth_id) {
          await query(
            'UPDATE users SET neon_auth_id = $1, avatar_url = $2, auth_provider = $3 WHERE id = $4',
            [stackUser.stackAuthId, stackUser.avatar, 'oauth', result.rows[0].id]
          );
        }
        return result.rows[0];
      }
    }

    // Create new user for OAuth login
    const username = stackUser.username || stackUser.email?.split('@')[0] || `user_${Date.now()}`;

    result = await query(
      `INSERT INTO users (username, email, neon_auth_id, avatar_url, auth_provider)
       VALUES ($1, $2, $3, $4, 'oauth')
       RETURNING id, username, email`,
      [username, stackUser.email, stackUser.stackAuthId, stackUser.avatar]
    );

    return result.rows[0];
  } catch (err) {
    console.error('Error getting/creating local user:', err);
    return null;
  }
}
