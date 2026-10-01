import { describe, expect, it, vi } from 'vitest';
import { runSignOut } from './firebaseSignOut.js';

const db = { kind: 'db' };
const auth = { kind: 'auth' };

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function makeDeps(overrides = {}) {
  const calls = [];
  const record = (name, impl = async () => {}) => vi.fn(async (...args) => { calls.push(name); return impl(...args); });
  return {
    calls,
    deps: {
      db,
      auth,
      waitForPendingWrites: record('waitForPendingWrites'),
      signOut: record('signOut'),
      terminate: record('terminate'),
      clearIndexedDbPersistence: record('clearIndexedDbPersistence'),
      askWhatToDo: record('askWhatToDo', async () => 'discard'),
      onStopListening: vi.fn(() => calls.push('onStopListening')),
      onRestartListening: vi.fn(() => calls.push('onRestartListening')),
      timeoutMs: 20,
      ...overrides,
    },
  };
}

describe('runSignOut', () => {
  it('flushes, signs out, terminates and clears, in that order', async () => {
    const { deps, calls } = makeDeps();

    const result = await runSignOut(deps);

    expect(result).toEqual({ done: true, discarded: false, cacheCleared: true });
    expect(calls).toEqual(['onStopListening', 'waitForPendingWrites', 'signOut', 'terminate', 'clearIndexedDbPersistence']);
    expect(deps.askWhatToDo).not.toHaveBeenCalled();
    expect(deps.signOut).toHaveBeenCalledWith(auth);
    expect(deps.terminate).toHaveBeenCalledWith(db);
    expect(deps.clearIndexedDbPersistence).toHaveBeenCalledWith(db);
  });

  it('asks what to do when the pending writes do not arrive in time, and can discard them', async () => {
    const never = deferred();
    const { deps, calls } = makeDeps({ waitForPendingWrites: vi.fn(() => never.promise) });

    const result = await runSignOut(deps);

    expect(deps.askWhatToDo).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ done: true, discarded: true, cacheCleared: true });
    expect(calls).toEqual(['onStopListening', 'askWhatToDo', 'signOut', 'terminate', 'clearIndexedDbPersistence']);
  });

  it('keeps waiting when asked to, then signs out once the writes arrive', async () => {
    const first = deferred();
    const second = deferred();
    const waits = [first.promise, second.promise];
    const { deps } = makeDeps({
      waitForPendingWrites: vi.fn(() => waits.shift()),
      askWhatToDo: vi.fn(async () => 'wait'),
    });

    const run = runSignOut(deps);
    await vi.waitFor(() => expect(deps.askWhatToDo).toHaveBeenCalled());
    expect(deps.signOut).not.toHaveBeenCalled();
    second.resolve();

    expect(await run).toEqual({ done: true, discarded: false, cacheCleared: true });
    expect(deps.waitForPendingWrites).toHaveBeenCalledTimes(2);
  });

  it('stays signed in when the person cancels, and restarts the listeners', async () => {
    const never = deferred();
    const { deps, calls } = makeDeps({
      waitForPendingWrites: vi.fn(() => never.promise),
      askWhatToDo: vi.fn(async () => 'cancel'),
    });

    const result = await runSignOut(deps);

    expect(result).toEqual({ done: false, discarded: false, cacheCleared: false });
    expect(deps.askWhatToDo).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['onStopListening', 'onRestartListening']);
    expect(deps.signOut).not.toHaveBeenCalled();
    expect(deps.clearIndexedDbPersistence).not.toHaveBeenCalled();
  });

  it('treats an unknown answer as cancel', async () => {
    const never = deferred();
    const { deps } = makeDeps({
      waitForPendingWrites: vi.fn(() => never.promise),
      askWhatToDo: vi.fn(async () => undefined),
    });

    expect((await runSignOut(deps)).done).toBe(false);
    expect(deps.onRestartListening).toHaveBeenCalled();
  });

  it('lets the person give up waiting', async () => {
    const never = deferred();
    const gaveUp = deferred();
    const { deps } = makeDeps({
      waitForPendingWrites: vi.fn(() => never.promise),
      askWhatToDo: vi.fn(async () => ({ choice: 'wait', cancelled: gaveUp.promise })),
    });

    const run = runSignOut(deps);
    await vi.waitFor(() => expect(deps.askWhatToDo).toHaveBeenCalled());
    gaveUp.resolve();

    expect((await run).done).toBe(false);
    expect(deps.signOut).not.toHaveBeenCalled();
    expect(deps.onRestartListening).toHaveBeenCalled();
  });

  it('reports a cache that could not be cleared instead of failing the sign-out', async () => {
    const cacheError = Object.assign(new Error('another tab'), { code: 'failed-precondition' });
    const { deps } = makeDeps({ clearIndexedDbPersistence: vi.fn(async () => { throw cacheError; }) });

    const result = await runSignOut(deps);

    expect(result).toEqual({ done: true, discarded: false, cacheCleared: false, cacheError });
    expect(deps.signOut).toHaveBeenCalled();
    expect(deps.terminate).toHaveBeenCalled();
  });

  it('treats a rejected flush like a timeout and asks', async () => {
    const { deps } = makeDeps({
      waitForPendingWrites: vi.fn(async () => { throw new Error('user changed'); }),
      askWhatToDo: vi.fn(async () => 'discard'),
    });

    expect((await runSignOut(deps)).discarded).toBe(true);
  });
});
