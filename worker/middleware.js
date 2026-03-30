import { createAuth } from './auth.js';

/**
 * Hono middleware that validates the session via Better Auth
 * and sets c.get('user') for downstream handlers.
 */
export function authMiddleware() {
  return async (c, next) => {
    const auth = createAuth(c.env.DB, c.env, c.req.raw);
    const session = await auth.api.getSession({
      headers: c.req.raw.headers,
    });

    if (!session) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    c.set('user', session.user);
    c.set('session', session.session);
    await next();
  };
}
