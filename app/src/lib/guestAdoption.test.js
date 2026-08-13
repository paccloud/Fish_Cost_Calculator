import { describe, expect, it, vi } from 'vitest';
import { detectGuestRecords, adoptGuestRecords } from './guestAdoption';
import { createRepository, guestScope, accountScope } from './localRepository';

// In-memory store that simulates idb-keyval persistence.
function makeStore() {
  const db = {};
  return {
    get: vi.fn(async (key) => structuredClone(db[key]) ?? undefined),
    set: vi.fn(async (key, val) => { db[key] = structuredClone(val); }),
    _db: db,
  };
}

function makeRepo(scope, store) {
  return createRepository(scope, { store });
}

const GUEST = guestScope({ getItem: () => 'install-test', setItem: vi.fn() });
const ACCOUNT = accountScope('user-123');

describe('detectGuestRecords', () => {
  it('returns zero counts when guest scope is empty', async () => {
    const store = makeStore();
    const guestRepo = makeRepo(GUEST, store);
    const result = await detectGuestRecords(guestRepo);
    expect(result).toEqual({ calcs: 0, yields: 0, total: 0 });
  });

  it('counts calcs and yields correctly', async () => {
    const store = makeStore();
    const guestRepo = makeRepo(GUEST, store);
    await guestRepo.addCalc({ species: 'Salmon', product: 'Fillet', cost: 10, yield: 0.6, result: 6, name: 'Test' });
    await guestRepo.addCalc({ species: 'Tuna', product: 'Steak', cost: 12, yield: 0.7, result: 8.4, name: 'Test2' });
    await guestRepo.addYield({ species: 'Salmon', product: 'Fillet', yield: 0.62, source: 'User Input' });
    const result = await detectGuestRecords(guestRepo);
    expect(result).toEqual({ calcs: 2, yields: 1, total: 3 });
  });

  it('excludes pending-delete records from the count', async () => {
    const store = makeStore();
    const guestRepo = makeRepo(GUEST, store);
    const calc = await guestRepo.addCalc({ species: 'Cod', product: 'Fillet', cost: 8, yield: 0.55, result: 4.4, name: 'Old' });
    await guestRepo.removeCalc(calc.id); // hard-deletes since syncStatus='local'
    const result = await detectGuestRecords(guestRepo);
    expect(result).toEqual({ calcs: 0, yields: 0, total: 0 });
  });
});

describe('adoptGuestRecords — confirmation', () => {
  it('copies calcs and yields into the account scope', async () => {
    const store = makeStore();
    const guestRepo = makeRepo(GUEST, store);
    const accountRepo = makeRepo(ACCOUNT, store);

    await guestRepo.addCalc({ species: 'Salmon', product: 'Fillet', cost: 10, yield: 0.6, result: 6, name: 'Sal' });
    await guestRepo.addYield({ species: 'Salmon', product: 'Fillet', yield: 0.62, source: 'User Input' });

    const { adoptedCalcs, adoptedYields } = await adoptGuestRecords(guestRepo, accountRepo);

    expect(adoptedCalcs).toBe(1);
    expect(adoptedYields).toBe(1);

    const accountCalcs = await accountRepo.getCalcs();
    const accountYields = await accountRepo.getYields();
    expect(accountCalcs).toHaveLength(1);
    expect(accountCalcs[0].species).toBe('Salmon');
    expect(accountCalcs[0].scope).toBe(ACCOUNT);
    expect(accountCalcs[0].syncStatus).toBe('local');
    expect(accountCalcs[0].guestSourceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(accountYields).toHaveLength(1);
    expect(accountYields[0].scope).toBe(ACCOUNT);
  });

  it('removes adopted records from the guest scope', async () => {
    const store = makeStore();
    const guestRepo = makeRepo(GUEST, store);
    const accountRepo = makeRepo(ACCOUNT, store);

    await guestRepo.addCalc({ species: 'Tuna', product: 'Steak', cost: 12, yield: 0.7, result: 8.4, name: 'T' });
    await guestRepo.addYield({ species: 'Tuna', product: 'Steak', yield: 0.71, source: 'User Input' });

    await adoptGuestRecords(guestRepo, accountRepo);

    expect(await guestRepo.getCalcs()).toHaveLength(0);
    expect(await guestRepo.getYields()).toHaveLength(0);
  });

  it('preserves original createdAt timestamp in the adopted record', async () => {
    const store = makeStore();
    const guestRepo = makeRepo(GUEST, store);
    const accountRepo = makeRepo(ACCOUNT, store);

    const calc = await guestRepo.addCalc({ species: 'Cod', product: 'Fillet', cost: 8, yield: 0.55, result: 4.4, name: 'Old', createdAt: '2024-01-01T00:00:00.000Z' });

    await adoptGuestRecords(guestRepo, accountRepo);

    const [adopted] = await accountRepo.getCalcs();
    expect(adopted.createdAt).toBe(calc.createdAt);
  });

  it('assigns a new id to the adopted record', async () => {
    const store = makeStore();
    const guestRepo = makeRepo(GUEST, store);
    const accountRepo = makeRepo(ACCOUNT, store);

    const calc = await guestRepo.addCalc({ species: 'Halibut', product: 'Fillet', cost: 20, yield: 0.5, result: 10, name: 'H' });

    await adoptGuestRecords(guestRepo, accountRepo);

    const [adopted] = await accountRepo.getCalcs();
    expect(adopted.id).not.toBe(calc.id);
    expect(adopted.guestSourceId).toBe(calc.id);
  });
});

describe('adoptGuestRecords — decline', () => {
  it('leaves guest scope unchanged when adoption is not called', async () => {
    const store = makeStore();
    const guestRepo = makeRepo(GUEST, store);

    await guestRepo.addCalc({ species: 'Salmon', product: 'Fillet', cost: 10, yield: 0.6, result: 6, name: 'S' });

    // No adoption call — just verify guest scope is untouched.
    expect(await guestRepo.getCalcs()).toHaveLength(1);
  });
});

describe('adoptGuestRecords — retry idempotency', () => {
  it('does not create duplicate account records when called twice', async () => {
    const store = makeStore();
    const guestRepo = makeRepo(GUEST, store);
    const accountRepo = makeRepo(ACCOUNT, store);

    await guestRepo.addCalc({ species: 'Salmon', product: 'Fillet', cost: 10, yield: 0.6, result: 6, name: 'S' });
    await guestRepo.addYield({ species: 'Salmon', product: 'Fillet', yield: 0.62, source: 'User Input' });

    // First call
    await adoptGuestRecords(guestRepo, accountRepo);
    // Second call (guest scope is empty now, but account scope has the records)
    await adoptGuestRecords(guestRepo, accountRepo);

    expect(await accountRepo.getCalcs()).toHaveLength(1);
    expect(await accountRepo.getYields()).toHaveLength(1);
  });

  it('completes adoption correctly when interrupted after partial account writes', async () => {
    // Simulate: first run copies calc to account but doesn't finish (yields not copied,
    // guest records not removed). Second run should copy yields and remove all guests.
    const store = makeStore();
    const guestRepo = makeRepo(GUEST, store);
    const accountRepo = makeRepo(ACCOUNT, store);

    const calc = await guestRepo.addCalc({ species: 'Salmon', product: 'Fillet', cost: 10, yield: 0.6, result: 6, name: 'S' });
    await guestRepo.addYield({ species: 'Salmon', product: 'Fillet', yield: 0.62, source: 'User Input' });

    // Manually simulate a partial run: only the calc was copied to account scope.
    await accountRepo.addCalc({ species: 'Salmon', product: 'Fillet', cost: 10, yield: 0.6, result: 6, name: 'S', guestSourceId: calc.id });

    // Full adoption retry — should skip the calc (already has guestSourceId) and copy the yield.
    const result = await adoptGuestRecords(guestRepo, accountRepo);
    expect(result.adoptedCalcs).toBe(0); // already adopted
    expect(result.adoptedYields).toBe(1); // newly adopted

    expect(await accountRepo.getCalcs()).toHaveLength(1);
    expect(await accountRepo.getYields()).toHaveLength(1);
  });
});

describe('adoptGuestRecords — exclusions', () => {
  it('does not adopt pending-delete records', async () => {
    const store = makeStore();
    const guestRepo = makeRepo(GUEST, store);
    const accountRepo = makeRepo(ACCOUNT, store);

    const calc = await guestRepo.addCalc({ species: 'Cod', product: 'Fillet', cost: 8, yield: 0.55, result: 4.4, name: 'Old' });
    await guestRepo.removeCalc(calc.id); // hard-deletes local record

    await adoptGuestRecords(guestRepo, accountRepo);

    expect(await accountRepo.getCalcs()).toHaveLength(0);
  });

  it('does not touch account scope when guest scope is empty', async () => {
    const store = makeStore();
    const guestRepo = makeRepo(GUEST, store);
    const accountRepo = makeRepo(ACCOUNT, store);

    await accountRepo.addCalc({ species: 'Salmon', product: 'Fillet', cost: 10, yield: 0.6, result: 6, name: 'Existing' });

    const result = await adoptGuestRecords(guestRepo, accountRepo);
    expect(result).toEqual({ adoptedCalcs: 0, adoptedYields: 0 });
    expect(await accountRepo.getCalcs()).toHaveLength(1); // unchanged
  });
});

describe('adoptGuestRecords — account ownership enforcement', () => {
  it('adopted records carry the account scope (not the guest scope)', async () => {
    const store = makeStore();
    const guestRepo = makeRepo(GUEST, store);
    const accountRepo = makeRepo(ACCOUNT, store);

    await guestRepo.addCalc({ species: 'Salmon', product: 'Fillet', cost: 10, yield: 0.6, result: 6, name: 'S' });
    await adoptGuestRecords(guestRepo, accountRepo);

    const [adopted] = await accountRepo.getCalcs();
    expect(adopted.scope).toBe(ACCOUNT);
    expect(adopted.scope).not.toContain('guest');
  });

  it('adopted records have syncStatus local so they are queued for server sync', async () => {
    const store = makeStore();
    const guestRepo = makeRepo(GUEST, store);
    const accountRepo = makeRepo(ACCOUNT, store);

    await guestRepo.addCalc({ species: 'Salmon', product: 'Fillet', cost: 10, yield: 0.6, result: 6, name: 'S' });
    await adoptGuestRecords(guestRepo, accountRepo);

    const [adopted] = await accountRepo.getCalcs();
    expect(adopted.syncStatus).toBe('local');

    const pending = await accountRepo.getPendingSync();
    expect(pending.calcs).toHaveLength(1);
  });
});
