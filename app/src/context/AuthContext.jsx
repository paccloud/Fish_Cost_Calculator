import React, { createContext, useContext, useState, useEffect } from 'react';
import { apiClient } from '../lib/apiClient';

const AuthContext = createContext(null);

const decodeJwtPayload = (token) => {
  const tokenParts = token.split('.');
  if (tokenParts.length !== 3) {
    throw new Error('Invalid JWT format');
  }

  const base64 = tokenParts[1].replace(/-/g, '+').replace(/_/g, '/');
  const paddedBase64 = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  return JSON.parse(atob(paddedBase64));
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const applyAuthState = ({ nextUser, clearToken = false }) => {
      queueMicrotask(() => {
        if (cancelled) return;
        if (clearToken) {
          setToken(null);
        }
        setUser(nextUser);
        setLoading(false);
      });
    };

    if (!token) {
      applyAuthState({ nextUser: null });
      return () => { cancelled = true; };
    }

    const clearInvalidToken = () => {
      localStorage.removeItem('token');
      applyAuthState({ nextUser: null, clearToken: true });
    };

    try {
      const payload = decodeJwtPayload(token);
      if (payload.exp && payload.exp * 1000 < Date.now()) {
        clearInvalidToken();
      } else {
        applyAuthState({
          nextUser: { username: payload.username, authProvider: 'password' },
        });
      }
    } catch {
      clearInvalidToken();
    }

    return () => { cancelled = true; };
  }, [token]);

  // Auto-expire token
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

    try {
      const payload = decodeJwtPayload(token);
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
        };

        scheduleExpiry();
      }
    } catch {
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

  const login = async (username, password) => {
    try {
      const data = await apiClient.login(username, password);
      setToken(data.token);
      localStorage.setItem('token', data.token);
      setUser({ username: data.username, authProvider: 'password' });
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  };

  const register = async (username, password) => {
    try {
      await apiClient.register(username, password);
      return true;
    } catch {
      return false;
    }
  };

  const logout = () => {
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
      register
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
