import { betterAuth } from 'better-auth';
import { D1Dialect } from 'kysely-d1';

/**
 * Create a Better Auth instance configured for Cloudflare Workers + D1.
 * Called per-request since Workers are stateless and env bindings
 * are only available inside the fetch handler.
 *
 * @param {D1Database} db - The D1 database binding from env
 * @param {Record<string, string>} env - Worker environment bindings
 */
export function createAuth(db, env) {
  return betterAuth({
    database: {
      dialect: new D1Dialect({ database: db }),
      type: 'sqlite',
    },
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: env.ALLOWED_ORIGINS
      ? env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
      : [],
    emailAndPassword: { enabled: true },
    socialProviders: {
      ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: env.GOOGLE_CLIENT_ID,
              clientSecret: env.GOOGLE_CLIENT_SECRET,
            },
          }
        : {}),
    },
    user: {
      additionalFields: {
        role: {
          type: 'string',
          defaultValue: 'fisher',
          input: false,
        },
      },
    },
  });
}
