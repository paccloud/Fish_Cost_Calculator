import React, { createContext, useState, useContext, useEffect } from 'react';
import { apiUrl } from '../config/api';
import { neonAuth } from '../config/neonAuth';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [loading, setLoading] = useState(true);

  // Check for Neon Auth session on mount
  useEffect(() => {
    const checkSession = async () => {
      try {
        // First check Neon Auth session
        const session = await neonAuth.getSession();
        if (session?.user) {
          setUser({
            username: session.user.name || session.user.email,
            email: session.user.email,
            avatar: session.user.image,
            authProvider: 'oauth',
            neonAuthId: session.user.id
          });
          setLoading(false);
          return;
        }
      } catch (e) {
        console.log('No Neon Auth session');
      }

      // Fall back to JWT token
      if (token) {
        try {
          const payload = JSON.parse(atob(token.split('.')[1]));
          setUser({ username: payload.username, authProvider: 'password' });
        } catch (e) {
          localStorage.removeItem('token');
          setToken(null);
        }
      }
      setLoading(false);
    };

    checkSession();
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
    } catch(e) {
      return false;
    }
  };

  // OAuth sign in (Google, GitHub)
  const signInWithOAuth = async (provider) => {
    try {
      await neonAuth.signIn.social({
        provider: provider, // 'google' or 'github'
        callbackURL: window.location.origin,
      });
      return true;
    } catch (e) {
      console.error(`${provider} sign-in error:`, e);
      return false;
    }
  };

  // Logout - handles both auth methods
  const logout = async () => {
    try {
      // Sign out from Neon Auth if using OAuth
      if (user?.authProvider === 'oauth') {
        await neonAuth.signOut();
      }
    } catch (e) {
      console.log('Neon signout error:', e);
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
