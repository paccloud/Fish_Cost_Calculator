import { betterAuth } from 'better-auth';
import { Pool } from '@neondatabase/serverless';

/**
 * Parse trusted origins from ALLOWED_ORIGINS env var.
 * Falls back to localhost defaults for development.
 */
const trustedOrigins = (
  process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://localhost:3000'
)
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

if (process.env.VERCEL_URL) {
  const vercelUrl = `https://${process.env.VERCEL_URL}`;
  if (!trustedOrigins.includes(vercelUrl)) {
    trustedOrigins.push(vercelUrl);
  }
}

/**
 * Better Auth server instance.
 *
 * Uses a dedicated Neon pool (separate from the app's pool in db.js)
 * so Better Auth manages its own connection lifecycle.
 *
 * Better Auth auto-detects the Pool as PostgreSQL via Kysely's PostgresDialect.
 */
export const auth = betterAuth({
  database: new Pool({
    connectionString: process.env.DATABASE_URL,
  }),

  baseURL: process.env.BETTER_AUTH_URL
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined)
    || 'http://localhost:3000',
  basePath: '/api/auth',

  trustedOrigins,

  emailAndPassword: {
    enabled: true,
  },

  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    },
  },

  user: {
    additionalFields: {
      role: {
        type: 'string',
        required: false,
        defaultValue: 'fisher',
        input: false,
      },
    },
  },

  session: {
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60, // 5 minutes
    },
  },

  advanced: {
    crossSubDomainCookies: {
      enabled: false,
    },
  },
});
