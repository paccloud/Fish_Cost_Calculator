import { Pool } from '@neondatabase/serverless';

// Pool is created lazily on first query to avoid module-load-time side effects
// in serverless cold-start environments where DATABASE_URL may not be available
// during Vercel's function bundling/validation phase.
let pool = null;

function getPool() {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return pool;
}

/**
 * Execute a SQL query with parameters
 * @param {string} text - SQL query string with $1, $2, etc. placeholders
 * @param {Array} params - Array of parameter values
 * @returns {Promise<Object>} Query result with rows array
 */
export async function query(text, params) {
  const client = await getPool().connect();
  try {
    const result = await client.query(text, params);
    return result;
  } finally {
    client.release();
  }
}

export { getPool as default };
