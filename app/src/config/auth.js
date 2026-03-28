import { createAuthClient } from "better-auth/react";
import { apiUrl } from './api';

const baseURL = apiUrl('');
export const authClient = createAuthClient({
  ...(baseURL && { baseURL }),
});
