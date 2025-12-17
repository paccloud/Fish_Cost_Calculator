import React, { createContext, useState, useContext, useEffect } from 'react';
import { apiUrl } from '../config/api';
import { stackClientApp } from '../config/neonAuth';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [loading, setLoading] = useState(true);

  // Check for Stack Auth (Neon Auth) session on mount
  useEffect(() => {
    const checkSession = async () => {
      try {
        // First check Stack Auth session
        const stackUser = await stackClientApp.getUser();
        if (stackUser) {
          setUser({
            username: stackUser.displayName || stackUser.primaryEmail,
            email: stackUser.primaryEmail,
            avatar: stackUser.profileImageUrl,
            authProvider: 'oauth',
            stackAuthId: stackUser.id
          });
          setLoading(false);
          return;
        }
      } catch (e) {
        console.log('No Stack Auth session:', e.message);
      }

      // Fall back to JWT token
      if (token) {
        const tokenParts = token.split('.');
        if (tokenParts.length !== 3) {
          localStorage.removeItem('token');
          setToken(null);
          setUser(null);
        } else {
          try {
            const payload = JSON.parse(atob(tokenParts[1]));
            if (payload.exp && payload.exp * 1000 < Date.now()) {
              localStorage.removeItem('token');
              setToken(null);
              setUser(null);
            } else {
              setUser({ username: payload.username, authProvider: 'password' });
            }
          } catch {
            localStorage.removeItem('token');
            setToken(null);
            setUser(null);
          }
        }
      }
      setLoading(false);
    };

    checkSession();
  }, [token]);

  useEffect(() => {
    if (!token) return;

    const MAX_TIMEOUT = 2147483647;
    let timeoutId;
    let cancelled = false;

    const clearToken = () => {
      localStorage.removeItem('token');
      setToken(null);
      setUser(null);
    };

    const tokenParts = token.split('.');
    if (tokenParts.length !== 3) {
      localStorage.removeItem('token');
      queueMicrotask(() => {
        setToken(null);
        setUser(null);
      });
      return;
    }

    try {
      const payload = JSON.parse(atob(tokenParts[1]));
      if (payload.exp) {
        const expiryMs = payload.exp * 1000;

        const scheduleExpiry = () => {
          const msUntilExpiry = expiryMs - Date.now();
          if (msUntilExpiry <= 0) {
            localStorage.removeItem('token');
            queueMicrotask(() => {
              setToken(null);
              setUser(null);
            });
            return;
          }
          timeoutId = setTimeout(() => {
            if (cancelled) return;

            const remainingMs = expiryMs - Date.now();
            if (remainingMs > 0) {
              scheduleExpiry();
              return;
            }

            clearToken();
          }, Math.min(msUntilExpiry, MAX_TIMEOUT));
          }, Math.min(msUntilExpiry, MAX_TIMEOUT));
        };

        scheduleExpiry();
      }
    } catch {
      // If decoding fails, clear invalid token
      localStorage.removeItem('token');
      queueMicrotask(() => {
        setToken(null);
        setUser(null);
      });
    }

    return () => {
      cancelled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [token]);

  // Traditional username/password login
  const login = async (username, password) => {
    try {
      const res = await fetch(apiUrl('/api/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (res.ok) {
        setToken(data.token);
        localStorage.setItem('token', data.token);
        setUser({ username: data.username, authProvider: 'password' });
        return true;
      }
      return false;
    } catch (e) {
      console.error(e);
      return false;
    }
  };

  // Traditional username/password registration
  const register = async (username, password) => {
    try {
      const res = await fetch(apiUrl('/api/register'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      if (res.ok) return true;
      return false;
    } catch {
      return false;
    }
  };

  // OAuth sign in (Google, GitHub)
  const signInWithOAuth = async (provider) => {
    try {
      await stackClientApp.signInWithOAuth(provider);
      return true;
    } catch (err) {
      console.error(`${provider} sign-in error:`, err);
      return false;
    }
  };

  // Logout - handles both auth methods
  const logout = async () => {
    try {
      // Sign out from Stack Auth if using OAuth
      if (user?.authProvider === 'oauth') {
        await stackClientApp.signOut();
      }
    } catch (err) {
      console.log('Stack Auth signout error:', err);
    }

    // Clear local state
    setUser(null);
    setToken(null);
    localStorage.removeItem('token');
  };

  return (
    <AuthContext.Provider value={{
      user,
      token,
      loading,
      login,
      logout,
      register,
      signInWithOAuth
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
