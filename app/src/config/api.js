/**
 * API Configuration
 *
 * In development: uses VITE_API_URL from .env.development (http://localhost:3000)
 * In production: uses empty string for same-origin requests
 */

export const API_URL = import.meta.env.VITE_API_URL || '';

/**
 * Helper function to construct API URLs
 * @param {string} path - API endpoint path (e.g., '/api/login')
 * @returns {string} Full API URL
 */
export function apiUrl(path) {
  return `${API_URL}${path}`;
}
