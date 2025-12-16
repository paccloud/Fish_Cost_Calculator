import { Pool } from '@neondatabase/serverless';

// Create a connection pool for Neon
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/**
 * Execute a SQL query with parameters
 * @param {string} text - SQL query string with $1, $2, etc. placeholders
 * @param {Array} params - Array of parameter values
 * @returns {Promise<Object>} Query result with rows array
 */
export async function query(text, params) {
  const client = await pool.connect();
  try {
    const result = await client.query(text, params);
    return result;
  } finally {
    client.release();
  }
}

export default pool;
