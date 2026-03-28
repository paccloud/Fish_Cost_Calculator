import React, { createContext, useContext, useCallback } from 'react';
import { authClient } from '../config/auth';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const { data: session, isPending: loading } = authClient.useSession();

  const user = session?.user
    ? {
        username: session.user.name || session.user.email,
        email: session.user.email,
        avatar: session.user.image,
        authProvider: 'email',
        role: session.user.role || 'user',
      }
    : null;

  const login = useCallback(async (email, password) => {
    try {
      const result = await authClient.signIn.email({ email, password });
      if (result.error) {
        console.error('Login error:', result.error);
        return false;
      }
      return true;
    } catch (e) {
      console.error('Login error:', e);
      return false;
    }
  }, []);

  const register = useCallback(async (email, password, username) => {
    try {
      const result = await authClient.signUp.email({
        email,
        password,
        name: username,
      });
      if (result.error) {
        console.error('Register error:', result.error);
        return false;
      }
      return true;
    } catch (e) {
      console.error('Register error:', e);
      return false;
    }
  }, []);

  const signInWithGoogle = useCallback(async () => {
    try {
      await authClient.signIn.social({ provider: "google" });
      return true;
    } catch (e) {
      console.error('Google sign-in error:', e);
      return false;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await authClient.signOut();
    } catch (e) {
      console.error('Logout error:', e);
    }
  }, []);

  return (
    <AuthContext.Provider value={{
      user,
      loading,
      login,
      logout,
      register,
      signInWithGoogle,
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
