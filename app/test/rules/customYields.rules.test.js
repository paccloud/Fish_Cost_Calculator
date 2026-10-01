// Security rules for users/{uid}/customYields (firestore.rules), run against
// the Firestore emulator by `npm run test:emulated`.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  Timestamp,
} from 'firebase/firestore';

const PROJECT_ID = 'demo-local-catch';
const ALICE = 'alice';
const BOB = 'bob';

let env;

function validYield(uid, overrides = {}) {
  return {
    ownerUid: uid,
    species: 'Pink Salmon',
    from: 'Round',
    to: 'Skinless Fillet',
    yield: 42,
    source: 'Measured on the dock',
    status: 'private',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

function yieldRef(db, uid, id = 'y1') {
  return doc(db, 'users', uid, 'customYields', id);
}

async function seed(uid, id, data) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(yieldRef(ctx.firestore(), uid, id), {
      ...validYield(uid),
      createdAt: Timestamp.fromMillis(1_700_000_000_000),
      updatedAt: Timestamp.fromMillis(1_700_000_000_000),
      ...data,
    });
  });
}

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(new URL('../../../firestore.rules', import.meta.url), 'utf8') },
  });
});

beforeEach(() => env.clearFirestore());
afterAll(() => env.cleanup());

describe('the owner', () => {
  it('creates, reads, lists, updates and deletes their own custom yields', async () => {
    const db = env.authenticatedContext(ALICE).firestore();

    await assertSucceeds(setDoc(yieldRef(db, ALICE), validYield(ALICE)));
    await assertSucceeds(getDoc(yieldRef(db, ALICE)));
    const list = await assertSucceeds(getDocs(collection(db, 'users', ALICE, 'customYields')));
    expect(list.size).toBe(1);

    const created = (await getDoc(yieldRef(db, ALICE))).data();
    await assertSucceeds(setDoc(yieldRef(db, ALICE), validYield(ALICE, { yield: 45, createdAt: created.createdAt })));
    await assertSucceeds(deleteDoc(yieldRef(db, ALICE)));
  });

  it('may leave the starting form blank (yields copied from Neon)', async () => {
    const db = env.authenticatedContext(ALICE).firestore();
    await assertSucceeds(setDoc(yieldRef(db, ALICE), validYield(ALICE, { from: '' })));
  });

  it('may leave the source note empty', async () => {
    const db = env.authenticatedContext(ALICE).firestore();
    await assertSucceeds(setDoc(yieldRef(db, ALICE), validYield(ALICE, { source: '' })));
  });
});

describe('another person', () => {
  beforeEach(() => seed(ALICE, 'y1', {}));

  it('cannot read, list, create, update or delete under someone else', async () => {
    const db = env.authenticatedContext(BOB).firestore();

    await assertFails(getDoc(yieldRef(db, ALICE)));
    await assertFails(getDocs(collection(db, 'users', ALICE, 'customYields')));
    await assertFails(setDoc(yieldRef(db, ALICE, 'y2'), validYield(ALICE)));
    await assertFails(setDoc(yieldRef(db, ALICE, 'y2'), validYield(BOB)));
    await assertFails(setDoc(yieldRef(db, ALICE), validYield(ALICE, { yield: 50 })));
    await assertFails(deleteDoc(yieldRef(db, ALICE)));
  });
});

describe('a signed-out visitor', () => {
  beforeEach(() => seed(ALICE, 'y1', {}));

  it('is refused everything', async () => {
    const db = env.unauthenticatedContext().firestore();

    await assertFails(getDoc(yieldRef(db, ALICE)));
    await assertFails(getDocs(collection(db, 'users', ALICE, 'customYields')));
    await assertFails(setDoc(yieldRef(db, ALICE, 'y2'), validYield(ALICE)));
    await assertFails(deleteDoc(yieldRef(db, ALICE)));
  });
});

describe('validation', () => {
  const cases = [
    ['yield of 0', { yield: 0 }],
    ['yield above 100', { yield: 100.1 }],
    ['yield as text', { yield: '42' }],
    ['blank species', { species: '   ' }],
    ['species over 120 characters', { species: 'x'.repeat(121) }],
    ['blank finished product', { to: '' }],
    ['finished product over 80 characters', { to: 'x'.repeat(81) }],
    ['starting form over 80 characters', { from: 'x'.repeat(81) }],
    ['source note over 500 characters', { source: 'x'.repeat(501) }],
    ['an unknown field', { extra: true }],
    ['ownerUid of someone else', { ownerUid: BOB }],
    ['a status other than private', { status: 'approved' }],
    ['a client-side createdAt', { createdAt: Timestamp.fromMillis(1) }],
    ['a client-side updatedAt', { updatedAt: Timestamp.fromMillis(1) }],
  ];

  it.each(cases)('refuses %s on create', async (_label, overrides) => {
    const db = env.authenticatedContext(ALICE).firestore();
    await assertFails(setDoc(yieldRef(db, ALICE), validYield(ALICE, overrides)));
  });

  it('refuses a missing field', async () => {
    const db = env.authenticatedContext(ALICE).firestore();
    const { source: _omitted, ...withoutSource } = validYield(ALICE);
    await assertFails(setDoc(yieldRef(db, ALICE), withoutSource));
  });

  it('accepts a yield of exactly 100 and a tiny positive yield', async () => {
    const db = env.authenticatedContext(ALICE).firestore();
    await assertSucceeds(setDoc(yieldRef(db, ALICE, 'a'), validYield(ALICE, { yield: 100 })));
    await assertSucceeds(setDoc(yieldRef(db, ALICE, 'b'), validYield(ALICE, { yield: 0.5 })));
  });

  it('keeps createdAt fixed on update', async () => {
    await seed(ALICE, 'y1', {});
    const db = env.authenticatedContext(ALICE).firestore();
    await assertFails(setDoc(yieldRef(db, ALICE), validYield(ALICE, { createdAt: serverTimestamp() })));
    await assertFails(setDoc(yieldRef(db, ALICE), validYield(ALICE, { createdAt: Timestamp.fromMillis(5) })));
    await assertSucceeds(setDoc(yieldRef(db, ALICE), validYield(ALICE, { createdAt: Timestamp.fromMillis(1_700_000_000_000) })));
  });

  it('refuses a partial update that drops fields', async () => {
    await seed(ALICE, 'y1', {});
    const db = env.authenticatedContext(ALICE).firestore();
    await assertFails(setDoc(yieldRef(db, ALICE), { yield: 50 }));
  });
});

describe('reserved paths', () => {
  it('keeps the user document and the community dataset closed', async () => {
    const db = env.authenticatedContext(ALICE).firestore();
    await assertFails(getDoc(doc(db, 'users', ALICE)));
    await assertFails(setDoc(doc(db, 'users', ALICE), { displayName: 'Alice' }));
    await assertFails(getDoc(doc(db, 'communityYields', 'y1')));
    await assertFails(setDoc(doc(db, 'communityYields', 'y1'), { species: 'Pink Salmon' }));
    await assertFails(setDoc(doc(db, 'users', ALICE, 'savedCalculations', 'c1'), { total: 1 }));
  });
});
