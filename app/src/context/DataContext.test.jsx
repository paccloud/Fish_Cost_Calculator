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
