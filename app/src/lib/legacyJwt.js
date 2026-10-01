// Legacy password sessions (retired by ADR 0001) keep the account in a JWT. The client only
// reads it for display and for choosing where data is stored; the server verifies every token.

function decodeBase64UrlJson(value) {
  try {
    let base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const padding = base64.length % 4;
    if (padding) {
      base64 += '='.repeat(4 - padding);
    }

    const binary = globalThis.atob(base64);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const text = new TextDecoder().decode(bytes);
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function decodeJwtPayload(token) {
  const [, encodedPayload] = String(token ?? '').split('.');
  return encodedPayload ? decodeBase64UrlJson(encodedPayload) : null;
}

// The signed-in user a legacy JWT stands for. The id matters: DataContext keys the account's
// on-device data by it, so without one the account's synced yields would land in the guest scope.
export function legacyUserFromToken(token) {
  const payload = decodeJwtPayload(token);
  if (!payload?.username) return null;
  return {
    id: payload.id,
    username: payload.username,
    email: payload.email || null,
    authProvider: 'password',
  };
}
