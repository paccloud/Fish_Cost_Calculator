// The Firebase SDK, initialised lazily (ADR 0001, issue #123).
//
// Nothing here runs at import time, so the node test run never touches the
// SDK, and the pages that still use the Neon API are unaffected. The
// Firestore instance uses the persistent cache so edits made offline survive
// a reload; sign-out terminates it, clears the cache and asks for a new one
// through resetFirestoreDb() (see lib/firebaseSignOut.js).

import { getApp, getApps, initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import {
  connectFirestoreEmulator,
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';

export const EMULATOR_HOST = '127.0.0.1';
export const AUTH_EMULATOR_PORT = 9099;
export const FIRESTORE_EMULATOR_PORT = 8080;

/** The web app config from the VITE_FIREBASE_* variables (public by design; see docs/ENVIRONMENT_VARIABLES.md). */
export function firebaseConfigFromEnv(env = import.meta.env) {
  return {
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  };
}

/** True when VITE_FIREBASE_USE_EMULATORS=true: talk to the local emulators, never to a real project. */
export function shouldUseEmulators(env = import.meta.env) {
  return String(env.VITE_FIREBASE_USE_EMULATORS ?? '').trim().toLowerCase() === 'true';
}

let app = null;
let auth = null;
let db = null;

export function getFirebaseApp() {
  if (!app) {
    const config = firebaseConfigFromEnv();
    if (!config.apiKey || !config.projectId) {
      throw new Error('VITE_FIREBASE_API_KEY and VITE_FIREBASE_PROJECT_ID are required for Firebase');
    }
    // Vite's hot reload re-runs this module while the app object survives.
    app = getApps().length ? getApp() : initializeApp(config);
  }
  return app;
}

export function getFirebaseAuth() {
  if (!auth) {
    auth = getAuth(getFirebaseApp());
    if (shouldUseEmulators()) {
      // Connecting twice with the same address is accepted by the SDK.
      connectAuthEmulator(auth, `http://${EMULATOR_HOST}:${AUTH_EMULATOR_PORT}`, { disableWarnings: true });
    }
  }
  return auth;
}

function createFirestore() {
  const firebaseApp = getFirebaseApp();
  let instance;
  try {
    instance = initializeFirestore(firebaseApp, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    // Already initialised on this app (hot reload): reuse it.
    instance = getFirestore(firebaseApp);
  }
  if (shouldUseEmulators()) {
    connectFirestoreEmulator(instance, EMULATOR_HOST, FIRESTORE_EMULATOR_PORT);
  }
  return instance;
}

export function getFirestoreDb() {
  if (!db) db = createFirestore();
  return db;
}

/** After terminate() + clearIndexedDbPersistence(): a fresh instance on the same app. */
export function resetFirestoreDb() {
  db = createFirestore();
  return db;
}
