import { StackClientApp } from "@stackframe/react";

// Create Stack Auth client (Neon Auth is powered by Stack Auth)
export const stackClientApp = new StackClientApp({
  projectId: import.meta.env.VITE_STACK_PROJECT_ID,
  publishableClientKey: import.meta.env.VITE_STACK_PUBLISHABLE_CLIENT_KEY,
  tokenStore: "cookie",
});

// Export for backward compatibility
export const neonAuth = stackClientApp;
