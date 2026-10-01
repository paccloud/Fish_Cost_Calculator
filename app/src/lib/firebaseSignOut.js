// Signing out of the Firestore-backed account (ADR 0001, issue #123).
//
// Firestore's persistent cache keeps a person's private data in the browser
// after sign-out, so the order matters:
//   1. stop the listeners (they keep the instance busy),
//   2. send pending writes, or if they do not arrive within the timeout ask
//      whether to keep waiting or to discard them (navigator.onLine is not
//      trusted; the timeout is the offline signal),
//   3. sign out,
//   4. terminate the instance and clear its IndexedDB cache,
//   5. let the caller create a fresh instance.
// Every dependency is injected so the flow is unit-tested without the SDK.

export const DEFAULT_PENDING_TIMEOUT_MS = 8000;

/** Result of askWhatToDo(): 'wait' keeps waiting, 'discard' drops the pending writes, 'cancel' stays signed in. */
export const SIGN_OUT_CHOICES = Object.freeze(['wait', 'discard', 'cancel']);

function timeoutAfter(ms) {
  let timer;
  const promise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('pending-writes-timeout')), ms);
  });
  return { promise, clear: () => clearTimeout(timer) };
}

/**
 * @param {object} deps
 * @param {object} deps.db                       the Firestore instance
 * @param {object} deps.auth                     the Auth instance
 * @param {(db) => Promise<void>} deps.waitForPendingWrites
 * @param {(auth) => Promise<void>} deps.signOut
 * @param {(db) => Promise<void>} deps.terminate
 * @param {(db) => Promise<void>} deps.clearIndexedDbPersistence
 * @param {() => Promise<'wait'|'discard'|'cancel'|{choice: string, cancelled?: Promise<void>}>} deps.askWhatToDo
 *   Called only when pending writes did not arrive in time. For 'wait' it may
 *   also return a `cancelled` promise that resolves if the person gives up waiting.
 * @param {() => void} [deps.onStopListening]    unsubscribe snapshot listeners before the flush
 * @param {() => void} [deps.onRestartListening] re-subscribe when sign-out is cancelled
 * @param {number} [deps.timeoutMs]
 * @returns {Promise<{done: boolean, discarded: boolean, cacheCleared: boolean, cacheError?: Error}>}
 */
export async function runSignOut({
  db,
  auth,
  waitForPendingWrites,
  signOut,
  terminate,
  clearIndexedDbPersistence,
  askWhatToDo,
  onStopListening = () => {},
  onRestartListening = () => {},
  timeoutMs = DEFAULT_PENDING_TIMEOUT_MS,
}) {
  onStopListening();

  let discarded = false;
  const flushed = await flushWithTimeout(waitForPendingWrites, db, timeoutMs);
  if (!flushed) {
    const answer = await askWhatToDo();
    const choice = typeof answer === 'string' ? answer : answer?.choice;
    if (choice === 'cancel' || !SIGN_OUT_CHOICES.includes(choice)) {
      onRestartListening();
      return { done: false, discarded: false, cacheCleared: false };
    }
    if (choice === 'wait') {
      const cancelled = typeof answer === 'object' && answer.cancelled;
      const arrived = await waitUntilFlushedOrCancelled(waitForPendingWrites, db, cancelled);
      if (!arrived) {
        onRestartListening();
        return { done: false, discarded: false, cacheCleared: false };
      }
    } else {
      discarded = true;
    }
  }

  await signOut(auth);
  await terminate(db);

  // Discarded writes are dropped here with the rest of the cache. If another
  // tab still holds the database open this throws failed-precondition: the
  // session is gone, the cache is not; the caller tells the person and the
  // next sign-out clears it.
  try {
    await clearIndexedDbPersistence(db);
  } catch (cacheError) {
    return { done: true, discarded, cacheCleared: false, cacheError };
  }
  return { done: true, discarded, cacheCleared: true };
}

async function flushWithTimeout(waitForPendingWrites, db, timeoutMs) {
  const timeout = timeoutAfter(timeoutMs);
  try {
    await Promise.race([waitForPendingWrites(db), timeout.promise]);
    return true;
  } catch {
    return false;
  } finally {
    timeout.clear();
  }
}

async function waitUntilFlushedOrCancelled(waitForPendingWrites, db, cancelled) {
  const flush = waitForPendingWrites(db).then(() => true, () => false);
  if (!cancelled) return flush;
  return Promise.race([flush, cancelled.then(() => false)]);
}
