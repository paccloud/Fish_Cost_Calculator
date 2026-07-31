import React, { createContext, useContext, useState, useCallback, useLayoutEffect } from 'react';
import { apiUrl } from '../config/api';
import {
  clearFirebaseSession,
  createGoogleAuthUri,
  loadFirebaseSession,
  sendEmailVerification,
  signInWithEmailPassword,
  signInWithGoogleCallback,
  signUpWithEmailPassword,
} from '../lib/firebaseRestAuth';

const AuthContext = createContext(null);

const defaultAuthApi = {
  clearFirebaseSession,
  createGoogleAuthUri,
  loadFirebaseSession,
  sendEmailVerification,
  signInWithEmailPassword,
  signInWithGoogleCallback,
  signUpWithEmailPassword,
};

function decodeBase64UrlJson(value) {
  try {
    let base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const padding = base64.length % 4;
    if (padding) {
      base64 += '='.repeat(4 - padding);
    }

    const binary = globalThis.atob(base64);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const text = new TextDecoder().decode(bytes);
    return JSON.parse(text);
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

function loadInitialAuthSession(authApi = defaultAuthApi, options = {}) {
  const firebaseUser = authApi.loadFirebaseSession(options);
  if (firebaseUser) {
    return { user: firebaseUser, token: null };
  }

  return loadLegacyJwtSession() || { user: null, token: null };
}

export const AuthProvider = ({ children, authApi = defaultAuthApi }) => {
  const [initialSession] = useState(() =>
    loadInitialAuthSession(authApi, {})
  );
  const [user, setUser] = useState(initialSession.user);
  const [token, setToken] = useState(initialSession.token);
  const [loading] = useState(false);

  const handleAuthFailure = useCallback(() => {
    setUser(null);
    setToken(null);
  }, []);

  // Wire the handler after mount so the initial Firebase session calls handleAuthFailure
  // when getIdToken() fails (e.g. token refresh error). user?.setOnAuthFailure is exposed
  // by createFirebaseSession specifically for this post-mount wiring.
  useLayoutEffect(() => {
    user?.setOnAuthFailure?.(handleAuthFailure);
  }, [user, handleAuthFailure]);

  const login = async (identifier, password) => {
    const isEmail = identifier.includes('@');
    if (isEmail) {
      const firebaseUser = await authApi.signInWithEmailPassword(identifier, password, {
        onAuthFailure: handleAuthFailure,
      });
      globalThis.localStorage?.removeItem('token');
      setToken(null);
      setUser(firebaseUser);
    } else {
      const response = await globalThis.fetch(apiUrl('/api/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: identifier, password }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Invalid credentials.');
      }
      const data = await response.json();
      globalThis.localStorage?.setItem('token', data.token);
      setToken(data.token);
      setUser({ username: data.username, authProvider: 'password' });
    }
    return true;
  };

  const register = async (email, password) => {
    // storage: null prevents persisting the unverified session to localStorage.
    // Without this, a page reload during the verification-pending state would
    // rehydrate the session and present the user as signed in while the backend
    // rejects all protected requests (emailVerified is still false).
    const firebaseUser = await authApi.signUpWithEmailPassword(email, password, {
      onAuthFailure: handleAuthFailure,
      storage: null,
    });
    const idToken = await firebaseUser.getIdToken();
    await authApi.sendEmailVerification(idToken);
    return { verificationSent: true };
  };

  const loginWithGoogle = async () => {
    const continueUri = `${globalThis.location?.origin || ''}/login`;
    const { authUri, sessionId } = await authApi.createGoogleAuthUri(continueUri);
    globalThis.sessionStorage?.setItem('firebase_google_session_id', sessionId);
    globalThis.location.href = authUri;
  };

  const completeGoogleSignIn = async () => {
    const sessionId = globalThis.sessionStorage?.getItem('firebase_google_session_id');
    if (!sessionId) return null;
    globalThis.sessionStorage?.removeItem('firebase_google_session_id');
    const requestUri = globalThis.location?.href;
    const firebaseUser = await authApi.signInWithGoogleCallback(requestUri, sessionId, {
      onAuthFailure: handleAuthFailure,
    });
    globalThis.localStorage?.removeItem('token');
    setToken(null);
    setUser(firebaseUser);
    return firebaseUser;
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
      register,
      loginWithGoogle,
      completeGoogleSignIn,
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
