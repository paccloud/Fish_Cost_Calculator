import React, { createContext, useContext, useState, useEffect } from 'react';
import { apiUrl } from '../config/api';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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
