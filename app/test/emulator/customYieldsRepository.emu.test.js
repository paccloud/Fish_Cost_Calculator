// The custom-yields repository against the Firestore emulator, signed in
// through the Auth emulator (no real Google account is needed there). The
// browser's persistent cache cannot run in node, so this uses the memory
// cache; the offline flow is covered by lib/firebaseSignOut.test.js and the
// manual check in docs/firestore.md.
import process from 'node:process';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, GoogleAuthProvider, signInWithCredential, signOut } from 'firebase/auth';
import { connectFirestoreEmulator, initializeFirestore, memoryLocalCache } from 'firebase/firestore';
import {
  addCustomYield,
  deleteCustomYield,
  subscribeCustomYields,
  updateCustomYield,
} from '../../src/lib/customYieldsRepository.js';

const PROJECT_ID = 'demo-local-catch';

function hostPort(envValue, fallbackPort) {
  const [host, port] = (envValue || `127.0.0.1:${fallbackPort}`).split(':');
  return { host, port: Number(port) };
}

let app;
let auth;
let db;

async function signInAs(sub) {
  const credential = GoogleAuthProvider.credential(JSON.stringify({ sub, email: `${sub}@example.com` }));
  const result = await signInWithCredential(auth, credential);
  return result.user.uid;
}

// Resolves with the first snapshot confirmed by the server that satisfies the
// predicate. The memory cache answers first with whatever an earlier listener
// saw, so a cached snapshot never counts here.
function nextSnapshot(uid, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const unsubscribe = subscribeCustomYields(db, uid, (records, meta) => {
      if (!meta.fromCache && predicate(records)) { unsubscribe(); resolve(records); }
    }, (error) => { unsubscribe(); reject(error); });
  });
}

beforeAll(() => {
  app = initializeApp({ apiKey: 'demo', projectId: PROJECT_ID, appId: 'demo' }, 'emu-test');
  auth = getAuth(app);
  const authHost = hostPort(process.env.FIREBASE_AUTH_EMULATOR_HOST, 9099);
  connectAuthEmulator(auth, `http://${authHost.host}:${authHost.port}`, { disableWarnings: true });
  db = initializeFirestore(app, { localCache: memoryLocalCache() });
  const fsHost = hostPort(process.env.FIRESTORE_EMULATOR_HOST, 8080);
  connectFirestoreEmulator(db, fsHost.host, fsHost.port);
});

afterEach(() => signOut(auth));
afterAll(() => deleteApp(app));

describe('customYieldsRepository against the emulator', () => {
  it('adds, lists, updates and deletes a custom yield with server timestamps', async () => {
    const uid = await signInAs('alice-repo');

    const id = await addCustomYield(db, uid, { species: 'Pink Salmon', from: 'Round', to: 'Skinless Fillet', yield: '42', source: ' dock ' });
    let records = await nextSnapshot(uid, (r) => r.some((y) => y.id === id && !y.pending));
    const added = records.find((y) => y.id === id);
    expect(added).toMatchObject({ ownerUid: uid, species: 'Pink Salmon', from: 'Round', to: 'Skinless Fillet', yield: 42, source: 'dock', status: 'private', pending: false });
    expect(typeof added.createdAt).toBe('number');
    expect(added.updatedAt).toBeGreaterThanOrEqual(added.createdAt);

    await updateCustomYield(db, uid, id, { ...added, yield: 45 }, added);
    records = await nextSnapshot(uid, (r) => r.some((y) => y.id === id && y.yield === 45 && !y.pending));
    const updated = records.find((y) => y.id === id);
    expect(updated.createdAt).toBe(added.createdAt);
    expect(updated.updatedAt).toBeGreaterThanOrEqual(added.updatedAt);

    await deleteCustomYield(db, uid, id);
    records = await nextSnapshot(uid, (r) => !r.some((y) => y.id === id));
    expect(records.find((y) => y.id === id)).toBeUndefined();
  });

  it('sorts by species then finished product', async () => {
    const uid = await signInAs('alice-sort');
    await addCustomYield(db, uid, { species: 'Pink Salmon', from: 'Round', to: 'Skinless Fillet', yield: 42 });
    await addCustomYield(db, uid, { species: 'Atlantic Cod', from: 'Round', to: 'Skinless Fillet', yield: 38 });
    await addCustomYield(db, uid, { species: 'Pink Salmon', from: 'Round', to: 'D/H-On', yield: 91 });

    const records = await nextSnapshot(uid, (r) => r.length === 3 && r.every((y) => !y.pending));
    expect(records.map((y) => `${y.species} ${y.to}`)).toEqual([
      'Atlantic Cod Skinless Fillet',
      'Pink Salmon D/H-On',
      'Pink Salmon Skinless Fillet',
    ]);
  });

  it('refuses an invalid custom yield before it reaches Firestore', async () => {
    const uid = await signInAs('alice-invalid');
    const error = await addCustomYield(db, uid, { species: '', to: 'Fillet', yield: 0 }).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('invalid-custom-yield');
    expect(Object.keys(error.errors).sort()).toEqual(['species', 'yield']);
  });

  it("shows one person nothing of another's yields", async () => {
    const alice = await signInAs('alice-private');
    await addCustomYield(db, alice, { species: 'Pink Salmon', from: 'Round', to: 'Skinless Fillet', yield: 42 });
    await nextSnapshot(alice, (r) => r.length === 1 && !r[0].pending);
    await signOut(auth);

    const bob = await signInAs('bob-private');
    const bobRecords = await nextSnapshot(bob);
    expect(bobRecords).toEqual([]);
    await expect(nextSnapshot(alice)).rejects.toMatchObject({ code: 'permission-denied' });
  });
});
