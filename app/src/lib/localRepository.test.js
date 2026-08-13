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

  it('returns a stable id across calls when storage is unavailable', () => {
    const id1 = getInstallationId(null);
    const id2 = getInstallationId(null);
    expect(id1).toMatch(/^[0-9a-f-]{36}$/);
    expect(id1).toBe(id2);
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
  let repoA, repoB;

  beforeEach(() => {
    // Two scopes sharing the same underlying IDB store to prove keys are separate
    const shared = makeStore();
    repoA = makeRepo('guest:device-1', shared);
    repoB = makeRepo('guest:device-2', shared);
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

  it('rename of a synced calc does NOT re-queue it (rename is local-only metadata)', async () => {
    const rec = await repo.addCalc({ species: 'Salmon', product: 'Fillet', cost: 5, yield: 50, result: 10 });
    await repo.markCalcSynced(rec.id, 11);
    await repo.renameCalc(rec.id, 'Renamed');
    // Rename only touches name/updatedAt — syncStatus stays 'synced'.
    // The new name is local-only; a record arriving on a new device will have the server name.
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

  it('concurrent mutations to the same collection both persist', async () => {
    // Start both without awaiting — they overlap in the event loop.
    const p1 = repo.addCalc({ species: 'Cod', product: 'Fillet', cost: 4, yield: 40, result: 10 });
    const p2 = repo.addCalc({ species: 'Salmon', product: 'Fillet', cost: 5, yield: 50, result: 10 });
    await Promise.all([p1, p2]);
    const calcs = await repo.getCalcs();
    expect(calcs).toHaveLength(2);
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

  it('does not resurrect a tombstoned yield (pending-delete)', async () => {
    const rec = await repo.addYield({ species: 'Halibut', product: 'Skinless Fillet', yield: 48 });
    await repo.markYieldSynced(rec.id, 12);
    await repo.removeYield(rec.id);

    await repo.mergeServerYields([{ id: 12, species: 'Halibut', product: 'Skinless Fillet', yield: 48 }]);

    const yields = await repo.getYields();
    expect(yields).toHaveLength(0);
    const pending = await repo.getPendingSync();
    expect(pending.yields[0].syncStatus).toBe('pending-delete');
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

// ---- Sign-out cache management ----

describe('clearSyncedCache', () => {
  let repo, store;

  beforeEach(() => {
    store = makeStore();
    repo = makeRepo('account:u1', store);
  });

  it('removes synced calcs and yields, leaves local and pending-delete', async () => {
    const localCalc = await repo.addCalc({ species: 'Cod', product: 'Fillet', cost: 4, yield: 40, result: 10 });
    const syncedCalc = await repo.addCalc({ species: 'Salmon', product: 'Fillet', cost: 5, yield: 50, result: 10 });
    await repo.markCalcSynced(syncedCalc.id, 99);

    const localYield = await repo.addYield({ species: 'Cod', product: 'Fillet', yield: 42 });
    const syncedYield = await repo.addYield({ species: 'Salmon', product: 'Fillet', yield: 50 });
    await repo.markYieldSynced(syncedYield.id, 88, 1);

    await repo.clearSyncedCache();

    const remaining = await repo.getPendingSync();
    expect(remaining.calcs.map((c) => c.id)).toContain(localCalc.id);
    expect(remaining.calcs.map((c) => c.id)).not.toContain(syncedCalc.id);
    expect(remaining.yields.map((y) => y.id)).toContain(localYield.id);
    expect(remaining.yields.map((y) => y.id)).not.toContain(syncedYield.id);
  });

  it('leaves pending-delete tombstones intact', async () => {
    const calc = await repo.addCalc({ species: 'Tuna', product: 'Loin', cost: 8, yield: 60, result: 13.3 });
    await repo.markCalcSynced(calc.id, 5);
    await repo.removeCalc(calc.id);

    await repo.clearSyncedCache();

    const pending = await repo.getPendingSync();
    expect(pending.calcs).toHaveLength(1);
    expect(pending.calcs[0].syncStatus).toBe('pending-delete');
  });

  it('does not affect other scopes', async () => {
    const store2Shared = makeStore();
    const repoA = makeRepo('account:u1', store2Shared);
    const repoB = makeRepo('account:u2', store2Shared);

    await repoB.addCalc({ species: 'Cod', product: 'Fillet', cost: 4, yield: 40, result: 10 });
    const syncedA = await repoA.addCalc({ species: 'Salmon', product: 'Fillet', cost: 5, yield: 50, result: 10 });
    await repoA.markCalcSynced(syncedA.id, 1);

    await repoA.clearSyncedCache();

    const calcsB = await repoB.getCalcs();
    expect(calcsB).toHaveLength(1);
  });
});

describe('discardUnsynchronized', () => {
  let repo, store;

  beforeEach(() => {
    store = makeStore();
    repo = makeRepo('account:u1', store);
  });

  it('removes local and pending-delete records, leaves synced', async () => {
    const localCalc = await repo.addCalc({ species: 'Cod', product: 'Fillet', cost: 4, yield: 40, result: 10 });
    const syncedCalc = await repo.addCalc({ species: 'Salmon', product: 'Fillet', cost: 5, yield: 50, result: 10 });
    await repo.markCalcSynced(syncedCalc.id, 1);
    const toDelete = await repo.addCalc({ species: 'Tuna', product: 'Loin', cost: 8, yield: 60, result: 13 });
    await repo.markCalcSynced(toDelete.id, 2);
    await repo.removeCalc(toDelete.id);

    const localYield = await repo.addYield({ species: 'Cod', product: 'Fillet', yield: 42 });
    const syncedYield = await repo.addYield({ species: 'Salmon', product: 'Fillet', yield: 50 });
    await repo.markYieldSynced(syncedYield.id, 9, 1);

    await repo.discardUnsynchronized();

    const pending = await repo.getPendingSync();
    expect(pending.calcs).toHaveLength(0);
    expect(pending.yields).toHaveLength(0);

    const calcs = await repo.getCalcs();
    expect(calcs.map((c) => c.id)).toContain(syncedCalc.id);
    expect(calcs.map((c) => c.id)).not.toContain(localCalc.id);

    const yields = await repo.getYields();
    expect(yields.map((y) => y.id)).toContain(syncedYield.id);
    expect(yields.map((y) => y.id)).not.toContain(localYield.id);
  });
});

// ---- Conflict resolution ----

describe('markYieldConflicted', () => {
  let repo, store;
  beforeEach(() => { store = makeStore(); repo = makeRepo('account:u1', store); });

  it('transitions a local yield to conflicted state, preserving the local payload', async () => {
    const rec = await repo.addYield({ species: 'Cod', product: 'Fillet', yield: 42, source: 'Test' });
    await repo.markYieldSynced(rec.id, 'srv-1', 1);
    await repo.updateYield(rec.id, { yield: 45 });

    await repo.markYieldConflicted(rec.id);

    const conflicts = await repo.getConflictedYields();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].syncStatus).toBe('conflicted');
    expect(conflicts[0].conflictLocal.yield).toBe(45);
    expect(conflicts[0].conflictServer).toBeNull();
  });

  it('removes the conflicted record from the sync queue', async () => {
    const rec = await repo.addYield({ species: 'Cod', product: 'Fillet', yield: 42 });
    await repo.markYieldSynced(rec.id, 'srv-2', 1);
    await repo.updateYield(rec.id, { yield: 50 });
    await repo.markYieldConflicted(rec.id);

    const pending = await repo.getPendingSync();
    expect(pending.yields).toHaveLength(0);
  });

  it('is a no-op for an unknown id', async () => {
    await expect(repo.markYieldConflicted('does-not-exist')).resolves.toBeUndefined();
  });
});

describe('holdStaleYieldDelete', () => {
  let repo, store;
  beforeEach(() => { store = makeStore(); repo = makeRepo('account:u1', store); });

  it('transitions a pending-delete yield to conflict-delete state', async () => {
    const rec = await repo.addYield({ species: 'Salmon', product: 'Fillet', yield: 50 });
    await repo.markYieldSynced(rec.id, 'srv-3', 1);
    await repo.removeYield(rec.id);
    await repo.holdStaleYieldDelete(rec.id);

    const conflicts = await repo.getConflictedYields();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].syncStatus).toBe('conflict-delete');
  });

  it('removes the stale-delete record from the sync queue', async () => {
    const rec = await repo.addYield({ species: 'Tuna', product: 'Loin', yield: 60 });
    await repo.markYieldSynced(rec.id, 'srv-4', 1);
    await repo.removeYield(rec.id);
    await repo.holdStaleYieldDelete(rec.id);

    const pending = await repo.getPendingSync();
    expect(pending.yields).toHaveLength(0);
  });

  it('is a no-op if syncStatus is not pending-delete', async () => {
    const rec = await repo.addYield({ species: 'Halibut', product: 'Steak', yield: 55 });
    await repo.holdStaleYieldDelete(rec.id); // local, not pending-delete

    const conflicts = await repo.getConflictedYields();
    expect(conflicts).toHaveLength(0);
  });
});

describe('mergeServerYields — updates conflictServer for conflicted records', () => {
  let repo, store;
  beforeEach(() => { store = makeStore(); repo = makeRepo('account:u1', store); });

  it('populates conflictServer when server yields are pulled after a conflict', async () => {
    const rec = await repo.addYield({ species: 'Cod', product: 'Fillet', yield: 42 });
    await repo.markYieldSynced(rec.id, 'srv-5', 1);
    await repo.updateYield(rec.id, { yield: 45 });
    await repo.markYieldConflicted(rec.id);

    await repo.mergeServerYields([{
      id: 'srv-5', revision: 2, species: 'Cod', product: 'Fillet', yield: 48, source: 'Server', is_shared: false,
    }]);

    const conflicts = await repo.getConflictedYields();
    expect(conflicts[0].conflictServer).toMatchObject({
      serverId: 'srv-5', serverRevision: 2, yield: 48,
    });
  });

  it('does not insert a duplicate record for a conflicted yield', async () => {
    const rec = await repo.addYield({ species: 'Cod', product: 'Fillet', yield: 42 });
    await repo.markYieldSynced(rec.id, 'srv-6', 1);
    await repo.updateYield(rec.id, { yield: 45 });
    await repo.markYieldConflicted(rec.id);

    await repo.mergeServerYields([{ id: 'srv-6', revision: 2, species: 'Cod', product: 'Fillet', yield: 48, source: 'Server', is_shared: false }]);

    const all = await repo.getYields();
    expect(all.filter((y) => String(y.serverId) === 'srv-6')).toHaveLength(1);
  });
});

describe('resolveYieldConflict', () => {
  let repo, store;

  async function makeConflictedYield(yieldVal = 42) {
    const rec = await repo.addYield({ species: 'Cod', product: 'Fillet', yield: yieldVal });
    await repo.markYieldSynced(rec.id, 'srv-10', 1);
    await repo.updateYield(rec.id, { yield: yieldVal + 5 });
    await repo.markYieldConflicted(rec.id);
    await repo.mergeServerYields([{
      id: 'srv-10', revision: 2, species: 'Cod', product: 'Fillet', yield: yieldVal + 10, source: 'Server', is_shared: false,
    }]);
    const [conflict] = await repo.getConflictedYields();
    return conflict;
  }

  beforeEach(() => { store = makeStore(); repo = makeRepo('account:u1', store); });

  it('use-local: marks record as local with updated serverRevision for retry', async () => {
    const conflict = await makeConflictedYield(40);
    await repo.resolveYieldConflict(conflict.id, 'use-local');

    const pending = await repo.getPendingSync();
    expect(pending.yields).toHaveLength(1);
    expect(pending.yields[0].syncStatus).toBe('local');
    expect(pending.yields[0].serverRevision).toBe(2); // updated to server revision
    expect(pending.yields[0].yield).toBe(45); // local edit preserved
    expect(await repo.getConflictedYields()).toHaveLength(0);
  });

  it('use-server: replaces record with server state, marks synced', async () => {
    const conflict = await makeConflictedYield(40);
    await repo.resolveYieldConflict(conflict.id, 'use-server');

    const yields = await repo.getYields();
    expect(yields).toHaveLength(1);
    expect(yields[0].syncStatus).toBe('synced');
    expect(yields[0].yield).toBe(50); // server value
    expect(await repo.getConflictedYields()).toHaveLength(0);
    const pending = await repo.getPendingSync();
    expect(pending.yields).toHaveLength(0);
  });

  it('keep-both: existing record → server state (synced); new record → local edit (local)', async () => {
    const conflict = await makeConflictedYield(40);
    await repo.resolveYieldConflict(conflict.id, 'keep-both');

    const yields = await repo.getYields();
    expect(yields).toHaveLength(2);

    const synced = yields.find((y) => y.syncStatus === 'synced');
    const local = yields.find((y) => y.syncStatus === 'local');
    expect(synced).toBeDefined();
    expect(local).toBeDefined();
    expect(synced.yield).toBe(50); // server value
    expect(local.yield).toBe(45); // local edit
    expect(local.serverId).toBeUndefined(); // fresh identity — no duplicate remote claim
    expect(await repo.getConflictedYields()).toHaveLength(0);
  });

  it('keep-both: the two resulting records have distinct ids', async () => {
    const conflict = await makeConflictedYield(40);
    await repo.resolveYieldConflict(conflict.id, 'keep-both');

    const yields = await repo.getYields();
    expect(yields[0].id).not.toBe(yields[1].id);
  });

  it('returns null for an unknown id', async () => {
    const result = await repo.resolveYieldConflict('no-such-id', 'use-local');
    expect(result).toBeNull();
  });

  it('returns null if record is not in conflicted state', async () => {
    const rec = await repo.addYield({ species: 'Cod', product: 'Fillet', yield: 42 });
    const result = await repo.resolveYieldConflict(rec.id, 'use-local');
    expect(result).toBeNull();
  });
});
