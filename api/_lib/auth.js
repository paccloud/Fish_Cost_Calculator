import { auth } from './better-auth.js';
import { fromNodeHeaders } from 'better-auth/node';
import { query } from './db.js';

/**
 * Look up the local `users` table record that corresponds to a Better Auth user.
 *
 * Better Auth stores users in its own `user` table with its own IDs.
 * The app's tables (calculations, user_data, contributors) reference
 * the legacy `users.id` column. This function bridges the two by
 * matching on email, then falling back to creating a new local record.
 *
 * @param {Object} betterAuthUser - User object from Better Auth session
 * @returns {Object|null} Local user record { id, username, email, authProvider }
 */
async function getLocalUser(betterAuthUser) {
  if (!betterAuthUser?.email) {
    return null;
  }

  try {
    // Try to find existing local user by email
    let result = await query(
      'SELECT id, username, email, auth_provider FROM users WHERE email = $1',
      [betterAuthUser.email]
    );

    if (result.rows.length > 0) {
      return {
        id: result.rows[0].id,
        username: result.rows[0].username,
        email: result.rows[0].email,
        authProvider: result.rows[0].auth_provider || 'better-auth',
      };
    }

    // No local user found — create one
    const username =
      betterAuthUser.name ||
      betterAuthUser.email.split('@')[0] ||
      `user_${Date.now()}`;

    result = await query(
      `INSERT INTO users (username, email, auth_provider)
       VALUES ($1, $2, 'better-auth')
       RETURNING id, username, email, auth_provider`,
      [username, betterAuthUser.email]
    );

    return {
      id: result.rows[0].id,
      username: result.rows[0].username,
      email: result.rows[0].email,
      authProvider: 'better-auth',
    };
  } catch (err) {
    console.error('Error resolving local user:', err);
    return null;
  }
}

/**
 * Verify the current request's session via Better Auth.
 *
 * @param {Object} req - Node/Vercel request object
 * @returns {Object|null} Local user object or null if not authenticated
 */
export async function verifyUser(req) {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session?.user) {
      return null;
    }

    // Map Better Auth user to local database user
    const localUser = await getLocalUser(session.user);
    return localUser;
  } catch (err) {
    console.error('Better Auth session verification error:', err);
    return null;
  }
}

/**
 * Higher-order function to require authentication for a handler.
 *
 * Verifies the Better Auth session cookie and attaches `req.user`
 * with the LOCAL database user ID (not Better Auth's internal ID),
 * because all app queries use `users.id` as the foreign key.
 *
 * @param {Function} handler - The route handler function
 * @returns {Function} Wrapped handler that requires auth
 */
export function requireAuth(handler) {
  return async (req, res) => {
    const user = await verifyUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    req.user = user;
    return handler(req, res);
  };
}
