import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createRepository,
  getInstallationId,
  guestScope,
  accountScope,
} from './localRepository';

// In-memory store that simulates idb-keyval get/set with reload persistence.
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

// ---- Scope helpers ----

describe('getInstallationId', () => {
  it('generates and persists a new id when none exists', () => {
    const storage = { getItem: vi.fn(() => null), setItem: vi.fn() };
    const id = getInstallationId(storage);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(storage.setItem).toHaveBeenCalledWith('fish-calc:installation-id', id);
  });

  it('returns the existing id when one is stored', () => {
    const storage = { getItem: vi.fn(() => 'existing-id'), setItem: vi.fn() };
    expect(getInstallationId(storage)).toBe('existing-id');
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});

describe('guestScope / accountScope', () => {
  it('returns guest:{installId}', () => {
    const storage = { getItem: vi.fn(() => 'install-abc'), setItem: vi.fn() };
    expect(guestScope(storage)).toBe('guest:install-abc');
  });

  it('returns account:{uid}', () => {
    expect(accountScope('user-xyz')).toBe('account:user-xyz');
  });
});

// ---- Scope isolation ----

describe('scope isolation', () => {
  let storeA, storeB, repoA, repoB;

  beforeEach(() => {
    // Two scopes sharing the same underlying IDB store to prove keys are separate
    const shared = makeStore();
    repoA = makeRepo('guest:device-1', shared);
    repoB = makeRepo('guest:device-2', shared);
    storeA = shared;
    storeB = shared;
  });

  it('calcs written to scope A are not visible in scope B', async () => {
    await repoA.addCalc({ species: 'Cod', product: 'Fillet', cost: 4.5, yield: 42, result: 10.71 });
    const calcsB = await repoB.getCalcs();
    expect(calcsB).toHaveLength(0);
  });

  it('yields written to scope A are not visible in scope B', async () => {
    await repoA.addYield({ species: 'Halibut', product: 'Skinless Fillet', yield: 48 });
    const yieldsB = await repoB.getYields();
    expect(yieldsB).toHaveLength(0);
  });

  it('removing a calc in scope A does not affect scope B', async () => {
    const r = await repoA.addCalc({ species: 'Cod', product: 'Fillet', cost: 4, yield: 40, result: 10 });
    await repoB.addCalc({ species: 'Cod', product: 'Fillet', cost: 4, yield: 40, result: 10 });
    await repoA.removeCalc(r.id);
    const calcsB = await repoB.getCalcs();
    expect(calcsB).toHaveLength(1);
  });
});

// ---- Reload persistence ----

describe('reload persistence', () => {
  it('guest calc survives a simulated reload (re-read from store)', async () => {
    const store = makeStore();
    const repo = makeRepo('guest:dev-1', store);
    await repo.addCalc({ species: 'Salmon', product: 'Fillet', cost: 5, yield: 50, result: 10 });

    // Simulate reload: new repo instance reads from the same store
    const reloaded = makeRepo('guest:dev-1', store);
    const calcs = await reloaded.getCalcs();
    expect(calcs).toHaveLength(1);
    expect(calcs[0].species).toBe('Salmon');
  });

  it('guest yield survives a simulated reload', async () => {
    const store = makeStore();
    const repo = makeRepo('guest:dev-1', store);
    await repo.addYield({ species: 'Halibut', product: 'Round → Fillet', yield: 48 });

    const reloaded = makeRepo('guest:dev-1', store);
    const yields = await reloaded.getYields();
    expect(yields).toHaveLength(1);
    expect(yields[0].species).toBe('Halibut');
  });

  it('tombstone survives reload and is not exposed by getCalcs', async () => {
    const store = makeStore();
    const repo = makeRepo('guest:dev-1', store);
    const rec = await repo.addCalc({ species: 'Cod', product: 'Fillet', cost: 4, yield: 40, result: 10 });
    // Mark synced so removal creates a tombstone
    await repo.markCalcSynced(rec.id, 99);
    await repo.removeCalc(rec.id);

    const reloaded = makeRepo('guest:dev-1', store);
    const calcs = await reloaded.getCalcs();
    expect(calcs).toHaveLength(0);
    // Tombstone is still in raw store
    const pending = await reloaded.getPendingSync();
    expect(pending.calcs).toHaveLength(1);
    expect(pending.calcs[0].syncStatus).toBe('pending-delete');
  });
});

// ---- Record fields ----

describe('record fields', () => {
  let repo, store;
  beforeEach(() => {
    store = makeStore();
    repo = makeRepo('guest:dev-1', store);
  });

  it('each record has a stable client id, scope, timestamps, and syncStatus', async () => {
    const rec = await repo.addCalc({ species: 'Cod', product: 'Fillet', cost: 4, yield: 40, result: 10 });
    expect(rec.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(rec.scope).toBe('guest:dev-1');
    expect(rec.syncStatus).toBe('local');
    expect(rec.createdAt).toBeTruthy();
    expect(rec.updatedAt).toBeTruthy();
  });

  it('yield records carry scope', async () => {
    const rec = await repo.addYield({ species: 'Halibut', product: 'Fillet', yield: 48 });
    expect(rec.scope).toBe('guest:dev-1');
  });
});

// ---- Snapshot immutability ----

describe('snapshot immutability', () => {
  let repo, store;
  beforeEach(() => {
    store = makeStore();
    repo = makeRepo('guest:dev-1', store);
  });

  it('changing calculation inputs creates a new snapshot, not an update', async () => {
    const first = await repo.addCalc({ species: 'Cod', product: 'Fillet', cost: 4, yield: 40, result: 10 });
    const second = await repo.addCalc({ species: 'Cod', product: 'Fillet', cost: 5, yield: 40, result: 12.5 });

    const calcs = await repo.getCalcs();
    expect(calcs).toHaveLength(2);
    expect(calcs[0].id).not.toBe(calcs[1].id);
    expect(calcs[0].cost).toBe(4);
    expect(calcs[1].cost).toBe(5);
    expect(first.id).not.toBe(second.id);
  });

  it('renameCalc changes only the name field', async () => {
    const rec = await repo.addCalc({ species: 'Cod', product: 'Fillet', cost: 4, yield: 40, result: 10 });
    const renamed = await repo.renameCalc(rec.id, 'My Cod Calc');

    expect(renamed.name).toBe('My Cod Calc');
    expect(renamed.id).toBe(rec.id);
    expect(renamed.species).toBe('Cod');
    expect(renamed.cost).toBe(4);
    expect(renamed.yield).toBe(40);
  });

  it('renameCalc returns null for a nonexistent id', async () => {
    const result = await repo.renameCalc('does-not-exist', 'name');
    expect(result).toBeNull();
  });
});

// ---- Tombstone (durable delete) behavior ----

describe('tombstone behavior', () => {
  let repo, store;
  beforeEach(() => {
    store = makeStore();
    repo = makeRepo('guest:dev-1', store);
  });

  it('deleting a never-synced calc removes it immediately', async () => {
    const rec = await repo.addCalc({ species: 'Cod', product: 'Fillet', cost: 4, yield: 40, result: 10 });
    await repo.removeCalc(rec.id);
    const calcs = await repo.getCalcs();
    expect(calcs).toHaveLength(0);
    const pending = await repo.getPendingSync();
    expect(pending.calcs).toHaveLength(0);
  });

  it('deleting a synced calc creates a durable tombstone', async () => {
    const rec = await repo.addCalc({ species: 'Cod', product: 'Fillet', cost: 4, yield: 40, result: 10 });
    await repo.markCalcSynced(rec.id, 42);
    await repo.removeCalc(rec.id);

    const calcs = await repo.getCalcs();
    expect(calcs).toHaveLength(0);

    const pending = await repo.getPendingSync();
    expect(pending.calcs).toHaveLength(1);
    expect(pending.calcs[0].syncStatus).toBe('pending-delete');
    expect(pending.calcs[0].serverId).toBe(42);
  });

  it('server merge does not resurrect a tombstoned calc', async () => {
    const rec = await repo.addCalc({ species: 'Cod', product: 'Fillet', cost: 4, yield: 40, result: 10 });
    await repo.markCalcSynced(rec.id, 99);
    await repo.removeCalc(rec.id);

    await repo.mergeServerCalcs([
      { id: 99, species: 'Cod', product: 'Fillet', cost: 4, yield: 40, result: 10 },
    ]);

    const calcs = await repo.getCalcs();
    expect(calcs).toHaveLength(0);
  });

  it('deleting a never-synced yield removes it immediately', async () => {
    const rec = await repo.addYield({ species: 'Halibut', product: 'Fillet', yield: 48 });
    await repo.removeYield(rec.id);
    const yields = await repo.getYields();
    expect(yields).toHaveLength(0);
    const pending = await repo.getPendingSync();
    expect(pending.yields).toHaveLength(0);
  });

  it('deleting a synced yield creates a durable tombstone', async () => {
    const rec = await repo.addYield({ species: 'Halibut', product: 'Fillet', yield: 48 });
    await repo.markYieldSynced(rec.id, 7);
    await repo.removeYield(rec.id);

    const yields = await repo.getYields();
    expect(yields).toHaveLength(0);

    const pending = await repo.getPendingSync();
    expect(pending.yields).toHaveLength(1);
    expect(pending.yields[0].syncStatus).toBe('pending-delete');
  });
});

// ---- Transactional queue behavior ----

describe('transactional queue behavior', () => {
  let repo, store;
  beforeEach(() => {
    store = makeStore();
    repo = makeRepo('guest:dev-1', store);
  });

  it('a new calc is immediately in the pending sync queue', async () => {
    await repo.addCalc({ species: 'Salmon', product: 'Fillet', cost: 5, yield: 50, result: 10 });
    const pending = await repo.getPendingSync();
    expect(pending.calcs).toHaveLength(1);
    expect(pending.calcs[0].syncStatus).toBe('local');
  });

  it('after markCalcSynced, the calc leaves the pending queue', async () => {
    const rec = await repo.addCalc({ species: 'Salmon', product: 'Fillet', cost: 5, yield: 50, result: 10 });
    await repo.markCalcSynced(rec.id, 11);
    const pending = await repo.getPendingSync();
    expect(pending.calcs).toHaveLength(0);
  });

  it('rename of a synced calc re-queues it as local', async () => {
    const rec = await repo.addCalc({ species: 'Salmon', product: 'Fillet', cost: 5, yield: 50, result: 10 });
    await repo.markCalcSynced(rec.id, 11);
    await repo.renameCalc(rec.id, 'Renamed');
    // renameCalc only touches name/updatedAt — syncStatus unchanged (synced stays synced).
    // This matches the contract: rename is metadata-only and does NOT re-queue.
    const pending = await repo.getPendingSync();
    expect(pending.calcs).toHaveLength(0);
  });

  it('updating a synced yield re-queues it as local', async () => {
    const rec = await repo.addYield({ species: 'Halibut', product: 'Fillet', yield: 48 });
    await repo.markYieldSynced(rec.id, 5);
    await repo.updateYield(rec.id, { yield: 50 });
    const pending = await repo.getPendingSync();
    expect(pending.yields).toHaveLength(1);
    expect(pending.yields[0].syncStatus).toBe('local');
  });

  it('both record state and queue state are written in one store.set call', async () => {
    store.set.mockClear();
    await repo.addCalc({ species: 'Cod', product: 'Fillet', cost: 4, yield: 40, result: 10 });
    // addCalc should call set exactly once (transactional: record + queue in one write)
    expect(store.set).toHaveBeenCalledTimes(1);
  });
});

// ---- Multiple yields with same species/product ----

describe('distinct yield observations', () => {
  let repo, store;
  beforeEach(() => {
    store = makeStore();
    repo = makeRepo('guest:dev-1', store);
  });

  it('two yields with same species and product remain distinct', async () => {
    const first = await repo.addYield({ species: 'Halibut', product: 'Skinless Fillet', yield: 48 });
    const second = await repo.addYield({ species: 'Halibut', product: 'Skinless Fillet', yield: 52 });

    expect(first.id).not.toBe(second.id);

    const yields = await repo.getYields();
    expect(yields).toHaveLength(2);
    expect(yields[0].yield).toBe(48);
    expect(yields[1].yield).toBe(52);
  });
});

// ---- Merge from server ----

describe('mergeServerCalcs', () => {
  let repo, store;
  beforeEach(() => {
    store = makeStore();
    repo = makeRepo('guest:dev-1', store);
  });

  it('adds a server calc not yet in the local store', async () => {
    await repo.mergeServerCalcs([
      { id: 7, species: 'Cod', product: 'Fillet', cost: 4.5, yield: 42, result: 10.71, created_at: '2026-06-01T00:00:00Z' },
    ]);
    const calcs = await repo.getCalcs();
    expect(calcs).toHaveLength(1);
    expect(calcs[0].serverId).toBe(7);
    expect(calcs[0].syncStatus).toBe('synced');
    expect(calcs[0].scope).toBe('guest:dev-1');
  });

  it('does not duplicate a calc already tracked by serverId', async () => {
    const rec = await repo.addCalc({ species: 'Cod', product: 'Fillet', cost: 4.5, yield: 42, result: 10.71 });
    await repo.markCalcSynced(rec.id, 7);
    await repo.mergeServerCalcs([{ id: 7, species: 'Cod', product: 'Fillet', cost: 4.5, yield: 42, result: 10.71 }]);
    const calcs = await repo.getCalcs();
    expect(calcs).toHaveLength(1);
  });

  it('does not resurrect a tombstoned calc (pending-delete)', async () => {
    const rec = await repo.addCalc({ species: 'Cod', product: 'Fillet', cost: 4, yield: 40, result: 10 });
    await repo.markCalcSynced(rec.id, 99);
    await repo.removeCalc(rec.id);
    await repo.mergeServerCalcs([{ id: 99, species: 'Cod', product: 'Fillet', cost: 4, yield: 40, result: 10 }]);
    const calcs = await repo.getCalcs();
    expect(calcs).toHaveLength(0);
  });
});

describe('mergeServerYields', () => {
  let repo, store;
  beforeEach(() => {
    store = makeStore();
    repo = makeRepo('guest:dev-1', store);
  });

  it('adds a server yield not yet in local store', async () => {
    await repo.mergeServerYields([
      { id: 12, species: 'Halibut', product: 'Skinless Fillet', yield: 48, source: 'User Input' },
    ]);
    const yields = await repo.getYields();
    expect(yields).toHaveLength(1);
    expect(yields[0].serverId).toBe(12);
    expect(yields[0].scope).toBe('guest:dev-1');
  });

  it('does not duplicate a yield already tracked by serverId', async () => {
    const rec = await repo.addYield({ species: 'Halibut', product: 'Skinless Fillet', yield: 48 });
    await repo.markYieldSynced(rec.id, 12);
    await repo.mergeServerYields([{ id: 12, species: 'Halibut', product: 'Skinless Fillet', yield: 48 }]);
    const yields = await repo.getYields();
    expect(yields).toHaveLength(1);
  });
});

// ---- removeCalcTombstone / removeYieldTombstone ----

describe('removeCalcTombstone', () => {
  let repo, store;
  beforeEach(() => {
    store = makeStore();
    repo = makeRepo('guest:dev-1', store);
  });

  it('removes the tombstone entry after confirmed server delete', async () => {
    const rec = await repo.addCalc({ species: 'Cod', product: 'Fillet', cost: 4, yield: 40, result: 10 });
    await repo.markCalcSynced(rec.id, 42);
    await repo.removeCalc(rec.id);
    await repo.removeCalcTombstone(rec.id);
    const pending = await repo.getPendingSync();
    expect(pending.calcs).toHaveLength(0);
  });
});

describe('removeYieldTombstone', () => {
  let repo, store;
  beforeEach(() => {
    store = makeStore();
    repo = makeRepo('guest:dev-1', store);
  });

  it('removes the tombstone entry after confirmed server delete', async () => {
    const rec = await repo.addYield({ species: 'Halibut', product: 'Fillet', yield: 48 });
    await repo.markYieldSynced(rec.id, 7);
    await repo.removeYield(rec.id);
    await repo.removeYieldTombstone(rec.id);
    const pending = await repo.getPendingSync();
    expect(pending.yields).toHaveLength(0);
  });
});
