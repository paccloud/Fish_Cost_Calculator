import { stackClientApp } from '../config/neonAuth';

export async function getAuthHeaders(user, baseHeaders = {}) {
  const headers = { ...baseHeaders };

  if (user?.authProvider === 'oauth') {
    try {
      const stackUser = await stackClientApp.getUser();
      const authJson = stackUser ? await stackUser.getAuthJson() : null;
      if (authJson?.accessToken) {
        headers['x-stack-access-token'] = authJson.accessToken;
        return headers;
      }
    } catch (err) {
      console.error('Failed to get Stack Auth token:', err);
    }

    return headers;
  }

  const token = localStorage.getItem('token');
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

export function hasAuthCredential(user) {
  if (!user) return false;
  if (user.authProvider === 'oauth') return true;
  return Boolean(localStorage.getItem('token'));
}
