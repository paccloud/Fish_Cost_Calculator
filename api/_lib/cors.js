/**
 * Set CORS headers on response
 * @param {Object} res - Response object
 */
export function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

/**
 * Higher-order function to handle CORS for a handler
 * @param {Function} handler - The route handler function
 * @returns {Function} Wrapped handler with CORS support
 */
export function handleCors(handler) {
  return async (req, res) => {
    setCorsHeaders(res);

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    return handler(req, res);
  };
}
