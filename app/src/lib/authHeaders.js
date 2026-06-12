export async function getAuthHeaders(user, baseHeaders = {}) {
  const headers = { ...baseHeaders };

  const token = localStorage.getItem('token');
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

export function hasAuthCredential(user) {
  if (!user) return false;
  return Boolean(localStorage.getItem('token'));
}
