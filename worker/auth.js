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
export function createAuth(db, env, request) {
  // Derive baseURL from the incoming request or fall back to env vars
  const baseURL = request
    ? new URL(request.url).origin
    : env.APP_URL || env.CF_PAGES_URL || 'http://localhost:8787';

  return betterAuth({
    database: {
      dialect: new D1Dialect({ database: db }),
      type: 'sqlite',
    },
    baseURL,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: env.ALLOWED_ORIGINS
      ? env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
      : [],
    session: {
      cookieCache: {
        enabled: true,
        maxAge: 300, // 5 minutes
      },
    },
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
