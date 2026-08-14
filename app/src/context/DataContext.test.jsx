import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRepository, guestScope, accountScope } from '../lib/localRepository';
import { detectGuestRecords, adoptGuestRecords } from '../lib/guestAdoption';

// Verifies the guest-adoption flow that DataContext orchestrates at sign-in.
// React rendering is not needed here — we test the business logic directly
// (the same functions that DataContext calls in its useEffect and handlers).

function makeStore() {
  const db = {};
  return {
    get: vi.fn(async (key) => structuredClone(db[key]) ?? undefined),
    set: vi.fn(async (key, val) => { db[key] = structuredClone(val); }),
  };
}

const GUEST = guestScope({ getItem: () => 'install-e2e', setItem: vi.fn() });
const ACCOUNT = accountScope('firebase-uid-abc');

describe('guest adoption — end-to-end flow', () => {
  let store;
  let guestRepo;
  let accountRepo;

  beforeEach(() => {
    store = makeStore();
    guestRepo = createRepository(GUEST, { store });
    accountRepo = createRepository(ACCOUNT, { store });
  });

  it('guest saves a calc offline → signs in → adoption modal shows → confirms → calc appears in account with syncStatus local', async () => {
    // Guest saves a calc offline (simulates the user adding a calc while signed out).
    await guestRepo.addCalc({
      species: 'Salmon',
      product: 'Fillet',
      cost: 10,
      yield: 0.6,
      result: 6,
      name: 'My offline calc',
    });

    // User signs in → DataContext detects guest records (step 2 in the issue).
    const counts = await detectGuestRecords(guestRepo);
    // Modal would show because total > 0 (step 3).
    expect(counts.total).toBeGreaterThan(0);
    expect(counts.calcs).toBe(1);

    // User confirms → DataContext calls adoptGuestRecords (step 4).
    const { adoptedCalcs } = await adoptGuestRecords(guestRepo, accountRepo);
    expect(adoptedCalcs).toBe(1);

    // The calc appears in the account scope with syncStatus 'local' (ready for sync).
    const accountCalcs = await accountRepo.getCalcs();
    expect(accountCalcs).toHaveLength(1);
    expect(accountCalcs[0].species).toBe('Salmon');
    expect(accountCalcs[0].name).toBe('My offline calc');
    expect(accountCalcs[0].syncStatus).toBe('local');
    expect(accountCalcs[0].scope).toBe(ACCOUNT);
    expect(accountCalcs[0].guestSourceId).toBeTruthy();

    // Guest scope is cleared after adoption.
    expect(await guestRepo.getCalcs()).toHaveLength(0);
  });

  it('guest saves custom yields offline → confirmed adoption moves them to account', async () => {
    await guestRepo.addYield({ species: 'Halibut', product: 'Fillet', yield: 0.55, source: 'User Input' });
    await guestRepo.addYield({ species: 'Cod', product: 'Steak', yield: 0.62, source: 'User Input' });

    const counts = await detectGuestRecords(guestRepo);
    expect(counts.yields).toBe(2);
    expect(counts.total).toBe(2);

    await adoptGuestRecords(guestRepo, accountRepo);

    const accountYields = await accountRepo.getYields();
    expect(accountYields).toHaveLength(2);
    accountYields.forEach((y) => {
      expect(y.syncStatus).toBe('local');
      expect(y.scope).toBe(ACCOUNT);
    });
    expect(await guestRepo.getYields()).toHaveLength(0);
  });

  it('decline — guest data remains untouched when user declines adoption', async () => {
    await guestRepo.addCalc({ species: 'Tuna', product: 'Steak', cost: 12, yield: 0.7, result: 8.4, name: 'T' });

    const counts = await detectGuestRecords(guestRepo);
    expect(counts.total).toBe(1);

    // User declines → DataContext just clears the counts state, no adoptGuestRecords call.
    // Verify the guest data is untouched.
    expect(await guestRepo.getCalcs()).toHaveLength(1);
    expect(await accountRepo.getCalcs()).toHaveLength(0);
  });

  it('no modal when guest scope is empty at sign-in', async () => {
    // No guest data saved.
    const counts = await detectGuestRecords(guestRepo);
    expect(counts.total).toBe(0);
    // Modal would not show (DataContext only sets state when total > 0).
  });
});

// ---- Sign-out guard — business logic ----
// Tests the data operations that DataContext.signOut / handleSignOutKeep / handleSignOutDiscard invoke.

describe('sign-out guard — no pending work', () => {
  it('synced cache is cleared on sign-out when no pending mutations exist', async () => {
    const store = makeStore();
    const repo = createRepository(ACCOUNT, { store });

    // Add a synced calc (no local mutations).
    const calc = await repo.addCalc({ species: 'Cod', product: 'Fillet', cost: 4, yield: 40, result: 10 });
    await repo.markCalcSynced(calc.id, 1);

    // Sign-out path: check pending, none found, clear synced cache.
    const { calcs, yields } = await repo.getPendingSync();
    expect(calcs).toHaveLength(0);
    expect(yields).toHaveLength(0);

    await repo.clearSyncedCache();

    // After sign-out, account scope is empty.
    expect(await repo.getCalcs()).toHaveLength(0);
  });
});

describe('sign-out guard — keep locally', () => {
  it('synced cache is removed but pending mutations stay in account scope', async () => {
    const store = makeStore();
    const repo = createRepository(ACCOUNT, { store });

    const syncedCalc = await repo.addCalc({ species: 'Salmon', product: 'Fillet', cost: 5, yield: 50, result: 10 });
    await repo.markCalcSynced(syncedCalc.id, 2);

    const localCalc = await repo.addCalc({ species: 'Halibut', product: 'Skinless', cost: 7, yield: 55, result: 12 });

    const localYield = await repo.addYield({ species: 'Cod', product: 'Fillet', yield: 42 });

    // "Keep locally" path: clear synced cache only.
    await repo.clearSyncedCache();

    // Synced calc is gone; local calc and yield remain.
    const pending = await repo.getPendingSync();
    expect(pending.calcs.map((c) => c.id)).toContain(localCalc.id);
    expect(pending.calcs.map((c) => c.id)).not.toContain(syncedCalc.id);
    expect(pending.yields.map((y) => y.id)).toContain(localYield.id);
  });

  it('pending mutations re-appear when the same account signs back in (scope is preserved)', async () => {
    const store = makeStore();
    const repoSignOut = createRepository(ACCOUNT, { store });

    const localCalc = await repoSignOut.addCalc({ species: 'Tuna', product: 'Loin', cost: 8, yield: 60, result: 13 });
    await repoSignOut.clearSyncedCache();

    // Simulate sign back in with the same uid (repo re-created for same scope).
    const repoSignIn = createRepository(ACCOUNT, { store });
    const pending = await repoSignIn.getPendingSync();
    expect(pending.calcs.map((c) => c.id)).toContain(localCalc.id);
  });
});

describe('sign-out guard — discard', () => {
  it('pending mutations and synced cache are both removed before sign-out', async () => {
    const store = makeStore();
    const repo = createRepository(ACCOUNT, { store });

    const syncedCalc = await repo.addCalc({ species: 'Salmon', product: 'Fillet', cost: 5, yield: 50, result: 10 });
    await repo.markCalcSynced(syncedCalc.id, 3);
    await repo.addCalc({ species: 'Halibut', product: 'Skinless', cost: 7, yield: 55, result: 12 });
    await repo.addYield({ species: 'Cod', product: 'Fillet', yield: 42 });

    // "Discard" path: remove unsynchronized, then clear synced cache.
    await repo.discardUnsynchronized();
    await repo.clearSyncedCache();

    expect(await repo.getCalcs()).toHaveLength(0);
    expect(await repo.getYields()).toHaveLength(0);
    const pending = await repo.getPendingSync();
    expect(pending.calcs).toHaveLength(0);
    expect(pending.yields).toHaveLength(0);
  });
});

describe('sign-out guard — two accounts on one browser', () => {
  it('account A pending mutations are not visible in account B scope', async () => {
    const store = makeStore();
    const repoA = createRepository(accountScope('uid-a'), { store });
    const repoB = createRepository(accountScope('uid-b'), { store });

    await repoA.addCalc({ species: 'Cod', product: 'Fillet', cost: 4, yield: 40, result: 10 });

    // Account B sees no data from Account A.
    expect(await repoB.getCalcs()).toHaveLength(0);
    const pendingB = await repoB.getPendingSync();
    expect(pendingB.calcs).toHaveLength(0);
  });

  it('account A sign-out (clearSyncedCache) does not affect account B records', async () => {
    const store = makeStore();
    const repoA = createRepository(accountScope('uid-a'), { store });
    const repoB = createRepository(accountScope('uid-b'), { store });

    const calcA = await repoA.addCalc({ species: 'Salmon', product: 'Fillet', cost: 5, yield: 50, result: 10 });
    await repoA.markCalcSynced(calcA.id, 1);
    await repoB.addCalc({ species: 'Tuna', product: 'Loin', cost: 8, yield: 60, result: 13 });

    await repoA.clearSyncedCache();

    // Account A cache cleared.
    expect(await repoA.getCalcs()).toHaveLength(0);
    // Account B untouched.
    expect(await repoB.getCalcs()).toHaveLength(1);
  });
});

describe('sign-out guard — guest and recovery scopes are not touched', () => {
  it('clearSyncedCache on account scope does not affect guest scope', async () => {
    const store = makeStore();
    const accountRepo = createRepository(ACCOUNT, { store });
    const guestRepo2 = createRepository(GUEST, { store });

    const syncedCalc = await accountRepo.addCalc({ species: 'Cod', product: 'Fillet', cost: 4, yield: 40, result: 10 });
    await accountRepo.markCalcSynced(syncedCalc.id, 1);
    await guestRepo2.addCalc({ species: 'Salmon', product: 'Fillet', cost: 5, yield: 50, result: 10 });

    await accountRepo.clearSyncedCache();

    // Guest scope untouched.
    expect(await guestRepo2.getCalcs()).toHaveLength(1);
    // Account scope cleared.
    expect(await accountRepo.getCalcs()).toHaveLength(0);
  });
});
