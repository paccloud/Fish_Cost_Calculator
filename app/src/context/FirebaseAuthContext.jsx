import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut as firebaseSignOut } from 'firebase/auth';
import { clearIndexedDbPersistence, terminate, waitForPendingWrites } from 'firebase/firestore';
import { getFirebaseAuth, getFirestoreDb, resetFirestoreDb } from '../lib/firebase';
import { runSignOut } from '../lib/firebaseSignOut';

// The Firebase SDK session (ADR 0001, issue #123). It lives next to the
// REST-based AuthContext until the Neon-backed pages are removed (#133): both
// use the same Firebase project, so a Google account has the same uid in
// each. `services` is injected by tests; the default talks to the SDK.

const FirebaseAuthContext = createContext(null);

function defaultServices() {
  return {
    getAuth: getFirebaseAuth,
    getDb: getFirestoreDb,
    resetDb: resetFirestoreDb,
    onAuthStateChanged,
    signInWithGoogle: (auth) => signInWithPopup(auth, new GoogleAuthProvider()),
    signOut: firebaseSignOut,
    waitForPendingWrites,
    terminate,
    clearIndexedDbPersistence,
  };
}

function toUser(firebaseUser) {
  if (!firebaseUser) return null;
  return {
    uid: firebaseUser.uid,
    email: firebaseUser.email || null,
    displayName: firebaseUser.displayName || null,
  };
}

// The SDK objects, or null when the VITE_FIREBASE_* variables are missing: the
// page then shows a plain message instead of a sign-in button.
function connect(services) {
  try {
    return { auth: services.getAuth(), db: services.getDb() };
  } catch (error) {
    console.warn('Firebase is not configured:', error.message);
    return null;
  }
}

export function FirebaseAuthProvider({ children, services: injected }) {
  const services = useMemo(() => injected || defaultServices(), [injected]);
  const [sdk] = useState(() => connect(services));
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState(sdk ? 'loading' : 'unavailable');
  // The Firestore instance is state because sign-out replaces it.
  const [db, setDb] = useState(sdk ? sdk.db : null);
  // Set while sign-out flushes pending writes, so the data hooks stop listening.
  const [paused, setPaused] = useState(false);
  const askRef = useRef(null);

  useEffect(() => {
    if (!sdk) return undefined;
    return services.onAuthStateChanged(sdk.auth, (firebaseUser) => {
      setUser(toUser(firebaseUser));
      setStatus(firebaseUser ? 'signed-in' : 'signed-out');
    });
  }, [sdk, services]);

  const signInWithGoogle = useCallback(async () => {
    await services.signInWithGoogle(services.getAuth());
  }, [services]);

  /**
   * Sign out, flushing pending writes first. `askWhatToDo` is called when
   * they do not arrive in time (see lib/firebaseSignOut.js); the page shows
   * the modal and answers 'wait', 'discard' or 'cancel'.
   */
  const signOut = useCallback(async ({ askWhatToDo } = {}) => {
    const currentDb = db || services.getDb();
    const result = await runSignOut({
      db: currentDb,
      auth: services.getAuth(),
      waitForPendingWrites: services.waitForPendingWrites,
      signOut: services.signOut,
      terminate: services.terminate,
      clearIndexedDbPersistence: services.clearIndexedDbPersistence,
      askWhatToDo: askWhatToDo || askRef.current || (async () => 'cancel'),
      onStopListening: () => setPaused(true),
      onRestartListening: () => setPaused(false),
    });
    if (result.done) {
      setDb(services.resetDb());
      setPaused(false);
    }
    return result;
  }, [db, services]);

  const value = useMemo(() => ({
    user,
    status,
    db,
    paused,
    signInWithGoogle,
    signOut,
    // Lets a page register its modal as the default "what to do" prompt.
    setAskWhatToDo: (fn) => { askRef.current = fn; },
  }), [user, status, db, paused, signInWithGoogle, signOut]);

  return <FirebaseAuthContext.Provider value={value}>{children}</FirebaseAuthContext.Provider>;
}

export function useFirebaseAuth() {
  const ctx = useContext(FirebaseAuthContext);
  if (!ctx) throw new Error('useFirebaseAuth must be used within FirebaseAuthProvider');
  return ctx;
}
