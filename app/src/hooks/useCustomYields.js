import { useCallback, useEffect, useState } from 'react';
import { useFirebaseAuth } from '../context/FirebaseAuthContext';
import {
  addCustomYield,
  deleteCustomYield,
  subscribeCustomYields,
  updateCustomYield,
} from '../lib/customYieldsRepository';

const EMPTY = Object.freeze({ records: Object.freeze([]), loaded: false, error: null });

/**
 * The signed-in person's custom yields from Firestore, kept live by a
 * snapshot listener. The state is tagged with the account it belongs to, so
 * the moment the account changes (or sign-out starts) the hook reports an
 * empty list and one person never sees another's records.
 */
export function useCustomYields() {
  const { user, db, paused } = useFirebaseAuth();
  const uid = user?.uid || null;
  const key = uid && db && !paused ? `${uid}` : null;
  const [snapshot, setSnapshot] = useState({ key: null, ...EMPTY });

  useEffect(() => {
    if (!key) return undefined;
    return subscribeCustomYields(
      db,
      uid,
      (records) => setSnapshot({ key, records, loaded: true, error: null }),
      (error) => setSnapshot((current) => ({ key, records: current.key === key ? current.records : EMPTY.records, loaded: current.key === key && current.loaded, error })),
    );
  }, [key, db, uid]);

  const current = snapshot.key === key ? snapshot : EMPTY;

  // Writes are not awaited by the pages: the listener shows the change at
  // once (with `pending` set until the server has it), and offline the
  // promise only settles when the connection returns.
  const addYield = useCallback((input) => addCustomYield(db, uid, input), [db, uid]);
  const updateYield = useCallback((id, input, existing) => updateCustomYield(db, uid, id, input, existing), [db, uid]);
  const removeYield = useCallback((id) => deleteCustomYield(db, uid, id), [db, uid]);

  return { customYields: current.records, loaded: current.loaded, error: current.error, addYield, updateYield, removeYield };
}
