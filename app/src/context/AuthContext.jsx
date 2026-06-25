import React, { createContext, useContext, useState } from 'react';
import {
  clearFirebaseSession,
  loadFirebaseSession,
  signInWithEmailPassword,
  signUpWithEmailPassword,
} from '../lib/firebaseRestAuth';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(() => loadFirebaseSession());
  const [token, setToken] = useState(null);
  const [loading] = useState(false);

  const login = async (email, password) => {
    try {
      const firebaseUser = await signInWithEmailPassword(email, password);
      localStorage.removeItem('token');
      setToken(null);
      setUser(firebaseUser);
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  };

  const register = async (email, password) => {
    try {
      const firebaseUser = await signUpWithEmailPassword(email, password);
      localStorage.removeItem('token');
      setToken(null);
      setUser(firebaseUser);
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  };

  const logout = async () => {
    clearFirebaseSession();
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
