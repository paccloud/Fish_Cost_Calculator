import React, { createContext, useContext, useState } from 'react';
import {
  clearFirebaseSession,
  loadFirebaseSession,
  signInWithEmailPassword,
  signUpWithEmailPassword,
} from '../lib/firebaseRestAuth';

const AuthContext = createContext(null);

const defaultAuthApi = {
  clearFirebaseSession,
  loadFirebaseSession,
  signInWithEmailPassword,
  signUpWithEmailPassword,
};

function decodeBase64UrlJson(value) {
  try {
    let base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const padding = base64.length % 4;
    if (padding) {
      base64 += '='.repeat(4 - padding);
    }

    return JSON.parse(globalThis.atob(base64));
  } catch {
    return null;
  }
}

function loadLegacyJwtSession(storage = globalThis.localStorage) {
  if (!storage || typeof storage.getItem !== 'function') {
    return null;
  }

  const storedToken = storage.getItem('token');
  if (!storedToken) {
    return null;
  }

  const [, encodedPayload] = storedToken.split('.');
  const payload = encodedPayload ? decodeBase64UrlJson(encodedPayload) : null;
  if (!payload?.username) {
    storage.removeItem?.('token');
    return null;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp <= nowSeconds) {
    storage.removeItem?.('token');
    return null;
  }

  return {
    token: storedToken,
    user: {
      id: payload.id,
      username: payload.username,
      email: payload.email || null,
      authProvider: 'password',
    },
  };
}

function loadInitialAuthSession(authApi = defaultAuthApi) {
  const firebaseUser = authApi.loadFirebaseSession();
  if (firebaseUser) {
    return { user: firebaseUser, token: null };
  }

  return loadLegacyJwtSession() || { user: null, token: null };
}

export const AuthProvider = ({ children, authApi = defaultAuthApi }) => {
  const [initialSession] = useState(() => loadInitialAuthSession(authApi));
  const [user, setUser] = useState(initialSession.user);
  const [token, setToken] = useState(initialSession.token);
  const [loading] = useState(false);

  const handleAuthFailure = () => {
    setUser(null);
    setToken(null);
  };

  const login = async (email, password) => {
    const firebaseUser = await authApi.signInWithEmailPassword(email, password, {
      onAuthFailure: handleAuthFailure,
    });
    globalThis.localStorage?.removeItem('token');
    setToken(null);
    setUser(firebaseUser);
    return true;
  };

  const register = async (email, password) => {
    const firebaseUser = await authApi.signUpWithEmailPassword(email, password, {
      onAuthFailure: handleAuthFailure,
    });
    globalThis.localStorage?.removeItem('token');
    setToken(null);
    setUser(firebaseUser);
    return true;
  };

  const logout = async () => {
    authApi.clearFirebaseSession();
    setUser(null);
    setToken(null);
    globalThis.localStorage?.removeItem('token');
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
