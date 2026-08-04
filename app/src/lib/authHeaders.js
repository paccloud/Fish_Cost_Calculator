export async function getAuthHeaders(user, baseHeaders = {}) {
  const headers = { ...baseHeaders };

  if (user?.authProvider === 'firebase' && typeof user.getIdToken === 'function') {
    try {
      const idToken = await user.getIdToken();
      if (idToken) {
        headers.Authorization = `Bearer ${idToken}`;
      }
    } catch (err) {
      console.error('Failed to get Firebase ID token:', err);
      throw err;
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
  if (user.authProvider === 'firebase') return typeof user.getIdToken === 'function';
  return Boolean(localStorage.getItem('token'));
}
