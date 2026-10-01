// A person's custom yields in Firestore: users/{uid}/customYields/{yieldId}
// (docs/firestore.md). The Firestore instance is passed in, so the same code
// runs in the browser and against the emulator in tests. Every write sends the
// whole document: the rules check the exact field list, and a partial update
// would fail them.

import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { normalizeCustomYieldInput, validateCustomYield } from './customYield';

export function customYieldsCollection(db, uid) {
  return collection(db, 'users', uid, 'customYields');
}

function toTimestampMs(value) {
  return value && typeof value.toMillis === 'function' ? value.toMillis() : null;
}

/** The document as the app reads it: id, fields, and whether the server has it yet. */
export function fromSnapshot(snapshot) {
  const data = snapshot.data({ serverTimestamps: 'estimate' }) || {};
  return {
    id: snapshot.id,
    ownerUid: data.ownerUid,
    species: data.species,
    from: data.from ?? '',
    to: data.to,
    yield: data.yield,
    source: data.source ?? '',
    status: data.status,
    createdAt: toTimestampMs(data.createdAt),
    updatedAt: toTimestampMs(data.updatedAt),
    pending: snapshot.metadata.hasPendingWrites,
  };
}

/**
 * Listen to the person's custom yields, sorted by species then product.
 * The first result may come from the cache (meta.fromCache), before the
 * server has answered. Metadata changes are included so the listener also
 * fires when a pending write is confirmed by the server, which is what clears
 * the "not yet saved to the cloud" mark. Returns the unsubscribe function.
 */
export function subscribeCustomYields(db, uid, onChange, onError = () => {}) {
  const q = query(customYieldsCollection(db, uid), orderBy('species'), orderBy('to'));
  return onSnapshot(
    q,
    { includeMetadataChanges: true },
    (result) => onChange(result.docs.map(fromSnapshot), {
      fromCache: result.metadata.fromCache,
      hasPendingWrites: result.metadata.hasPendingWrites,
    }),
    onError,
  );
}

function assertValid(input) {
  const result = validateCustomYield(input);
  if (!result.ok) {
    const error = new Error('Invalid custom yield');
    error.code = 'invalid-custom-yield';
    error.errors = result.errors;
    throw error;
  }
  return result.value;
}

/**
 * Add a private custom yield and return its id. Rejects at once with
 * code 'invalid-custom-yield' when the input fails validation; otherwise
 * resolves when the server has the record (the snapshot listener shows it
 * long before that when offline).
 */
export async function addCustomYield(db, uid, input) {
  const value = assertValid(input);
  const ref = doc(customYieldsCollection(db, uid));
  await setDoc(ref, {
    ownerUid: uid,
    ...value,
    status: 'private',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

/**
 * Replace the editable fields of an existing custom yield. `existing` is the
 * record as read by the listener; its creation time and status are kept.
 */
export async function updateCustomYield(db, uid, id, input, existing) {
  const value = assertValid(input);
  const ref = doc(customYieldsCollection(db, uid), id);
  return setDoc(ref, {
    ownerUid: uid,
    ...value,
    status: existing?.status || 'private',
    createdAt: existing?.createdAt != null ? new Date(existing.createdAt) : serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export function deleteCustomYield(db, uid, id) {
  return deleteDoc(doc(customYieldsCollection(db, uid), id));
}

export { normalizeCustomYieldInput };
