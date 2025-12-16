import { createClient } from '@neondatabase/neon-js';
import { BetterAuthReactAdapter } from '@neondatabase/neon-js/auth/react/adapters';

// Create Neon Auth client with React adapter for hooks support
export const neonClient = createClient({
  auth: {
    adapter: BetterAuthReactAdapter(),
    url: import.meta.env.VITE_NEON_AUTH_URL,
  },
});

// Export auth client for direct access
export const neonAuth = neonClient.auth;
