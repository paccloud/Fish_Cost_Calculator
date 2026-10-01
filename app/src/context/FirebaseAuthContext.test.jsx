import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FirebaseAuthProvider, useFirebaseAuth } from './FirebaseAuthContext.jsx';

function fakeServices() {
  return {
    getAuth: vi.fn(() => ({ kind: 'auth' })),
    getDb: vi.fn(() => ({ kind: 'db' })),
    resetDb: vi.fn(() => ({ kind: 'db2' })),
    onAuthStateChanged: vi.fn(() => () => {}),
    signInWithGoogle: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
    waitForPendingWrites: vi.fn(async () => {}),
    terminate: vi.fn(async () => {}),
    clearIndexedDbPersistence: vi.fn(async () => {}),
  };
}

function renderState(services) {
  let state;
  function Probe() {
    // eslint-disable-next-line react-hooks/globals -- test probe captures context for assertions after server render.
    state = useFirebaseAuth();
    return null;
  }
  renderToStaticMarkup(
    <FirebaseAuthProvider services={services}>
      <Probe />
    </FirebaseAuthProvider>
  );
  return state;
}

describe('FirebaseAuthProvider', () => {
  it('starts loading with no user and exposes the actions', () => {
    const state = renderState(fakeServices());

    expect(state.status).toBe('loading');
    expect(state.user).toBeNull();
    expect(typeof state.signInWithGoogle).toBe('function');
    expect(typeof state.signOut).toBe('function');
    expect(typeof state.setAskWhatToDo).toBe('function');
  });

  it('signs in with Google through the injected service', async () => {
    const services = fakeServices();
    const state = renderState(services);

    await state.signInWithGoogle();

    expect(services.signInWithGoogle).toHaveBeenCalledWith({ kind: 'auth' });
  });

  it('runs the sign-out flow with the injected SDK functions', async () => {
    const services = fakeServices();
    const state = renderState(services);

    const result = await state.signOut({ askWhatToDo: async () => 'discard' });

    expect(result).toEqual({ done: true, discarded: false, cacheCleared: true });
    expect(services.waitForPendingWrites).toHaveBeenCalledWith({ kind: 'db' });
    expect(services.signOut).toHaveBeenCalledWith({ kind: 'auth' });
    expect(services.terminate).toHaveBeenCalledWith({ kind: 'db' });
    expect(services.clearIndexedDbPersistence).toHaveBeenCalledWith({ kind: 'db' });
    expect(services.resetDb).toHaveBeenCalled();
  });

  it('throws when used outside the provider', () => {
    function Probe() {
      useFirebaseAuth();
      return null;
    }
    expect(() => renderToStaticMarkup(<Probe />)).toThrow(/within FirebaseAuthProvider/);
  });
});
